"""Durable local run store. Never claims exactly-once delivery.

PostgreSQL remains planned/unavailable until a real backend exists.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import threading
from pathlib import Path
from typing import Any

from handoffkit.clinical.constants import MAX_RUN_ID_LEN
from handoffkit.clinical.errors import ClinicalError
from handoffkit.clinical.models import ClinicalRun

STORE_FORMAT = "handoffkit.clinical.store.v1"
_RUN_ID_RE = re.compile(r"^[A-Za-z0-9._-]{1,80}$")


def safe_run_id(run_id: str) -> str:
    value = str(run_id or "")
    if ".." in value or "/" in value or "\\" in value or not _RUN_ID_RE.fullmatch(value):
        raise ClinicalError("invalid run id", code="invalid_request")
    if len(value) > MAX_RUN_ID_LEN:
        raise ClinicalError("invalid run id", code="invalid_request")
    return value


def _checksum(payload: dict[str, Any]) -> str:
    blob = json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def _envelope(run: ClinicalRun, vault: dict[str, Any] | None = None) -> dict[str, Any]:
    body = {
        "run": run.to_wire(include_sealed=True),
        "vault": dict(vault or {}),
    }
    return {
        "format": STORE_FORMAT,
        "format_version": 1,
        "checksum": _checksum(body),
        "body": body,
    }


def _atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as handle:
        handle.write(text)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(tmp, path)
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


class RunStore:
    def __init__(self, root: str | Path | None = None) -> None:
        self.root = Path(root or ".local-tests/clinical-runs")
        self.root.mkdir(parents=True, exist_ok=True)
        (self.root / "quarantine").mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._closed = False

    def _path(self, run_id: str) -> Path:
        return self.root / f"{safe_run_id(run_id)}.json"

    def save(
        self,
        run: ClinicalRun,
        expected_revision: int | None = None,
        vault: dict[str, Any] | None = None,
    ) -> None:
        if self._closed:
            raise ClinicalError("store is closed", code="invalid_request")
        with self._lock:
            path = self._path(run.run_id)
            if expected_revision is not None and path.is_file():
                current = self._load_unlocked(run.run_id)
                if current.revision != expected_revision:
                    raise ClinicalError("run revision conflict", code="revision_conflict")
            envelope = _envelope(run, vault)
            _atomic_write(path, json.dumps(envelope, indent=2, ensure_ascii=False) + "\n")

    def _load_unlocked(self, run_id: str) -> ClinicalRun:
        path = self._path(run_id)
        if not path.is_file():
            raise ClinicalError("run not found", code="invalid_request")
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if data.get("format") == STORE_FORMAT:
                body = data.get("body") or {}
                if _checksum(body) != data.get("checksum"):
                    raise ValueError("checksum mismatch")
                return ClinicalRun(body.get("run") or {})
            return ClinicalRun(data)
        except (json.JSONDecodeError, TypeError, ValueError, KeyError) as exc:
            quarantine = self.root / "quarantine" / path.name
            try:
                shutil.move(str(path), str(quarantine))
            except OSError:
                pass
            raise ClinicalError("stored run is corrupt", code="store_corrupt") from exc

    def load(self, run_id: str) -> ClinicalRun:
        if self._closed:
            raise ClinicalError("store is closed", code="invalid_request")
        with self._lock:
            return self._load_unlocked(run_id)

    def list_ids(self) -> list[str]:
        return sorted(path.stem for path in self.root.glob("*.json"))

    def backup(self, dest: str | Path) -> Path:
        target = Path(dest)
        if target.exists():
            shutil.rmtree(target)
        shutil.copytree(self.root, target, ignore=shutil.ignore_patterns("quarantine"))
        return target

    def restore(self, src: str | Path) -> None:
        source = Path(src)
        if not source.is_dir():
            raise ClinicalError("backup not found", code="invalid_request")
        with self._lock:
            for path in source.glob("*.json"):
                shutil.copy2(path, self.root / path.name)

    def close(self) -> None:
        self._closed = True


class SqliteRunStore:
    def __init__(self, path: str | Path) -> None:
        import sqlite3

        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._closed = False
        self._conn = sqlite3.connect(self.path, check_same_thread=False)
        self._conn.execute(
            "CREATE TABLE IF NOT EXISTS runs ("
            "run_id TEXT PRIMARY KEY, "
            "revision INTEGER NOT NULL, "
            "checksum TEXT NOT NULL, "
            "payload TEXT NOT NULL)"
        )
        self._conn.commit()

    def save(
        self,
        run: ClinicalRun,
        expected_revision: int | None = None,
        vault: dict[str, Any] | None = None,
    ) -> None:
        if self._closed:
            raise ClinicalError("store is closed", code="invalid_request")
        envelope = _envelope(run, vault)
        blob = json.dumps(envelope, ensure_ascii=False)
        with self._lock:
            if expected_revision is not None:
                row = self._conn.execute(
                    "SELECT revision FROM runs WHERE run_id=?", (run.run_id,)
                ).fetchone()
                if row and int(row[0]) != expected_revision:
                    raise ClinicalError("run revision conflict", code="revision_conflict")
            self._conn.execute(
                "INSERT OR REPLACE INTO runs(run_id, revision, checksum, payload) VALUES (?,?,?,?)",
                (run.run_id, run.revision, envelope["checksum"], blob),
            )
            self._conn.commit()

    def load(self, run_id: str) -> ClinicalRun:
        if self._closed:
            raise ClinicalError("store is closed", code="invalid_request")
        with self._lock:
            row = self._conn.execute(
                "SELECT payload, checksum FROM runs WHERE run_id=?",
                (safe_run_id(run_id),),
            ).fetchone()
        if not row:
            raise ClinicalError("run not found", code="invalid_request")
        data = json.loads(row[0])
        body = data.get("body") or {"run": data}
        if data.get("format") == STORE_FORMAT and _checksum(body) != data.get("checksum"):
            raise ClinicalError("stored run is corrupt", code="store_corrupt")
        return ClinicalRun(body.get("run") or data)

    def list_ids(self) -> list[str]:
        rows = self._conn.execute("SELECT run_id FROM runs ORDER BY run_id").fetchall()
        return [row[0] for row in rows]

    def close(self) -> None:
        self._closed = True
        self._conn.close()


class MemoryStore:
    def __init__(self) -> None:
        self._runs: dict[str, dict[str, Any]] = {}
        self._lock = threading.Lock()
        self._closed = False

    def save(
        self,
        run: ClinicalRun,
        expected_revision: int | None = None,
        vault: dict[str, Any] | None = None,
    ) -> None:
        if self._closed:
            raise ClinicalError("store is closed", code="invalid_request")
        with self._lock:
            current = self._runs.get(run.run_id)
            if expected_revision is not None and current is not None:
                if int(current.get("revision") or 0) != expected_revision:
                    raise ClinicalError("run revision conflict", code="revision_conflict")
            self._runs[run.run_id] = run.to_wire(include_sealed=True)

    def load(self, run_id: str) -> ClinicalRun:
        if self._closed:
            raise ClinicalError("store is closed", code="invalid_request")
        with self._lock:
            if run_id not in self._runs:
                raise ClinicalError("run not found", code="invalid_request")
            return ClinicalRun(self._runs[run_id])

    def list_ids(self) -> list[str]:
        return sorted(self._runs)

    def close(self) -> None:
        self._closed = True


class PostgresRunStore:
    status = "planned"

    def __init__(self, *_args: Any, **_kwargs: Any) -> None:
        raise ClinicalError(
            "PostgreSQL store is planned and unavailable",
            code="provider_unavailable",
            details={"status": "planned"},
        )
