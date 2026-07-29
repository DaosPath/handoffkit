"""Persistent idempotency stores for HK-CSP sessions."""

from __future__ import annotations

import json
import os
import threading
from abc import ABC, abstractmethod
from collections import OrderedDict
from pathlib import Path
from typing import Any

from handoffkit.csp.models import sanitize_error_message, utc_now

DEFAULT_MAX_LOG_BYTES = 16 * 1024 * 1024
MAX_IDEMPOTENCY_KEY_BYTES = 1024


class DedupStore(ABC):
    """Synchronous atomic claim/release interface used by the async runtime."""

    @abstractmethod
    def claim(self, key: str) -> bool:
        """Atomically claim key, returning false when it was already claimed."""

    @abstractmethod
    def release(self, key: str) -> bool:
        """Release key so a retry may execute it again."""

    @abstractmethod
    def contains(self, key: str) -> bool:
        """Return whether key is currently retained."""


class FileDedupStore(DedupStore):
    """Bounded append-only dedup log with deterministic compaction."""

    def __init__(
        self,
        path: str | Path,
        *,
        capacity: int = 4096,
        max_log_bytes: int = DEFAULT_MAX_LOG_BYTES,
    ) -> None:
        if capacity < 1:
            raise ValueError("capacity must be at least 1")
        if max_log_bytes < 1024:
            raise ValueError("max_log_bytes must be at least 1024")
        self.path = Path(path).resolve()
        self.capacity = capacity
        self.max_log_bytes = max_log_bytes
        self._keys: OrderedDict[str, None] = OrderedDict()
        self._lock = threading.RLock()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.touch(mode=0o600, exist_ok=True)
        self._load()

    def _validate_key(self, key: str) -> str:
        normalized = str(key).strip()
        if not normalized:
            raise ValueError("idempotency key must not be empty")
        if len(normalized.encode("utf-8")) > MAX_IDEMPOTENCY_KEY_BYTES:
            raise ValueError(
                f"idempotency key must not exceed {MAX_IDEMPOTENCY_KEY_BYTES} bytes"
            )
        return normalized

    def _load(self) -> None:
        try:
            with self.path.open("r", encoding="utf-8") as handle:
                for line_number, line in enumerate(handle, 1):
                    if not line.strip():
                        continue
                    record = json.loads(line)
                    key = self._validate_key(record.get("key", ""))
                    if record.get("op") == "claim":
                        self._keys.pop(key, None)
                        self._keys[key] = None
                    elif record.get("op") == "release":
                        self._keys.pop(key, None)
                    else:
                        raise ValueError(f"unknown operation at line {line_number}")
        except (OSError, ValueError, json.JSONDecodeError) as exc:
            raise ValueError(
                f"invalid dedup log: {sanitize_error_message(str(exc))}"
            ) from exc
        while len(self._keys) > self.capacity:
            self._keys.popitem(last=False)

    def _append(self, operation: str, key: str) -> None:
        record: dict[str, Any] = {"op": operation, "key": key, "timestamp": utc_now()}
        encoded = json.dumps(record, separators=(",", ":"), ensure_ascii=False) + "\n"
        with self.path.open("a", encoding="utf-8", newline="\n") as handle:
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
        if self.path.stat().st_size > self.max_log_bytes:
            self._compact()

    def _compact(self) -> None:
        temporary = self.path.with_name(f".{self.path.name}.{os.getpid()}.tmp")
        try:
            with temporary.open("x", encoding="utf-8", newline="\n") as handle:
                for key in self._keys:
                    handle.write(
                        json.dumps(
                            {"op": "claim", "key": key, "timestamp": utc_now()},
                            separators=(",", ":"),
                            ensure_ascii=False,
                        )
                        + "\n"
                    )
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, self.path)
        finally:
            temporary.unlink(missing_ok=True)

    def claim(self, key: str) -> bool:
        normalized = self._validate_key(key)
        with self._lock:
            if normalized in self._keys:
                return False
            self._keys[normalized] = None
            while len(self._keys) > self.capacity:
                self._keys.popitem(last=False)
            self._append("claim", normalized)
            return True

    def release(self, key: str) -> bool:
        normalized = self._validate_key(key)
        with self._lock:
            if normalized not in self._keys:
                return False
            self._keys.pop(normalized)
            self._append("release", normalized)
            return True

    def contains(self, key: str) -> bool:
        normalized = self._validate_key(key)
        with self._lock:
            return normalized in self._keys

    def __len__(self) -> int:
        with self._lock:
            return len(self._keys)
