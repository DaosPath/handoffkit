"""Offline Python-to-JavaScript HK-CSP stdio interoperability demo."""

from __future__ import annotations

import asyncio
import json
import shutil
from pathlib import Path

from handoffkit import HandoffState
from handoffkit.csp import SubprocessStdioTransport, make_envelope


async def run_demo() -> dict[str, object]:
    node = shutil.which("node")
    if node is None:
        raise RuntimeError("Node.js is required for the Python/JS stdio demo.")

    root = Path(__file__).resolve().parents[3]
    worker = root / "packages" / "js" / "node" / "examples" / "csp_worker.mjs"
    transport = await SubprocessStdioTransport.spawn([node, str(worker)], cwd=str(root))
    state = HandoffState(
        task="Verify cross-runtime HK-CSP",
        from_agent="python",
        to_agent="javascript",
        summary="Canonical snake_case state crosses stdio as NDJSON.",
        decisions=["Keep stdout protocol-only"],
        next_steps=["Return the same structured state"],
    ).validate()
    envelope = make_envelope(
        session_id="python-js-demo",
        channel="requests",
        source="python-demo",
        target="javascript-worker",
        sequence=1,
        payload_type="handoff_state",
        payload=state.to_dict(),
        idempotency_key="python-js-demo-1",
    )
    try:
        await transport.send(envelope)
        response = await transport.receive()
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
    }


if __name__ == "__main__":
    print(json.dumps(asyncio.run(run_demo()), indent=2))
