#!/usr/bin/env python3
"""Real Python TLS 1.3+mTLS server for the reverse C++ interop gate."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import socket
import ssl
import struct


def read_exact(connection: ssl.SSLSocket, size: int) -> bytes:
    data = bytearray()
    while len(data) < size:
        chunk = connection.recv(size - len(data))
        if not chunk:
            raise RuntimeError("C++ TLS peer closed before a complete frame")
        data.extend(chunk)
    return bytes(data)


def frame_receive(connection: ssl.SSLSocket) -> dict:
    size = struct.unpack("!I", read_exact(connection, 4))[0]
    if size > 8 * 1024 * 1024:
        raise RuntimeError(f"request frame too large: {size}")
    return json.loads(read_exact(connection, size))


def frame_send(connection: ssl.SSLSocket, value: dict) -> None:
    payload = json.dumps(value, separators=(",", ":")).encode("utf-8")
    connection.sendall(struct.pack("!I", len(payload)) + payload)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--ca", required=True)
    parser.add_argument("--cert", required=True)
    parser.add_argument("--key", required=True)
    args = parser.parse_args()

    context = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
    context.minimum_version = ssl.TLSVersion.TLSv1_3
    context.maximum_version = ssl.TLSVersion.TLSv1_3
    context.verify_mode = ssl.CERT_REQUIRED
    context.load_verify_locations(cafile=args.ca)
    context.load_cert_chain(certfile=args.cert, keyfile=args.key)
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind((args.host, args.port))
        listener.listen(1)
        raw, _ = listener.accept()
        with raw, context.wrap_socket(raw, server_side=True) as connection:
            if connection.version() != "TLSv1.3" or not connection.getpeercert():
                raise RuntimeError("Python reverse TLS policy mismatch")
            request = frame_receive(connection)
            frame_send(
                connection,
                {
                    "protocol_version": "1.0",
                    "message_id": "python-reverse-response",
                    "session_id": request.get("session_id"),
                    "channel": "control",
                    "kind": "interop_echo",
                    "source": "python-server",
                    "target": request.get("source"),
                    "sequence": 1,
                    "created_at": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
                    "deadline": None,
                    "correlation_id": request.get("message_id"),
                    "causation_id": request.get("message_id"),
                    "idempotency_key": request.get("idempotency_key"),
                    "attempt": 1,
                    "requires_ack": False,
                    "payload_type": "interop_echo",
                    "payload": {"runtime": "python", "request_kind": request.get("kind")},
                    "metadata": {"nonce": "python-reverse-response"},
                },
            )
            print(json.dumps({"runtime": "python", "protocol": connection.version(), "authorized": True}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
