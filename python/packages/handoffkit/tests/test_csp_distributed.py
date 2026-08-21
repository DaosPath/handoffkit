from __future__ import annotations

import asyncio
import json
import socket
import struct
from datetime import datetime, timezone
from pathlib import Path

import pytest

from handoffkit.csp import (
    DistributedJob,
    DistributedScheduler,
    FileDedupStore,
    JobAssignment,
    LengthDelimitedTransport,
    MessageTooLargeError,
    NetworkConfig,
    RetryPolicy,
    TcpTransport,
    WorkerCapabilities,
    WorkerHeartbeat,
    WorkerRegistry,
    WorkerStatus,
    make_envelope,
)

CONTRACTS = Path(__file__).resolve().parents[4] / "shared" / "contracts"


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
