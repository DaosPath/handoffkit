"""Initial deterministic worker registry and scheduler for HK-CSP 1.18."""

from __future__ import annotations

import threading
import time
from collections import OrderedDict, deque
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
    completed: int
    failed: int
    seen_jobs: int


@dataclass
class _AssignmentState:
    assignment: JobAssignment
    job: DistributedJob


class DistributedScheduler:
    """Bounded, lease-based initial scheduler; not a global cluster scheduler."""

    def __init__(
        self,
        registry: WorkerRegistry,
        *,
        max_attempts: int = 3,
        lease_seconds: float = 30.0,
        queue_capacity: int = 4096,
        dedup_capacity: int = 100_000,
    ) -> None:
        if max_attempts < 1 or lease_seconds <= 0:
            raise ValueError("scheduler retry and lease limits must be positive")
        if queue_capacity < 1 or dedup_capacity < 1:
            raise ValueError("scheduler capacities must be positive")
        self.registry = registry
        self.max_attempts = max_attempts
        self.lease_seconds = lease_seconds
        self.queue_capacity = queue_capacity
        self.dedup_capacity = dedup_capacity
        self._queue: deque[DistributedJob] = deque()
        self._assigned: dict[str, _AssignmentState] = {}
        self._attempts: dict[str, int] = {}
        self._seen: OrderedDict[str, str] = OrderedDict()
        self._completed = 0
        self._failed = 0
        self._lock = threading.RLock()

    def submit(self, job: DistributedJob) -> bool:
        with self._lock:
            if job.idempotency_key in self._seen:
                return False
            if len(self._queue) >= self.queue_capacity:
                raise RuntimeError("distributed scheduler queue is at capacity")
            self._seen[job.idempotency_key] = job.job_id
            while len(self._seen) > self.dedup_capacity:
                self._seen.popitem(last=False)
            self._attempts.setdefault(job.job_id, 0)
            self._queue.append(job)
            return True

    def schedule(self) -> JobAssignment | None:
        with self._lock:
            for _ in range(len(self._queue)):
                job = self._queue.popleft()
                worker = self.registry.reserve(job.requested_capabilities)
                if worker is None:
                    self._queue.append(job)
                    continue
                attempt = self._attempts.get(job.job_id, 0) + 1
                self._attempts[job.job_id] = attempt
                assigned = datetime.now(timezone.utc)
                assignment = JobAssignment(
                    assignment_id=f"assignment-{uuid4().hex}",
                    job_id=job.job_id,
                    worker_id=worker.worker_id,
                    attempt=attempt,
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
                return assignment
            return None

    def complete(self, assignment_id: str) -> bool:
        with self._lock:
            state = self._assigned.pop(assignment_id, None)
            if state is None:
                return False
            self.registry.release(state.assignment.worker_id)
            self._completed += 1
            return True

    def fail(self, assignment_id: str, *, retryable: bool = True) -> bool:
        with self._lock:
            state = self._assigned.pop(assignment_id, None)
            if state is None:
                return False
            self.registry.release(state.assignment.worker_id)
            if (
                retryable
                and state.assignment.attempt < self.max_attempts
                and len(self._queue) < self.queue_capacity
            ):
                self._queue.appendleft(state.job)
            else:
                self._failed += 1
            return True

    def recover_worker(self, worker_id: str) -> int:
        with self._lock:
            assignment_ids = [
                assignment_id
                for assignment_id, state in self._assigned.items()
                if state.assignment.worker_id == worker_id
            ]
            for assignment_id in assignment_ids:
                self.fail(assignment_id, retryable=True)
            return len(assignment_ids)

    def recover_expired(self, *, now: datetime | None = None) -> int:
        current = now or datetime.now(timezone.utc)
        with self._lock:
            expired = [
                assignment_id
                for assignment_id, state in self._assigned.items()
                if datetime.fromisoformat(state.assignment.lease_deadline.replace("Z", "+00:00"))
                <= current
            ]
            for assignment_id in expired:
                self.fail(assignment_id, retryable=True)
            return len(expired)

    def snapshot(self) -> SchedulerSnapshot:
        with self._lock:
            return SchedulerSnapshot(
                queued=len(self._queue),
                assigned=len(self._assigned),
                completed=self._completed,
                failed=self._failed,
                seen_jobs=len(self._seen),
            )


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
