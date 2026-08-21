"""Protocol-only Python worker used by Rust/Python HK-CSP interop tests."""

from __future__ import annotations

import sys
from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
if str(PACKAGE_ROOT) not in sys.path:
    sys.path.insert(0, str(PACKAGE_ROOT))

from handoffkit.csp import (  # noqa: E402
    DEFAULT_MAX_MESSAGE_BYTES,
    MessageEnvelope,
    SessionConfig,
)


def read_envelope() -> MessageEnvelope:
    data = sys.stdin.buffer.readline(DEFAULT_MAX_MESSAGE_BYTES + 2)
    if not data:
        raise EOFError("peer closed protocol stream")
    if len(data) > DEFAULT_MAX_MESSAGE_BYTES or not data.endswith(b"\n"):
        raise ValueError("NDJSON frame exceeds the configured limit")
    return MessageEnvelope.from_json(data.decode("utf-8"))


def write_envelope(envelope: MessageEnvelope) -> None:
    data = envelope.to_json().encode("utf-8") + b"\n"
    if len(data) > DEFAULT_MAX_MESSAGE_BYTES:
        raise ValueError("encoded envelope exceeds the configured limit")
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()


def response_for(
    incoming: MessageEnvelope,
    *,
    kind: str,
    payload: object,
    payload_type: str = "json",
) -> MessageEnvelope:
    return MessageEnvelope(
        message_id=f"python-{incoming.sequence}-{kind}",
        session_id=incoming.session_id,
        channel=incoming.channel,
        kind=kind,
        source="python-worker",
        target=incoming.source,
        sequence=incoming.sequence,
        correlation_id=incoming.message_id,
        causation_id=incoming.message_id,
        idempotency_key=f"python-response-{incoming.message_id}",
        payload_type=payload_type,
        payload=payload,
    )


def serve() -> None:
    opening = read_envelope()
    if opening.kind != "session_open":
        write_envelope(
            response_for(
                opening,
                kind="session_reject",
                payload={
                    "code": "handshake_required",
                    "message": "first message must be session_open",
                },
            )
        )
        raise ValueError("first message must be session_open")
    requested_version = str(opening.payload.get("protocol_version", ""))
    if requested_version.split(".", maxsplit=1)[0] != "1":
        write_envelope(
            response_for(
                opening,
                kind="session_reject",
                payload={
                    "code": "version_mismatch",
                    "message": "unsupported HK-CSP protocol version",
                },
            )
        )
        return
    config = SessionConfig.from_dict(opening.payload["session_config"])
    if config.session_id != opening.session_id:
        raise ValueError("handshake session IDs differ")
    write_envelope(
        response_for(
            opening,
            kind="session_ready",
            payload={
                "protocol_version": "1.0",
                "session_id": opening.session_id,
                "peer_runtime": "python",
                "capabilities": ["handoff_state", "request_response"],
            },
        )
    )

    while True:
        incoming = read_envelope()
        if incoming.session_id != config.session_id:
            write_envelope(
                response_for(
                    incoming,
                    kind="nack",
                    payload_type="delivery_nack",
                    payload={
                        "message_id": incoming.message_id,
                        "code": "session_mismatch",
                        "message": "message belongs to another session",
                        "retryable": False,
                        "processed_at": incoming.created_at,
                        "metadata": {},
                    },
                )
            )
            continue
        if incoming.kind in {"session_close", "cancel"}:
            write_envelope(
                response_for(
                    incoming,
                    kind="session_closed" if incoming.kind == "session_close" else "cancelled",
                    payload={"success": True},
                )
            )
            return
        if incoming.kind in {"data", "request", "workflow_start", "workflow_step"}:
            write_envelope(
                response_for(
                    incoming,
                    kind="result",
                    payload_type="interop_result",
                    payload={
                        "accepted_message_id": incoming.message_id,
                        "runtime": "python",
                        "handoff_state": incoming.payload,
                    },
                )
            )
            continue
        write_envelope(
            response_for(
                incoming,
                kind="nack",
                payload_type="delivery_nack",
                payload={
                    "message_id": incoming.message_id,
                    "code": "unknown_message_kind",
                    "message": "worker does not support this message kind",
                    "retryable": False,
                    "processed_at": incoming.created_at,
                    "metadata": {},
                },
            )
        )


if __name__ == "__main__":
    try:
        serve()
    except Exception as error:  # noqa: BLE001
        print(f"HK-CSP Python worker error: {error}", file=sys.stderr)
        raise SystemExit(1) from error
