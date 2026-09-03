"""Versioned file storage for durable distributed scheduler state."""

from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path
from typing import Any, NoReturn, Protocol

from handoffkit.csp.durable_security import _CommittedWriteError, _VersionedStateFile
from handoffkit.csp.security import SecurityError

SCHEDULER_STATE_FORMAT = "handoffkit.scheduler.state"
SCHEDULER_STATE_FORMAT_VERSION = 1


def migrate_scheduler_state(value: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    """Migrate the explicitly supported v0 scheduler envelope to v1.

    v0 predates the ``interrupted`` collection. Adding an empty collection is
    safe because in-flight records are converted to interrupted records by the
    scheduler after decode. Unknown versions and shapes fail closed.
    """

    if not isinstance(value, dict):
        raise ValueError("scheduler state root is invalid")
    if value.get("format") != SCHEDULER_STATE_FORMAT:
        return value, False
    version = value.get("format_version")
    if version == SCHEDULER_STATE_FORMAT_VERSION:
        return value, False
    if version != 0:
        raise ValueError("scheduler state format is unsupported")
    expected = {
        "completed",
        "failed",
        "format",
        "format_version",
        "generation",
        "inflight",
        "queued",
        "seen",
    }
    if set(value) != expected:
        raise ValueError("scheduler v0 state fields are invalid")
    migrated = dict(value)
    migrated["format_version"] = SCHEDULER_STATE_FORMAT_VERSION
    migrated["interrupted"] = []
    return migrated, True


class SchedulerStateStore(Protocol):
    """Synchronous store used directly by the scheduler mutation path."""

    def load(self) -> dict[str, Any] | None: ...

    def commit(self, payload: Mapping[str, Any]) -> None: ...

    def quarantine(self, reason: str) -> NoReturn: ...


class FileSchedulerStateStore:
    """Bounded, checksummed, atomically replaced scheduler state file."""

    def __init__(
        self,
        path: str | Path,
        *,
        max_file_bytes: int = 16 * 1024 * 1024,
    ) -> None:
        self._state_file = _VersionedStateFile(path, max_file_bytes=max_file_bytes)

    @property
    def path(self) -> Path:
        return self._state_file.path

    def load(self) -> dict[str, Any] | None:
        value = self._state_file.load()
        if value is None:
            return None
        return {key: item for key, item in value.items() if key != "checksum"}

    def commit(self, payload: Mapping[str, Any]) -> None:
        try:
            self._state_file.commit(payload)
        except _CommittedWriteError as exc:
            raise SecurityError(
                "Scheduler state committed but directory sync was uncertain.",
                code="scheduler_state_durability_uncertain",
                details={"committed": True, "reason": type(exc).__name__},
            ) from exc

    def backup(self, destination: str | Path) -> None:
        self._state_file.backup(destination)

    def restore(self, source: str | Path) -> None:
        self._state_file.restore(source)

    def quarantine(self, reason: str) -> NoReturn:
        self._state_file._quarantine(reason)
