"""Offline HK-CSP CLI commands."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

from handoffkit.csp import (
    DEFAULT_CHANNEL_CAPACITY,
    DEFAULT_MAX_MESSAGE_BYTES,
    PROTOCOL_VERSION,
    CspRuntime,
    MessageEnvelope,
    RuntimeMode,
    make_envelope,
)


def csp_doctor() -> str:
    """Return local protocol capabilities without opening network connections."""
    return json.dumps(
        {
            "protocol": "HK-CSP",
            "protocol_version": PROTOCOL_VERSION,
            "runtime_modes": [mode.value for mode in RuntimeMode],
            "available_modes": [RuntimeMode.CLASSIC.value, RuntimeMode.SESSION.value],
            "transports": {"in_process": True, "stdio": True, "distributed": False},
            "defaults": {
                "channel_capacity": DEFAULT_CHANNEL_CAPACITY,
                "max_message_bytes": DEFAULT_MAX_MESSAGE_BYTES,
            },
        },
        indent=2,
    )


async def _run_demo() -> dict[str, object]:
    runtime = CspRuntime()
    session = runtime.create_session(session_id="csp-demo")
    session.channel("tasks", requires_ack=True)
    received: list[str] = []

    async def worker(context):  # type: ignore[no-untyped-def]
        envelope = await context.receive("tasks")
        received.append(str(envelope.payload["task"]))
        context.ack(envelope, worker="demo-worker")

    session.spawn("demo-worker", worker)
    envelope = make_envelope(
        session_id=session.session_id,
        channel="tasks",
        source="cli",
        target="demo-worker",
        sequence=1,
        payload_type="task",
        payload={"task": "preserve structured context"},
        requires_ack=True,
        idempotency_key="csp-demo-task",
    )
    ack = await session.send_with_ack("tasks", envelope)
    await session.wait()
    await session.close()
    return {
        "success": True,
        "session_id": session.session_id,
        "received": received,
        "ack": ack.to_dict(),
    }


def csp_demo() -> str:
    """Run an offline in-process session demo."""
    return json.dumps(asyncio.run(_run_demo()), indent=2)


def csp_inspect(path: str) -> str:
    """Parse and normalize one envelope JSON file."""
    envelope = MessageEnvelope.from_json(Path(path).read_text(encoding="utf-8"))
    return envelope.to_json(indent=2)
