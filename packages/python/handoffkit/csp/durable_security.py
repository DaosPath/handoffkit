"""Durable, fail-closed security state for HK-CSP transports."""

from __future__ import annotations

import hashlib
import json
import os
import stat
import tempfile
import threading
import time
import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from handoffkit.csp.security import ReplayProtection, SecurityError

DURABLE_REPLAY_FORMAT_VERSION = 1
_DURABLE_REPLAY_KIND = "handoffkit.security.replay"
DURABLE_REVOCATION_FORMAT_VERSION = 1
_DURABLE_REVOCATION_KIND = "handoffkit.security.revocations"
_REVOCATION_KINDS = frozenset(
    {
        "certificate_fingerprint",
        "signer_fingerprint",
        "peer_id",
        "issuer",
        "trust_domain",
    }
)


@dataclass(frozen=True)
class ReplayContext:
    """Authenticated values persisted with one replay scope."""

    peer_id: str
    session_id: str
    credential_fingerprint: str
    security_profile: str

    def __post_init__(self) -> None:
        for name in ("peer_id", "session_id", "credential_fingerprint", "security_profile"):
            if not getattr(self, name):
                raise ValueError(f"{name} must not be empty")


class _CommittedWriteError(OSError):
    """An atomic replace completed but final directory sync was uncertain."""


class _VersionedStateFile:
    def __init__(self, path: str | Path, *, max_file_bytes: int) -> None:
        self.path = Path(path)
        self.max_file_bytes = max_file_bytes
        if self.max_file_bytes < 1024:
            raise ValueError("max_file_bytes must be at least 1024")
        parent = self.path.parent
        parent.mkdir(parents=True, exist_ok=True)
        if parent.is_symlink() or not parent.is_dir():
            raise SecurityError(
                "Durable security state parent must be a regular directory.",
                code="security_state_path_unsafe",
                details={"name": self.path.name},
            )
        if self.path.exists():
            self._validate_existing_path()

    @staticmethod
    def _canonical(value: Mapping[str, Any]) -> bytes:
        return json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")

    @classmethod
    def checksum(cls, payload: Mapping[str, Any]) -> str:
        return f"sha256:{hashlib.sha256(cls._canonical(payload)).hexdigest()}"

    def _validate_existing_path(self) -> None:
        if self.path.is_symlink() or not self.path.is_file():
            raise SecurityError(
                "Durable security state must be a regular non-symlink file.",
                code="security_state_path_unsafe",
                details={"name": self.path.name},
            )
        if os.name == "posix" and self.path.stat().st_mode & (stat.S_IRWXG | stat.S_IRWXO):
            raise SecurityError(
                "Durable security state grants group or other permissions.",
                code="security_state_permissions",
                details={"name": self.path.name},
            )

    def load(self) -> dict[str, Any] | None:
        if not self.path.exists():
            return None
        self._validate_existing_path()
        if self.path.stat().st_size > self.max_file_bytes:
            self._quarantine("state exceeds configured byte limit")
        try:
            raw = self.path.read_bytes()
            value = json.loads(raw)
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            self._quarantine(f"state cannot be decoded: {type(exc).__name__}")
        if not isinstance(value, dict):
            self._quarantine("state root is not an object")
        checksum = value.get("checksum")
        payload = {key: item for key, item in value.items() if key != "checksum"}
        if not isinstance(checksum, str) or checksum != self.checksum(payload):
            self._quarantine("state checksum mismatch")
        return value

    def commit(self, payload: Mapping[str, Any]) -> None:
        envelope = {**payload, "checksum": self.checksum(payload)}
        encoded = self._canonical(envelope) + b"\n"
        if len(encoded) > self.max_file_bytes:
            raise SecurityError(
                "Durable security state exceeds configured byte limit.",
                code="security_state_limit",
                details={"limit_bytes": self.max_file_bytes},
            )

        descriptor = -1
        temporary_path: Path | None = None
        replaced = False
        try:
            descriptor, raw_path = tempfile.mkstemp(
                prefix=f".{self.path.name}.tmp-",
                dir=self.path.parent,
            )
            temporary_path = Path(raw_path)
            if os.name == "posix":
                os.fchmod(descriptor, 0o600)
            with os.fdopen(descriptor, "wb", closefd=True) as stream:
                descriptor = -1
                stream.write(encoded)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary_path, self.path)
            replaced = True
            temporary_path = None
            if os.name == "posix":
                directory_fd = os.open(self.path.parent, os.O_RDONLY)
                try:
                    os.fsync(directory_fd)
                finally:
                    os.close(directory_fd)
        except OSError as exc:
            if replaced:
                raise _CommittedWriteError(str(exc)) from exc
            raise SecurityError(
                "Durable security state write failed before commit.",
                code="security_state_write_failed",
                details={"reason": type(exc).__name__},
            ) from exc
        finally:
            if descriptor >= 0:
                os.close(descriptor)
            if temporary_path is not None:
                try:
                    temporary_path.unlink(missing_ok=True)
                except OSError:
                    pass

    def _quarantine(self, reason: str) -> None:
        suffix = f"corrupt-{int(time.time())}-{uuid.uuid4().hex[:12]}"
        target = self.path.with_name(f"{self.path.name}.{suffix}")
        try:
            os.replace(self.path, target)
        except OSError as exc:
            raise SecurityError(
                "Durable security state is invalid and could not be quarantined.",
                code="security_state_quarantine_failed",
                details={"name": self.path.name, "reason": type(exc).__name__},
            ) from exc
        raise SecurityError(
            "Durable security state is invalid and was quarantined.",
            code="security_state_corrupt",
            details={"name": self.path.name, "reason": reason, "quarantine": target.name},
        )


class DurableReplayProtection(ReplayProtection):
    """Replay protection persisted atomically across process restarts.

    Active records are never evicted to make room. Capacity exhaustion fails
    closed so a bounded store cannot silently forget replay history.
    """

    def __init__(
        self,
        path: str | Path,
        *,
        window_seconds: int = 300,
        max_skew_seconds: int = 10,
        max_seen_nonces: int = 10_000,
        max_scopes: int = 10_000,
        state_ttl_seconds: int = 86_400,
        max_file_bytes: int = 4 * 1024 * 1024,
    ) -> None:
        super().__init__(window_seconds, max_skew_seconds, max_seen_nonces)
        if max_scopes < 1 or state_ttl_seconds < window_seconds:
            raise ValueError("durable replay bounds are invalid")
        self.max_scopes = max_scopes
        self.state_ttl_seconds = state_ttl_seconds
        self._state_file = _VersionedStateFile(path, max_file_bytes=max_file_bytes)
        self._durable_lock = threading.RLock()
        self._generation = 0
        self._records: dict[str, dict[str, Any]] = {}
        self._load()

    @property
    def path(self) -> Path:
        return self._state_file.path

    @property
    def generation(self) -> int:
        return self._generation

    def status(self) -> dict[str, int | str]:
        return {
            "format": _DURABLE_REPLAY_KIND,
            "format_version": DURABLE_REPLAY_FORMAT_VERSION,
            "generation": self._generation,
            "scopes": len(self._records),
            "nonces": len(self._seen_nonces),
        }

    def check_and_record(
        self,
        session_id: str,
        sequence: int,
        nonce: str | None = None,
        created_at_ts: float | None = None,
        *,
        context: ReplayContext | None = None,
    ) -> None:
        with self._durable_lock:
            now = time.time()
            self._compact_in_memory(now)
            if session_id not in self._records and len(self._records) >= self.max_scopes:
                raise SecurityError(
                    "Durable replay scope capacity is exhausted.",
                    code="replay_state_capacity",
                    details={"max_scopes": self.max_scopes},
                )
            previous_sequences = dict(self._last_sequences)
            previous_nonces = dict(self._seen_nonces)
            previous_records = json.loads(json.dumps(self._records))
            previous_generation = self._generation

            super().check_and_record(session_id, sequence, nonce, created_at_ts)
            record = self._records.get(session_id)
            if context is None and record is None:
                self._last_sequences = previous_sequences
                self._seen_nonces = previous_nonces
                raise SecurityError(
                    "Durable replay state requires authenticated context.",
                    code="replay_context_missing",
                )
            replay_context = context or ReplayContext(
                peer_id=str(record["peer_id"]),
                session_id=str(record["session_id"]),
                credential_fingerprint=str(record["credential_fingerprint"]),
                security_profile=str(record["security_profile"]),
            )
            nonce_entries = [
                {"seen_at": int(seen_at), "value": value}
                for (scope, value), seen_at in self._seen_nonces.items()
                if scope == session_id
            ]
            nonce_entries.sort(key=lambda item: (item["seen_at"], item["value"]))
            self._records[session_id] = {
                "credential_fingerprint": replay_context.credential_fingerprint,
                "expires_at": int(now) + self.state_ttl_seconds,
                "last_sequence": sequence,
                "nonces": nonce_entries,
                "peer_id": replay_context.peer_id,
                "scope": session_id,
                "security_profile": replay_context.security_profile,
                "session_id": replay_context.session_id,
                "updated_at": int(now),
            }
            self._generation += 1
            try:
                self._persist()
            except _CommittedWriteError as exc:
                raise SecurityError(
                    "Durable replay state committed but directory sync was uncertain.",
                    code="replay_state_durability_uncertain",
                    details={"reason": type(exc).__name__},
                ) from exc
            except Exception:
                self._last_sequences = previous_sequences
                self._seen_nonces = previous_nonces
                self._records = previous_records
                self._generation = previous_generation
                raise

    def compact(self, *, now: float | None = None) -> None:
        with self._durable_lock:
            current = time.time() if now is None else now
            changed = self._compact_in_memory(current)
            if changed:
                self._generation += 1
                self._persist()

    def _compact_in_memory(self, now: float) -> bool:
        before_records = len(self._records)
        before_nonces = len(self._seen_nonces)
        cutoff = now - self.window_seconds
        self._seen_nonces = {
            key: seen_at for key, seen_at in self._seen_nonces.items() if seen_at >= cutoff
        }
        expired_scopes = {
            scope
            for scope, record in self._records.items()
            if int(record.get("expires_at", 0)) <= int(now)
        }
        for scope in expired_scopes:
            self._records.pop(scope, None)
            self._last_sequences.pop(scope, None)
            self._seen_nonces = {
                key: value for key, value in self._seen_nonces.items() if key[0] != scope
            }
        for scope, record in self._records.items():
            record["nonces"] = [
                {"seen_at": int(seen_at), "value": value}
                for (nonce_scope, value), seen_at in sorted(
                    self._seen_nonces.items(), key=lambda item: (item[1], item[0])
                )
                if nonce_scope == scope
            ]
        return before_records != len(self._records) or before_nonces != len(self._seen_nonces)

    def _payload(self) -> dict[str, Any]:
        return {
            "format": _DURABLE_REPLAY_KIND,
            "format_version": DURABLE_REPLAY_FORMAT_VERSION,
            "generation": self._generation,
            "records": [self._records[key] for key in sorted(self._records)],
        }

    def _persist(self) -> None:
        self._state_file.commit(self._payload())

    def _load(self) -> None:
        value = self._state_file.load()
        if value is None:
            return
        if value.get("format") != _DURABLE_REPLAY_KIND:
            self._state_file._quarantine("unexpected state format")
        if value.get("format_version") != DURABLE_REPLAY_FORMAT_VERSION:
            self._state_file._quarantine("unsupported state format version")
        generation = value.get("generation")
        records = value.get("records")
        if not isinstance(generation, int) or generation < 0 or not isinstance(records, list):
            self._state_file._quarantine("invalid state metadata")
        if len(records) > self.max_scopes:
            self._state_file._quarantine("state exceeds configured scope capacity")

        loaded: dict[str, dict[str, Any]] = {}
        seen: dict[tuple[str, str], float] = {}
        sequences: dict[str, int] = {}
        try:
            for raw_record in records:
                if not isinstance(raw_record, dict):
                    raise ValueError("record is not an object")
                required = {
                    "credential_fingerprint",
                    "expires_at",
                    "last_sequence",
                    "nonces",
                    "peer_id",
                    "scope",
                    "security_profile",
                    "session_id",
                    "updated_at",
                }
                if set(raw_record) != required:
                    raise ValueError("record fields are invalid")
                scope = raw_record["scope"]
                if not isinstance(scope, str) or not scope or scope in loaded:
                    raise ValueError("record scope is invalid or duplicated")
                for name in (
                    "credential_fingerprint",
                    "peer_id",
                    "security_profile",
                    "session_id",
                ):
                    if not isinstance(raw_record[name], str) or not raw_record[name]:
                        raise ValueError(f"record {name} is invalid")
                for name in ("expires_at", "last_sequence", "updated_at"):
                    if not isinstance(raw_record[name], int) or raw_record[name] < 0:
                        raise ValueError(f"record {name} is invalid")
                if not isinstance(raw_record["nonces"], list):
                    raise ValueError("record nonces are invalid")
                for nonce_entry in raw_record["nonces"]:
                    if (
                        not isinstance(nonce_entry, dict)
                        or set(nonce_entry) != {"seen_at", "value"}
                        or not isinstance(nonce_entry["seen_at"], int)
                        or nonce_entry["seen_at"] < 0
                        or not isinstance(nonce_entry["value"], str)
                        or not nonce_entry["value"]
                    ):
                        raise ValueError("nonce entry is invalid")
                    key = (scope, nonce_entry["value"])
                    if key in seen:
                        raise ValueError("nonce entry is duplicated")
                    seen[key] = float(nonce_entry["seen_at"])
                loaded[scope] = raw_record
                sequences[scope] = raw_record["last_sequence"]
        except (KeyError, TypeError, ValueError) as exc:
            self._state_file._quarantine(str(exc))
        if len(seen) > self.max_seen_nonces:
            self._state_file._quarantine("state exceeds configured nonce capacity")
        self._generation = generation
        self._records = loaded
        self._seen_nonces = seen
        self._last_sequences = sequences
        self._compact_in_memory(time.time())


def _normalize_revocation_value(kind: str, value: str) -> str:
    normalized = value.strip()
    if kind not in _REVOCATION_KINDS:
        raise ValueError(f"unsupported revocation kind: {kind}")
    if not normalized:
        raise ValueError("revocation value must not be empty")
    if kind in {"certificate_fingerprint", "signer_fingerprint"}:
        compact = normalized.lower().replace(":", "")
        if compact.startswith("sha256"):
            compact = compact[len("sha256") :]
        if len(compact) != 64 or any(character not in "0123456789abcdef" for character in compact):
            raise ValueError("revocation fingerprint must be a SHA-256 fingerprint")
        return f"sha256:{compact}"
    if kind == "trust_domain":
        return normalized.lower()
    return normalized


@dataclass(frozen=True)
class RevocationEntry:
    """One auditable local revocation decision."""

    kind: str
    value: str
    reason: str
    revoked_at: int
    effective_at: int | None = None
    expires_at: int = 0

    def __post_init__(self) -> None:
        object.__setattr__(self, "value", _normalize_revocation_value(self.kind, self.value))
        if not self.reason.strip():
            raise ValueError("revocation reason must not be empty")
        if self.revoked_at < 0 or self.expires_at < 0:
            raise ValueError("revocation timestamps must not be negative")
        effective_at = self.revoked_at if self.effective_at is None else self.effective_at
        if effective_at < 0:
            raise ValueError("effective_at must not be negative")
        if self.expires_at and self.expires_at <= effective_at:
            raise ValueError("expires_at must be later than effective_at")
        object.__setattr__(self, "effective_at", effective_at)

    def to_dict(self) -> dict[str, int | str]:
        return {
            "effective_at": int(self.effective_at or 0),
            "expires_at": self.expires_at,
            "kind": self.kind,
            "reason": self.reason,
            "revoked_at": self.revoked_at,
            "value": self.value,
        }

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> RevocationEntry:
        required = {"effective_at", "expires_at", "kind", "reason", "revoked_at", "value"}
        if set(value) != required:
            raise ValueError("revocation entry fields are invalid")
        if any(
            not isinstance(value[name], int) or isinstance(value[name], bool)
            for name in ("effective_at", "expires_at", "revoked_at")
        ):
            raise ValueError("revocation timestamps are invalid")
        if not isinstance(value["kind"], str) or not isinstance(value["value"], str):
            raise ValueError("revocation subject is invalid")
        if not isinstance(value["reason"], str):
            raise ValueError("revocation reason is invalid")
        return cls(
            kind=value["kind"],
            value=value["value"],
            reason=value["reason"],
            revoked_at=value["revoked_at"],
            effective_at=value["effective_at"],
            expires_at=value["expires_at"],
        )


class DurableRevocationPolicy:
    """Versioned, bounded, atomic local revocation policy with explicit reload."""

    def __init__(
        self,
        path: str | Path,
        *,
        max_entries: int = 10_000,
        max_file_bytes: int = 4 * 1024 * 1024,
    ) -> None:
        if max_entries < 1:
            raise ValueError("max_entries must be positive")
        self.max_entries = max_entries
        self._state_file = _VersionedStateFile(path, max_file_bytes=max_file_bytes)
        self._lock = threading.RLock()
        self._generation = 0
        self._entries: dict[tuple[str, str], RevocationEntry] = {}
        self.reload()

    @property
    def generation(self) -> int:
        return self._generation

    @property
    def entries(self) -> tuple[RevocationEntry, ...]:
        with self._lock:
            return tuple(self._entries[key] for key in sorted(self._entries))

    def status(self, *, now: int | None = None) -> dict[str, int | str]:
        timestamp = int(time.time()) if now is None else now
        with self._lock:
            return {
                "format": _DURABLE_REVOCATION_KIND,
                "format_version": DURABLE_REVOCATION_FORMAT_VERSION,
                "generation": self._generation,
                "entries": len(self._entries),
                "active": sum(self._active(entry, timestamp) for entry in self._entries.values()),
            }

    def revoke(self, entry: RevocationEntry) -> None:
        with self._lock:
            candidate = dict(self._entries)
            candidate[(entry.kind, entry.value)] = entry
            if len(candidate) > self.max_entries:
                raise SecurityError(
                    "Durable revocation capacity is exhausted.",
                    code="revocation_state_capacity",
                    details={"max_entries": self.max_entries},
                )
            generation = self._generation + 1
            try:
                self._persist(candidate, generation)
            except _CommittedWriteError as exc:
                self._entries = candidate
                self._generation = generation
                raise SecurityError(
                    "Durable revocation state committed but directory sync was uncertain.",
                    code="revocation_state_durability_uncertain",
                ) from exc
            self._entries = candidate
            self._generation = generation

    def remove(self, kind: str, value: str) -> bool:
        normalized = _normalize_revocation_value(kind, value)
        with self._lock:
            key = (kind, normalized)
            if key not in self._entries:
                return False
            candidate = dict(self._entries)
            del candidate[key]
            generation = self._generation + 1
            self._persist(candidate, generation)
            self._entries = candidate
            self._generation = generation
            return True

    def is_revoked(self, kind: str, value: str, *, now: int | None = None) -> bool:
        normalized = _normalize_revocation_value(kind, value)
        timestamp = int(time.time()) if now is None else now
        with self._lock:
            entry = self._entries.get((kind, normalized))
            return entry is not None and self._active(entry, timestamp)

    def reload(self) -> None:
        with self._lock:
            value = self._state_file.load()
            if value is None:
                self._generation = 0
                self._entries = {}
                return
            required = {"checksum", "format", "format_version", "generation", "entries"}
            if set(value) != required:
                self._state_file._quarantine("revocation state fields are invalid")
            if value.get("format") != _DURABLE_REVOCATION_KIND:
                self._state_file._quarantine("unexpected revocation state format")
            if value.get("format_version") != DURABLE_REVOCATION_FORMAT_VERSION:
                self._state_file._quarantine("unsupported revocation state format version")
            generation = value.get("generation")
            raw_entries = value.get("entries")
            if (
                not isinstance(generation, int)
                or generation < 0
                or not isinstance(raw_entries, list)
            ):
                self._state_file._quarantine("invalid revocation state metadata")
            if len(raw_entries) > self.max_entries:
                self._state_file._quarantine("revocation state exceeds configured capacity")
            candidate: dict[tuple[str, str], RevocationEntry] = {}
            try:
                entries = [RevocationEntry.from_dict(item) for item in raw_entries]
                candidate = {(entry.kind, entry.value): entry for entry in entries}
                if len(candidate) != len(entries):
                    raise ValueError("revocation entry is duplicated")
            except (TypeError, ValueError) as exc:
                self._state_file._quarantine(str(exc))
            self._generation = generation
            self._entries = candidate

    def _persist(
        self,
        entries: Mapping[tuple[str, str], RevocationEntry],
        generation: int,
    ) -> None:
        self._state_file.commit(
            {
                "format": _DURABLE_REVOCATION_KIND,
                "format_version": DURABLE_REVOCATION_FORMAT_VERSION,
                "generation": generation,
                "entries": [entries[key].to_dict() for key in sorted(entries)],
            }
        )

    @staticmethod
    def _active(entry: RevocationEntry, now: int) -> bool:
        return int(entry.effective_at or 0) <= now and (
            not entry.expires_at or now < entry.expires_at
        )
