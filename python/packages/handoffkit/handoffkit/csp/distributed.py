"""Deterministic worker registry and scheduler for HK-CSP."""

from __future__ import annotations

import threading
import time
from collections import OrderedDict, deque
from copy import deepcopy
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Any
from uuid import uuid4

from handoffkit.csp.models import (
    DistributedJob,
    JobAssignment,
    WorkerCapabilities,
    WorkerHeartbeat,
    utc_now,
)
from handoffkit.csp.scheduler_state import (
    SCHEDULER_STATE_FORMAT,
    SCHEDULER_STATE_FORMAT_VERSION,
    SchedulerStateStore,
    migrate_scheduler_state,
)
from handoffkit.csp.security import SecurityError

_MAX_SAFE_INTEGER = 9_007_199_254_740_991


def _scheduler_commit_applied(error: BaseException) -> bool:
    details = getattr(error, "details", None)
    return bool(
        getattr(error, "committed", False)
        or (isinstance(details, dict) and details.get("committed") is True)
    )


class WorkerStatus(str, Enum):
    ONLINE = "online"
    SUSPECT = "suspect"
    OFFLINE = "offline"


@dataclass(frozen=True)
class WorkerRecord:
    capabilities: WorkerCapabilities
    status: WorkerStatus
    heartbeat_sequence: int
    active_jobs: int
    load: float
    last_seen: float
    metadata: dict[str, Any] = field(default_factory=dict)

    @property
    def worker_id(self) -> str:
        return self.capabilities.worker_id


class WorkerRegistry:
    """Thread-safe in-memory registry with heartbeat expiry and routing."""

    def __init__(
        self,
        *,
        suspect_after: float = 15.0,
        offline_after: float = 45.0,
        clock: Any = time.monotonic,
    ) -> None:
        if suspect_after <= 0 or offline_after < suspect_after:
            raise ValueError("heartbeat thresholds are invalid")
        self.suspect_after = suspect_after
        self.offline_after = offline_after
        self._clock = clock
        self._records: dict[str, WorkerRecord] = {}
        self._lock = threading.RLock()

    def register(self, capabilities: WorkerCapabilities) -> WorkerRecord:
        record = WorkerRecord(
            capabilities=capabilities,
            status=WorkerStatus.ONLINE,
            heartbeat_sequence=0,
            active_jobs=0,
            load=0.0,
            last_seen=float(self._clock()),
        )
        with self._lock:
            self._records[capabilities.worker_id] = record
        return record

    def heartbeat(self, heartbeat: WorkerHeartbeat) -> bool:
        with self._lock:
            current = self._records.get(heartbeat.worker_id)
            if current is None:
                raise KeyError(f"unknown worker {heartbeat.worker_id!r}")
            if heartbeat.sequence <= current.heartbeat_sequence:
                return False
            self._records[heartbeat.worker_id] = WorkerRecord(
                capabilities=current.capabilities,
                status=WorkerStatus.ONLINE,
                heartbeat_sequence=heartbeat.sequence,
                active_jobs=heartbeat.active_jobs,
                load=heartbeat.load,
                last_seen=float(self._clock()),
                metadata=dict(heartbeat.metadata),
            )
            return True

    def mark_disconnected(self, worker_id: str) -> None:
        with self._lock:
            current = self._required(worker_id)
            self._records[worker_id] = self._replace(
                current,
                status=WorkerStatus.OFFLINE,
            )

    def expire(self) -> list[str]:
        now = float(self._clock())
        changed: list[str] = []
        with self._lock:
            for worker_id, current in list(self._records.items()):
                age = now - current.last_seen
                status = (
                    WorkerStatus.OFFLINE
                    if age >= self.offline_after
                    else WorkerStatus.SUSPECT
                    if age >= self.suspect_after
                    else WorkerStatus.ONLINE
                )
                if status is not current.status:
                    self._records[worker_id] = self._replace(current, status=status)
                    changed.append(worker_id)
        return changed

    def reserve(self, required_capabilities: list[str]) -> WorkerRecord | None:
        required = set(required_capabilities)
        with self._lock:
            candidates = [
                record
                for record in self._records.values()
                if record.status is WorkerStatus.ONLINE
                and required.issubset(set(record.capabilities.operations))
            ]
            if not candidates:
                return None
            chosen = min(
                candidates,
                key=lambda item: (item.load, item.active_jobs, item.worker_id),
            )
            reserved = self._replace(chosen, active_jobs=chosen.active_jobs + 1)
            self._records[chosen.worker_id] = reserved
            return reserved

    def release(self, worker_id: str) -> None:
        with self._lock:
            current = self._required(worker_id)
            self._records[worker_id] = self._replace(
                current,
                active_jobs=max(0, current.active_jobs - 1),
            )

    def get(self, worker_id: str) -> WorkerRecord | None:
        with self._lock:
            return self._records.get(worker_id)

    def list(self) -> list[WorkerRecord]:
        with self._lock:
            return sorted(self._records.values(), key=lambda item: item.worker_id)

    def _required(self, worker_id: str) -> WorkerRecord:
        record = self._records.get(worker_id)
        if record is None:
            raise KeyError(f"unknown worker {worker_id!r}")
        return record

    @staticmethod
    def _replace(record: WorkerRecord, **changes: Any) -> WorkerRecord:
        values = {
            "capabilities": record.capabilities,
            "status": record.status,
            "heartbeat_sequence": record.heartbeat_sequence,
            "active_jobs": record.active_jobs,
            "load": record.load,
            "last_seen": record.last_seen,
            "metadata": dict(record.metadata),
        }
        values.update(changes)
        return WorkerRecord(**values)


@dataclass(frozen=True)
class SchedulerSnapshot:
    queued: int
    assigned: int
    interrupted: int
    completed: int
    failed: int
    seen_jobs: int


@dataclass
class _QueuedState:
    job: DistributedJob
    attempt: int


@dataclass
class _AssignmentState:
    assignment: JobAssignment
    job: DistributedJob


@dataclass
class _InterruptedState:
    assignment: JobAssignment
    job: DistributedJob
    reason: str = "scheduler_restart"


class DistributedScheduler:
    """Bounded lease scheduler with optional fail-closed durable state."""

    def __init__(
        self,
        registry: WorkerRegistry,
        *,
        max_attempts: int = 3,
        lease_seconds: float = 30.0,
        queue_capacity: int = 4096,
        dedup_capacity: int = 100_000,
        state_store: SchedulerStateStore | None = None,
        auto_resume: bool = False,
    ) -> None:
        if (
            type(max_attempts) is not int
            or not 1 <= max_attempts <= 4_294_967_295
            or lease_seconds <= 0
        ):
            raise ValueError("scheduler retry and lease limits must be positive")
        if (
            type(queue_capacity) is not int
            or type(dedup_capacity) is not int
            or not 1 <= queue_capacity <= _MAX_SAFE_INTEGER
            or not 1 <= dedup_capacity <= _MAX_SAFE_INTEGER
        ):
            raise ValueError("scheduler capacities must be positive")
        if type(auto_resume) is not bool:
            raise ValueError("auto_resume must be a bool")
        self.registry = registry
        self.max_attempts = max_attempts
        self.lease_seconds = lease_seconds
        self.queue_capacity = queue_capacity
        self.dedup_capacity = dedup_capacity
        self._queue: deque[_QueuedState] = deque()
        self._assigned: dict[str, _AssignmentState] = {}
        self._interrupted: dict[str, _InterruptedState] = {}
        self._seen: OrderedDict[str, str] = OrderedDict()
        self._completed = 0
        self._failed = 0
        self._generation = 0
        self._state_store = state_store
        self.auto_resume = auto_resume
        self._lock = threading.RLock()
        if state_store is not None:
            for name in ("load", "commit", "quarantine"):
                if not callable(getattr(state_store, name, None)):
                    raise TypeError(f"state_store must implement {name}()")
            self._load_state()
            if self.auto_resume:
                self._auto_resume_interrupted()

    def submit(self, job: DistributedJob) -> bool:
        with self._lock:
            if (
                isinstance(job.metadata, dict)
                and "require_exactly_once" in job.metadata
                and job.metadata["require_exactly_once"] is not False
            ):
                raise SecurityError(
                    "Exactly-once external effects are unavailable; refusing fallback "
                    "to at-least-once.",
                    code="exactly_once_unavailable",
                    details={"runtime": "python"},
                )
            if self._is_duplicate(job):
                return False
            if len(self._queue) >= self.queue_capacity:
                raise RuntimeError("distributed scheduler queue is at capacity")
            previous = self._capture_state()
            try:
                self._claim_seen(job)
                self._queue.append(_QueuedState(job, 1))
                self._persist()
            except Exception as exc:
                if not _scheduler_commit_applied(exc):
                    self._restore_state(previous)
                raise
            return True

    def schedule(self) -> JobAssignment | None:
        with self._lock:
            if len(self._assigned) + len(self._interrupted) >= self.queue_capacity:
                return None
            for _ in range(len(self._queue)):
                previous = self._capture_state()
                queued = self._queue.popleft()
                job = queued.job
                worker = self.registry.reserve(job.requested_capabilities)
                if worker is None:
                    self._queue.append(queued)
                    continue
                assigned = datetime.now(timezone.utc)
                assignment = JobAssignment(
                    assignment_id=f"assignment-{uuid4().hex}",
                    job_id=job.job_id,
                    worker_id=worker.worker_id,
                    attempt=queued.attempt,
                    assigned_at=assigned.isoformat().replace("+00:00", "Z"),
                    lease_deadline=(assigned + timedelta(seconds=self.lease_seconds))
                    .isoformat()
                    .replace("+00:00", "Z"),
                    payload=job.payload,
                    metadata={
                        **job.metadata,
                        "operation": job.operation,
                        "idempotency_key": job.idempotency_key,
                    },
                )
                self._assigned[assignment.assignment_id] = _AssignmentState(
                    assignment,
                    job,
                )
                try:
                    self._persist()
                except Exception as exc:
                    if not _scheduler_commit_applied(exc):
                        self._restore_state(previous)
                        self.registry.release(worker.worker_id)
                    raise
                return assignment
            return None

    def complete(self, assignment_id: str) -> bool:
        with self._lock:
            state = self._assigned.get(assignment_id)
            if state is None:
                return False
            previous = self._capture_state()
            try:
                self._assigned.pop(assignment_id)
                self._completed += 1
                self._persist()
            except Exception as exc:
                if _scheduler_commit_applied(exc):
                    self.registry.release(state.assignment.worker_id)
                else:
                    self._restore_state(previous)
                raise
            self.registry.release(state.assignment.worker_id)
            return True

    def fail(self, assignment_id: str, *, retryable: bool = True) -> bool:
        with self._lock:
            state = self._assigned.get(assignment_id)
            if state is None:
                return False
            previous = self._capture_state()
            try:
                self._fail_state(assignment_id, retryable=retryable)
                self._persist()
            except Exception as exc:
                if _scheduler_commit_applied(exc):
                    self.registry.release(state.assignment.worker_id)
                else:
                    self._restore_state(previous)
                raise
            self.registry.release(state.assignment.worker_id)
            return True

    def recover_worker(self, worker_id: str) -> int:
        with self._lock:
            states = [
                (assignment_id, state)
                for assignment_id, state in self._assigned.items()
                if state.assignment.worker_id == worker_id
            ]
            if not states:
                return 0
            previous = self._capture_state()
            try:
                for assignment_id, _state in states:
                    self._fail_state(assignment_id, retryable=True)
                self._persist()
            except Exception as exc:
                if _scheduler_commit_applied(exc):
                    for _assignment_id, state in states:
                        self.registry.release(state.assignment.worker_id)
                else:
                    self._restore_state(previous)
                raise
            for _assignment_id, state in states:
                self.registry.release(state.assignment.worker_id)
            return len(states)

    def recover_expired(self, *, now: datetime | None = None) -> int:
        current = now or datetime.now(timezone.utc)
        with self._lock:
            expired = [
                (assignment_id, state)
                for assignment_id, state in self._assigned.items()
                if datetime.fromisoformat(state.assignment.lease_deadline.replace("Z", "+00:00"))
                <= current
            ]
            if not expired:
                return 0
            previous = self._capture_state()
            try:
                for assignment_id, _state in expired:
                    self._fail_state(assignment_id, retryable=True)
                self._persist()
            except Exception as exc:
                if _scheduler_commit_applied(exc):
                    for _assignment_id, state in expired:
                        self.registry.release(state.assignment.worker_id)
                else:
                    self._restore_state(previous)
                raise
            for _assignment_id, state in expired:
                self.registry.release(state.assignment.worker_id)
            return len(expired)

    def list_interrupted(self) -> list[JobAssignment]:
        """Return restart-interrupted assignments without retrying them."""

        with self._lock:
            return [self._interrupted[key].assignment for key in sorted(self._interrupted)]

    def retry_interrupted(self, assignment_id: str) -> bool:
        """Explicitly requeue one restart-interrupted assignment."""

        with self._lock:
            state = self._interrupted.get(assignment_id)
            if state is None:
                return False
            if len(self._queue) >= self.queue_capacity:
                raise RuntimeError("distributed scheduler queue is at capacity")
            previous = self._capture_state()
            try:
                self._interrupted.pop(assignment_id)
                next_attempt = state.assignment.attempt + 1
                if next_attempt <= self.max_attempts:
                    self._queue.appendleft(_QueuedState(state.job, next_attempt))
                else:
                    self._failed += 1
                self._persist()
            except Exception as exc:
                if not _scheduler_commit_applied(exc):
                    self._restore_state(previous)
                raise
            return True

    def _auto_resume_interrupted(self) -> None:
        """Opt-in at-least-once restart recovery; never exactly-once."""

        for assignment_id in sorted(tuple(self._interrupted)):
            self.retry_interrupted(assignment_id)

    def fail_interrupted(self, assignment_id: str) -> bool:
        """Explicitly make one restart-interrupted assignment terminal."""

        with self._lock:
            if assignment_id not in self._interrupted:
                return False
            previous = self._capture_state()
            try:
                self._interrupted.pop(assignment_id)
                self._failed += 1
                self._persist()
            except Exception as exc:
                if not _scheduler_commit_applied(exc):
                    self._restore_state(previous)
                raise
            return True

    def snapshot(self) -> SchedulerSnapshot:
        with self._lock:
            return SchedulerSnapshot(
                queued=len(self._queue),
                assigned=len(self._assigned),
                interrupted=len(self._interrupted),
                completed=self._completed,
                failed=self._failed,
                seen_jobs=len(self._seen),
            )

    @property
    def state_generation(self) -> int:
        return self._generation

    def _fail_state(self, assignment_id: str, *, retryable: bool) -> None:
        state = self._assigned.pop(assignment_id)
        next_attempt = state.assignment.attempt + 1
        if (
            retryable
            and next_attempt <= self.max_attempts
            and len(self._queue) < self.queue_capacity
        ):
            self._queue.appendleft(_QueuedState(state.job, next_attempt))
        else:
            self._failed += 1

    def _active_job_ids(self) -> set[str]:
        return {
            state.job.job_id
            for state in (*self._queue, *self._assigned.values(), *self._interrupted.values())
        }

    def _is_duplicate(self, job: DistributedJob) -> bool:
        return (
            job.idempotency_key in self._seen
            or job.job_id in self._seen.values()
            or job.job_id in self._active_job_ids()
        )

    def _claim_seen(self, job: DistributedJob) -> None:
        active_job_ids = self._active_job_ids()
        while len(self._seen) >= self.dedup_capacity:
            evictable = next(
                (key for key, job_id in self._seen.items() if job_id not in active_job_ids),
                None,
            )
            if evictable is None:
                raise RuntimeError("distributed scheduler deduplication state is at capacity")
            self._seen.pop(evictable)
        self._seen[job.idempotency_key] = job.job_id

    def _capture_state(self) -> tuple[Any, ...]:
        return (
            deepcopy(self._queue),
            deepcopy(self._assigned),
            deepcopy(self._interrupted),
            deepcopy(self._seen),
            self._completed,
            self._failed,
            self._generation,
        )

    def _restore_state(self, state: tuple[Any, ...]) -> None:
        (
            self._queue,
            self._assigned,
            self._interrupted,
            self._seen,
            self._completed,
            self._failed,
            self._generation,
        ) = state

    def _state_payload(self, *, generation: int) -> dict[str, Any]:
        if any(
            type(value) is not int or not 0 <= value <= _MAX_SAFE_INTEGER
            for value in (self._completed, self._failed, generation)
        ):
            raise RuntimeError("scheduler state counters exceed the interoperable integer range")
        return {
            "completed": self._completed,
            "failed": self._failed,
            "format": SCHEDULER_STATE_FORMAT,
            "format_version": SCHEDULER_STATE_FORMAT_VERSION,
            "generation": generation,
            "inflight": [
                {
                    "assignment": state.assignment.to_dict(),
                    "job": state.job.to_dict(),
                }
                for _key, state in sorted(self._assigned.items())
            ],
            "interrupted": [
                {
                    "assignment": state.assignment.to_dict(),
                    "job": state.job.to_dict(),
                    "reason": state.reason,
                }
                for _key, state in sorted(self._interrupted.items())
            ],
            "queued": [
                {"attempt": state.attempt, "job": state.job.to_dict()} for state in self._queue
            ],
            "seen": [
                {"idempotency_key": key, "job_id": job_id} for key, job_id in self._seen.items()
            ],
        }

    def _persist(self) -> None:
        if self._state_store is None:
            return
        generation = self._generation + 1
        try:
            self._state_store.commit(self._state_payload(generation=generation))
        except Exception as exc:
            if _scheduler_commit_applied(exc):
                self._generation = generation
            raise
        else:
            self._generation = generation

    def _load_state(self) -> None:
        assert self._state_store is not None
        value = self._state_store.load()
        if value is None:
            return
        try:
            value, migrated = migrate_scheduler_state(value)
            if migrated:
                self._state_store.commit(value)
            self._decode_state(value)
        except Exception as exc:
            self._state_store.quarantine(f"invalid scheduler state: {type(exc).__name__}")
        if self._assigned:
            for assignment_id, state in self._assigned.items():
                self._interrupted[assignment_id] = _InterruptedState(
                    assignment=state.assignment,
                    job=state.job,
                )
            self._assigned.clear()
            self._persist()

    def _decode_state(self, value: dict[str, Any]) -> None:
        required = {
            "completed",
            "failed",
            "format",
            "format_version",
            "generation",
            "inflight",
            "interrupted",
            "queued",
            "seen",
        }
        if set(value) != required:
            raise ValueError("scheduler state fields are invalid")
        if (
            value["format"] != SCHEDULER_STATE_FORMAT
            or value["format_version"] != SCHEDULER_STATE_FORMAT_VERSION
        ):
            raise ValueError("scheduler state format is unsupported")
        for name in ("completed", "failed", "generation"):
            if type(value[name]) is not int or not 0 <= value[name] <= _MAX_SAFE_INTEGER:
                raise ValueError(f"scheduler state {name} is invalid")
        collections = ("inflight", "interrupted", "queued", "seen")
        if not all(isinstance(value[name], list) for name in collections):
            raise ValueError("scheduler state collections are invalid")
        if len(value["queued"]) > self.queue_capacity:
            raise ValueError("scheduler queue exceeds configured capacity")
        if len(value["interrupted"]) + len(value["inflight"]) > self.queue_capacity:
            raise ValueError("scheduler interrupted state exceeds configured capacity")
        if len(value["seen"]) > self.dedup_capacity:
            raise ValueError("scheduler dedup state exceeds configured capacity")

        queue: deque[_QueuedState] = deque()
        job_ids: set[str] = set()
        active_identities: dict[str, str] = {}

        def record_active(job: DistributedJob) -> None:
            if job.job_id in job_ids or job.idempotency_key in active_identities:
                raise ValueError("scheduler job is duplicated")
            job_ids.add(job.job_id)
            active_identities[job.idempotency_key] = job.job_id

        for raw in value["queued"]:
            if not isinstance(raw, dict) or set(raw) != {"attempt", "job"}:
                raise ValueError("queued scheduler record is invalid")
            attempt = raw["attempt"]
            if type(attempt) is not int or not 1 <= attempt <= self.max_attempts:
                raise ValueError("queued scheduler attempt is invalid")
            job = DistributedJob.from_dict(raw["job"])
            record_active(job)
            queue.append(_QueuedState(job, attempt))

        assignments: dict[str, _AssignmentState] = {}
        for raw in value["inflight"]:
            if not isinstance(raw, dict) or set(raw) != {"assignment", "job"}:
                raise ValueError("scheduler assignment record is invalid")
            assignment, job = self._decode_assignment_record(raw)
            if assignment.assignment_id in assignments:
                raise ValueError("scheduler assignment is duplicated")
            assignments[assignment.assignment_id] = _AssignmentState(assignment, job)
            record_active(job)

        interrupted: dict[str, _InterruptedState] = {}
        for raw in value["interrupted"]:
            if not isinstance(raw, dict) or set(raw) != {"assignment", "job", "reason"}:
                raise ValueError("interrupted scheduler record is invalid")
            if raw["reason"] != "scheduler_restart":
                raise ValueError("interrupted scheduler reason is invalid")
            assignment, job = self._decode_assignment_record(raw)
            if assignment.assignment_id in assignments or assignment.assignment_id in interrupted:
                raise ValueError("scheduler interrupted assignment is duplicated")
            interrupted[assignment.assignment_id] = _InterruptedState(assignment, job)
            record_active(job)

        seen: OrderedDict[str, str] = OrderedDict()
        seen_job_ids: set[str] = set()
        for raw in value["seen"]:
            if not isinstance(raw, dict) or set(raw) != {"idempotency_key", "job_id"}:
                raise ValueError("scheduler dedup record is invalid")
            key, job_id = raw["idempotency_key"], raw["job_id"]
            if not isinstance(key, str) or not key or not isinstance(job_id, str) or not job_id:
                raise ValueError("scheduler dedup identity is invalid")
            if key in seen or job_id in seen_job_ids:
                raise ValueError("scheduler dedup identity is duplicated")
            seen[key] = job_id
            seen_job_ids.add(job_id)
        if any(seen.get(key) != job_id for key, job_id in active_identities.items()):
            raise ValueError("scheduler active job is missing its dedup identity")

        self._queue = queue
        self._assigned = assignments
        self._interrupted = interrupted
        self._seen = seen
        self._completed = value["completed"]
        self._failed = value["failed"]
        self._generation = value["generation"]

    @staticmethod
    def _decode_assignment_record(raw: Any) -> tuple[JobAssignment, DistributedJob]:
        if not isinstance(raw, dict) or set(raw) not in (
            {"assignment", "job"},
            {"assignment", "job", "reason"},
        ):
            raise ValueError("scheduler assignment record is invalid")
        assignment = JobAssignment.from_dict(raw["assignment"])
        job = DistributedJob.from_dict(raw["job"])
        if assignment.job_id != job.job_id:
            raise ValueError("scheduler assignment job identity is inconsistent")
        return assignment, job


def heartbeat_now(
    worker_id: str,
    *,
    sequence: int,
    active_jobs: int,
    load: float,
    metadata: dict[str, Any] | None = None,
) -> WorkerHeartbeat:
    return WorkerHeartbeat(
        worker_id=worker_id,
        sequence=sequence,
        active_jobs=active_jobs,
        load=load,
        timestamp=utc_now(),
        metadata=dict(metadata or {}),
    )
