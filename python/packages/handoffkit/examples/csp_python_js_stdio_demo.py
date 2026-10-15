"""Offline Python-to-JavaScript HK-CSP stdio interoperability demo."""

from __future__ import annotations

import asyncio
import json
import shutil
from pathlib import Path

from handoffkit import HandoffState
from handoffkit.csp import (
    MessageEnvelope,
    RuntimeMode,
    SessionConfig,
    SubprocessStdioTransport,
    make_envelope,
)


async def run_demo() -> dict[str, object]:
    node = shutil.which("node")
    if node is None:
        raise RuntimeError("Node.js is required for the Python/JS stdio demo.")

    root = Path(__file__).resolve().parents[4]
    worker = root / "js" / "packages" / "node" / "examples" / "csp_worker.mjs"
    transport = await SubprocessStdioTransport.spawn([node, str(worker)], cwd=str(root))
    config = SessionConfig(session_id="python-js-demo", runtime_mode=RuntimeMode.SESSION)
    opening = make_envelope(
        session_id=config.session_id,
        channel="control",
        source="python-demo",
        sequence=0,
        kind="session_open",
        payload_type="json",
        payload={
            "protocol_version": "1.0",
            "runtime": "python",
            "session_config": config.to_dict(),
            "capabilities": ["handoff_state", "request_response"],
        },
        idempotency_key="python-js-open",
    )
    state = HandoffState(
        task="Verify cross-runtime HK-CSP",
        from_agent="python",
        to_agent="javascript",
        summary="Canonical snake_case state crosses stdio as NDJSON.",
        decisions=["Keep stdout protocol-only"],
        next_steps=["Return the same structured state"],
    ).validate()
    envelope = make_envelope(
        session_id=config.session_id,
        channel="requests",
        source="python-demo",
        target="javascript-worker",
        sequence=1,
        kind="request",
        payload_type="handoff_state",
        payload=state.to_dict(),
        idempotency_key="python-js-demo-1",
    )
    try:
        await transport.send(opening)
        ready = await transport.receive()
        if ready.kind != "session_ready" or ready.correlation_id != opening.message_id:
            raise RuntimeError("JavaScript worker did not complete HK-CSP handshake.")
        await transport.send(envelope)
        response = await transport.receive()
        if response.correlation_id != envelope.message_id:
            raise RuntimeError("JavaScript worker response did not match the request.")
        closing = MessageEnvelope(
            message_id="python-js-close",
            session_id=config.session_id,
            channel="control",
            kind="session_close",
            source="python-demo",
            target="javascript-worker",
            sequence=2,
            payload_type="json",
            payload={},
            idempotency_key="python-js-close",
        )
        await transport.send(closing)
        closed = await transport.receive()
        if closed.kind != "session_closed" or closed.correlation_id != closing.message_id:
            raise RuntimeError("JavaScript worker did not close cleanly.")
    finally:
        await transport.close()

    returned = HandoffState.from_dict(response.payload["handoff_state"])
    returned.validate()
    return {
        "success": returned.to_dict() == state.to_dict(),
        "session_id": response.session_id,
        "source_runtime": "python",
        "target_runtime": response.payload["runtime"],
        "payload_type": response.payload_type,
        "handshake": ready.kind,
    }


if __name__ == "__main__":
    print(json.dumps(asyncio.run(run_demo()), indent=2))
