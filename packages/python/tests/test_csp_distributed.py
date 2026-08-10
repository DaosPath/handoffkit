from __future__ import annotations

import asyncio
import json
import shutil
import socket
import struct
from datetime import datetime, timezone
from pathlib import Path

import pytest

from handoffkit.csp import (
    DistributedJob,
    DistributedScheduler,
    FileDedupStore,
    FileSchedulerStateStore,
    JobAssignment,
    LengthDelimitedTransport,
    MessageTooLargeError,
    NetworkConfig,
    RetryPolicy,
    SecurityError,
    TcpTransport,
    WorkerCapabilities,
    WorkerHeartbeat,
    WorkerRegistry,
    WorkerStatus,
    make_envelope,
)

CONTRACTS = Path(__file__).resolve().parents[2] / "contracts"


@pytest.mark.monorepo
@pytest.mark.parametrize(
    ("name", "contract"),
    [
        ("worker_heartbeat.json", WorkerHeartbeat),
        ("distributed_job.json", DistributedJob),
        ("job_assignment.json", JobAssignment),
    ],
)
def test_distributed_contract_fixtures_roundtrip(name: str, contract: type) -> None:
    data = json.loads((CONTRACTS / "fixtures" / name).read_text("utf-8"))
    assert contract.from_dict(data).to_dict() == data


def worker(worker_id: str = "worker-1") -> WorkerCapabilities:
    return WorkerCapabilities(
        worker_id=worker_id,
        runtime="python",
        os="test",
        architecture="x86_64",
        cpu_cores=4,
        memory_bytes=1024,
        operations=["evaluate"],
    )


def test_registry_heartbeat_expiry_and_routing() -> None:
    now = [0.0]
    registry = WorkerRegistry(suspect_after=5, offline_after=10, clock=lambda: now[0])
    registry.register(worker())
    assert registry.reserve(["evaluate"]).active_jobs == 1  # type: ignore[union-attr]
    registry.release("worker-1")
    assert registry.heartbeat(WorkerHeartbeat("worker-1", 1, 0, 0.25, "2026-01-01T00:00:00Z"))
    assert not registry.heartbeat(WorkerHeartbeat("worker-1", 1, 0, 0.5, "2026-01-01T00:00:01Z"))
    now[0] = 6
    registry.expire()
    assert registry.get("worker-1").status is WorkerStatus.SUSPECT  # type: ignore[union-attr]
    now[0] = 11
    registry.expire()
    assert registry.get("worker-1").status is WorkerStatus.OFFLINE  # type: ignore[union-attr]


def test_scheduler_recovers_failed_and_expired_assignments() -> None:
    registry = WorkerRegistry()
    registry.register(worker())
    scheduler = DistributedScheduler(registry, max_attempts=2, lease_seconds=1)
    job = DistributedJob("job-1", "evaluate", {"input": 1}, ["evaluate"], "key-1")
    assert scheduler.submit(job)
    assert not scheduler.submit(job)
    first = scheduler.schedule()
    assert first is not None
    assert scheduler.fail(first.assignment_id)
    second = scheduler.schedule()
    assert second is not None and second.attempt == 2
    assert scheduler.recover_expired(now=datetime.max.replace(tzinfo=timezone.utc)) == 1
    assert scheduler.snapshot().failed == 1


def test_scheduler_rejects_exactly_once_request_before_deduplication() -> None:
    registry = WorkerRegistry()
    scheduler = DistributedScheduler(registry)
    job = DistributedJob(
        "job-exactly-once",
        "evaluate",
        {},
        [],
        "key-exactly-once",
        metadata={"require_exactly_once": True},
    )
    with pytest.raises(SecurityError) as caught:
        scheduler.submit(job)
    assert caught.value.code == "exactly_once_unavailable"
    assert caught.value.details == {"runtime": "python"}
    assert scheduler.snapshot().seen_jobs == 0


def test_scheduler_retry_never_exceeds_queue_capacity() -> None:
    registry = WorkerRegistry()
    registry.register(worker())
    scheduler = DistributedScheduler(registry, queue_capacity=1)
    assert scheduler.submit(DistributedJob("job-1", "evaluate", {}, ["evaluate"], "key-1"))
    assignment = scheduler.schedule()
    assert assignment is not None
    assert scheduler.submit(DistributedJob("job-2", "evaluate", {}, ["evaluate"], "key-2"))
    assert scheduler.fail(assignment.assignment_id)
    snapshot = scheduler.snapshot()
    assert snapshot.queued == 1
    assert snapshot.failed == 1


def test_durable_scheduler_marks_inflight_interrupted_and_requires_explicit_retry(
    tmp_path: Path,
) -> None:
    state_path = tmp_path / "scheduler-state.json"
    first_registry = WorkerRegistry()
    first_registry.register(worker("worker-first"))
    first = DistributedScheduler(
        first_registry,
        max_attempts=3,
        state_store=FileSchedulerStateStore(state_path),
    )
    job = DistributedJob("job-durable", "evaluate", {"input": 1}, ["evaluate"], "key-durable")
    assert first.submit(job)
    initial_assignment = first.schedule()
    assert initial_assignment is not None and initial_assignment.attempt == 1

    second_registry = WorkerRegistry()
    second_registry.register(worker("worker-second"))
    second = DistributedScheduler(
        second_registry,
        max_attempts=3,
        state_store=FileSchedulerStateStore(state_path),
    )
    assert second.snapshot() == second.snapshot().__class__(0, 0, 1, 0, 0, 1)
    assert not second.submit(job)
    assert [item.assignment_id for item in second.list_interrupted()] == [
        initial_assignment.assignment_id
    ]
    assert second.retry_interrupted(initial_assignment.assignment_id)
    retry = second.schedule()
    assert retry is not None and retry.attempt == 2
    assert second.complete(retry.assignment_id)

    third = DistributedScheduler(
        WorkerRegistry(),
        max_attempts=3,
        state_store=FileSchedulerStateStore(state_path),
    )
    snapshot = third.snapshot()
    assert snapshot.queued == snapshot.assigned == snapshot.interrupted == 0
    assert snapshot.completed == 1
    assert snapshot.seen_jobs == 1


def test_durable_scheduler_opt_in_auto_resume_is_at_least_once(tmp_path: Path) -> None:
    state_path = tmp_path / "scheduler-state.json"
    first_registry = WorkerRegistry()
    first_registry.register(worker("worker-first"))
    first = DistributedScheduler(
        first_registry,
        max_attempts=3,
        state_store=FileSchedulerStateStore(state_path),
    )
    job = DistributedJob("job-auto", "evaluate", {}, ["evaluate"], "key-auto")
    assert first.submit(job)
    initial = first.schedule()
    assert initial is not None

    second_registry = WorkerRegistry()
    second_registry.register(worker("worker-second"))
    resumed = DistributedScheduler(
        second_registry,
        max_attempts=3,
        state_store=FileSchedulerStateStore(state_path),
        auto_resume=True,
    )
    assert resumed.snapshot().interrupted == 0
    assert resumed.snapshot().queued == 1
    retry = resumed.schedule()
    assert retry is not None and retry.attempt == 2


def test_durable_scheduler_migrates_supported_v0_envelope(tmp_path: Path) -> None:
    state_path = tmp_path / "scheduler-state.json"
    first_registry = WorkerRegistry()
    first_registry.register(worker("worker-first"))
    first = DistributedScheduler(
        first_registry,
        state_store=FileSchedulerStateStore(state_path),
    )
    assert first.submit(DistributedJob("job-v0", "evaluate", {}, [], "key-v0"))
    assert first.schedule() is not None
    payload = json.loads(state_path.read_text("utf-8"))
    payload.pop("checksum")
    payload.pop("interrupted", None)
    payload["format_version"] = 0
    FileSchedulerStateStore(state_path).commit(payload)

    migrated = DistributedScheduler(
        WorkerRegistry(),
        state_store=FileSchedulerStateStore(state_path),
    )
    assert migrated.snapshot().interrupted == 1
    persisted = json.loads(state_path.read_text("utf-8"))
    assert persisted["format_version"] == 1
    assert "interrupted" in persisted


def test_durable_scheduler_quarantines_checksum_tamper(tmp_path: Path) -> None:
    state_path = tmp_path / "scheduler-state.json"
    scheduler = DistributedScheduler(
        WorkerRegistry(),
        state_store=FileSchedulerStateStore(state_path),
    )
    assert scheduler.submit(DistributedJob("job-1", "evaluate", {}, [], "key-1"))
    value = json.loads(state_path.read_text("utf-8"))
    value["completed"] = 99
    state_path.write_text(json.dumps(value), encoding="utf-8")

    with pytest.raises(SecurityError) as raised:
        DistributedScheduler(
            WorkerRegistry(),
            state_store=FileSchedulerStateStore(state_path),
        )
    assert raised.value.code == "security_state_corrupt"
    assert list(tmp_path.glob("scheduler-state.json.corrupt-*"))


def test_scheduler_state_commit_failure_rolls_back_submit() -> None:
    class FailingStore:
        def load(self) -> None:
            return None

        def commit(self, _payload: object) -> None:
            raise RuntimeError("storage unavailable")

        def quarantine(self, _reason: str) -> None:
            raise AssertionError("quarantine should not run")

    scheduler = DistributedScheduler(WorkerRegistry(), state_store=FailingStore())
    with pytest.raises(RuntimeError, match="storage unavailable"):
        scheduler.submit(DistributedJob("job-1", "evaluate", {}, [], "key-1"))
    assert scheduler.snapshot().queued == 0
    assert scheduler.snapshot().seen_jobs == 0


def test_scheduler_state_post_commit_error_keeps_committed_mutation() -> None:
    class CommittedStore:
        def load(self) -> None:
            return None

        def commit(self, _payload: object) -> None:
            raise SecurityError(
                "directory sync uncertain",
                code="scheduler_state_durability_uncertain",
                details={"committed": True},
            )

        def quarantine(self, _reason: str) -> None:
            raise AssertionError("quarantine should not run")

    scheduler = DistributedScheduler(WorkerRegistry(), state_store=CommittedStore())
    job = DistributedJob("job-1", "evaluate", {}, [], "key-1")
    with pytest.raises(SecurityError) as raised:
        scheduler.submit(job)
    assert raised.value.code == "scheduler_state_durability_uncertain"
    assert scheduler.snapshot().queued == 1
    assert scheduler.snapshot().seen_jobs == 1
    assert scheduler.state_generation == 1
    assert not scheduler.submit(job)


def test_scheduler_never_evicts_active_dedup_identity() -> None:
    scheduler = DistributedScheduler(
        WorkerRegistry(),
        queue_capacity=2,
        dedup_capacity=1,
    )
    assert scheduler.submit(DistributedJob("job-1", "evaluate", {}, [], "key-1"))
    assert not scheduler.submit(DistributedJob("job-1", "evaluate", {}, [], "key-2"))
    with pytest.raises(RuntimeError, match="deduplication state is at capacity"):
        scheduler.submit(DistributedJob("job-2", "evaluate", {}, [], "key-2"))
    assert scheduler.snapshot().queued == 1
    assert scheduler.snapshot().seen_jobs == 1


def test_python_loads_shared_durable_scheduler_fixture(tmp_path: Path) -> None:
    fixture = CONTRACTS / "test-fixtures" / "runtime" / "durable-scheduler-v1.json"
    state_path = tmp_path / "scheduler-state.json"
    shutil.copyfile(fixture, state_path)
    state_path.chmod(0o600)
    scheduler = DistributedScheduler(
        WorkerRegistry(),
        max_attempts=3,
        queue_capacity=16,
        dedup_capacity=32,
        state_store=FileSchedulerStateStore(state_path),
    )
    snapshot = scheduler.snapshot()
    assert snapshot == snapshot.__class__(1, 0, 1, 2, 1, 3)
    assert scheduler.state_generation == 7
    assert [item.assignment_id for item in scheduler.list_interrupted()] == [
        "assignment-scheduler-interrupted"
    ]


def test_scheduler_state_backup_restore_preserves_validated_state(tmp_path: Path) -> None:
    state_path = tmp_path / "scheduler-state.json"
    backup_path = tmp_path / "backups" / "scheduler-state.json"
    store = FileSchedulerStateStore(state_path)
    scheduler = DistributedScheduler(WorkerRegistry(), state_store=store)
    assert scheduler.submit(DistributedJob("job-backup", "evaluate", {}, [], "key-backup"))

    store.backup(backup_path)
    assert backup_path.exists()
    state_path.unlink()
    store.restore(backup_path)

    restored = DistributedScheduler(
        WorkerRegistry(), state_store=FileSchedulerStateStore(state_path)
    )
    assert restored.snapshot().queued == 1
    assert restored.snapshot().seen_jobs == 1


def test_file_dedup_store_survives_restart_and_releases_retry(tmp_path: Path) -> None:
    path = tmp_path / "dedup.ndjson"
    first = FileDedupStore(path, capacity=2)
    assert first.claim("key-1")
    assert not first.claim("key-1")
    second = FileDedupStore(path, capacity=2)
    assert second.contains("key-1")
    assert second.release("key-1")
    assert FileDedupStore(path, capacity=2).claim("key-1")


def test_tcp_length_framing_and_oversize_guard() -> None:
    async def scenario() -> None:
        handled = asyncio.Event()

        async def echo(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
            transport = LengthDelimitedTransport(reader, writer)
            envelope = await transport.receive()
            await transport.send(envelope)
            await transport.close()
            handled.set()

        server = await asyncio.start_server(echo, "127.0.0.1", 0)
        port = server.sockets[0].getsockname()[1]
        client = await TcpTransport.connect("127.0.0.1", port)
        envelope = make_envelope(
            session_id="network",
            channel="tasks",
            source="python",
            payload_type="json",
            payload={"ok": True},
            sequence=1,
        )
        await client.send(envelope)
        assert (await client.receive()).to_dict() == envelope.to_dict()
        await client.close()
        await asyncio.wait_for(handled.wait(), 2)
        server.close()
        await server.wait_closed()

        async def oversized(_reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
            writer.write(struct.pack(">I", 4097))
            await writer.drain()
            writer.close()

        config = NetworkConfig(max_message_bytes=4096)
        server = await asyncio.start_server(oversized, "127.0.0.1", 0)
        port = server.sockets[0].getsockname()[1]
        client = await TcpTransport.connect("127.0.0.1", port, config=config)
        with pytest.raises(MessageTooLargeError):
            await client.receive()
        await client.close()
        server.close()
        await server.wait_closed()

    asyncio.run(scenario())


def test_tcp_retry_connects_when_server_appears() -> None:
    async def scenario() -> None:
        probe = socket.socket()
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
        probe.close()
        holder: list[asyncio.AbstractServer] = []

        async def start_later() -> None:
            await asyncio.sleep(0.04)
            holder.append(
                await asyncio.start_server(
                    lambda _reader, writer: writer.close(),
                    "127.0.0.1",
                    port,
                )
            )

        starter = asyncio.create_task(start_later())
        config = NetworkConfig(
            connect_timeout_ms=100,
            retry_policy=RetryPolicy(
                max_attempts=5,
                base_delay_ms=20,
                max_delay_ms=50,
            ),
        )
        client = await TcpTransport.connect_with_retry(
            "127.0.0.1",
            port,
            config=config,
        )
        await client.close()
        await starter
        for server in holder:
            server.close()
            await server.wait_closed()

    asyncio.run(scenario())
