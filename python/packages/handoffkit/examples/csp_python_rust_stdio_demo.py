"""Offline Python-to-Rust HK-CSP stdio interoperability demo."""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path

from handoffkit.csp import (
    MessageEnvelope,
    RuntimeMode,
    SessionConfig,
    SubprocessStdioTransport,
    make_envelope,
)


def rust_binary() -> Path:
    root = Path(__file__).resolve().parents[3]
    default = (
        root
        / "packages"
        / "rust"
        / "target"
        / "debug"
        / ("handoffkit-rs.exe" if os.name == "nt" else "handoffkit-rs")
    )
    return Path(os.environ.get("HANDOFFKIT_RUST_BIN", default)).resolve()


async def run_demo() -> dict[str, object]:
    binary = rust_binary()
    if not binary.is_file():
        raise RuntimeError(f"Rust worker binary not found: {binary}. Run cargo build first.")
    config = SessionConfig(session_id="python-rust-demo", runtime_mode=RuntimeMode.SESSION)
    transport = await SubprocessStdioTransport.spawn([str(binary), "csp", "worker"])
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
            "capabilities": ["request_response"],
        },
        idempotency_key="python-rust-open",
    )
    request = make_envelope(
        session_id=config.session_id,
        channel="requests",
        source="python-demo",
        target="rust-worker",
        sequence=1,
        kind="request",
        payload_type="json",
        payload={"task": "Python starts a Rust HK-CSP worker"},
        idempotency_key="python-rust-request",
    )
    try:
        await transport.send(opening)
        ready = await transport.receive()
        if ready.kind != "session_ready" or ready.correlation_id != opening.message_id:
            raise RuntimeError("Rust worker did not complete HK-CSP handshake.")
        await transport.send(request)
        response = await transport.receive()
        if response.correlation_id != request.message_id:
            raise RuntimeError("Rust worker response did not match the request.")
        closing = MessageEnvelope(
            message_id="python-rust-close",
            session_id=config.session_id,
            channel="control",
            kind="session_close",
            source="python-demo",
            target="rust-worker",
            sequence=2,
            payload_type="json",
            payload={},
            idempotency_key="python-rust-close",
        )
        await transport.send(closing)
        closed = await transport.receive()
        if closed.correlation_id != closing.message_id:
            raise RuntimeError("Rust worker close response was not correlated.")
    finally:
        await transport.close()
    return {
        "success": response.kind == "result" and closed.kind == "session_closed",
        "source_runtime": "python",
        "target_runtime": ready.payload["peer_runtime"],
        "payload": response.payload,
    }


if __name__ == "__main__":
    print(json.dumps(asyncio.run(run_demo()), indent=2))
