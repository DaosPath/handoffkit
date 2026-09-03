#!/usr/bin/env python3
"""Real Python TLS 1.3+mTLS client for the C++ cpp-ml interop gate."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import socket
import ssl
import struct


def frame_send(connection: ssl.SSLSocket, value: dict) -> None:
    payload = json.dumps(value, separators=(",", ":")).encode("utf-8")
    connection.sendall(struct.pack("!I", len(payload)) + payload)


def read_exact(connection: ssl.SSLSocket, size: int) -> bytes:
    data = bytearray()
    while len(data) < size:
        chunk = connection.recv(size - len(data))
        if not chunk:
            raise RuntimeError("TLS peer closed before a complete frame")
        data.extend(chunk)
    return bytes(data)


def frame_receive(connection: ssl.SSLSocket) -> dict:
    size = struct.unpack("!I", read_exact(connection, 4))[0]
    if size > 8 * 1024 * 1024:
        raise RuntimeError(f"response frame too large: {size}")
    return json.loads(read_exact(connection, size))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--ca", required=True)
    parser.add_argument("--cert", required=True)
    parser.add_argument("--key", required=True)
    parser.add_argument("--worker", default="cpp-ml-worker-interoperability")
    parser.add_argument("--source", default="client-peer")
    parser.add_argument("--session", default="python-cpp-tcp")
    parser.add_argument("--nonce", default="python-cpp-tcp-nonce")
    args = parser.parse_args()

    context = ssl.create_default_context(ssl.Purpose.SERVER_AUTH, cafile=args.ca)
    context.minimum_version = ssl.TLSVersion.TLSv1_3
    context.maximum_version = ssl.TLSVersion.TLSv1_3
    context.load_cert_chain(certfile=args.cert, keyfile=args.key)
    with socket.create_connection((args.host, args.port), timeout=10) as raw:
        with context.wrap_socket(raw, server_hostname="localhost") as connection:
            if connection.version() != "TLSv1.3" or not connection.getpeercert():
                raise RuntimeError("Python TLS policy mismatch")
            frame_send(
                connection,
                {
                    "protocol_version": "1.0",
                    "message_id": f"{args.session}-1",
                    "session_id": args.session,
                    "channel": "control",
                    "kind": "worker_capabilities",
                    "source": args.source,
                    "target": args.worker,
                    "sequence": 1,
                    "created_at": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
                    "deadline": None,
                    "correlation_id": None,
                    "causation_id": None,
                    "idempotency_key": f"{args.session}-1",
                    "attempt": 1,
                    "requires_ack": False,
                    "payload_type": "worker_capabilities",
                    "payload": {},
                    "metadata": {"nonce": args.nonce},
                },
            )
            response = frame_receive(connection)
            if response.get("kind") != "worker_capabilities" or response.get("source") != args.worker:
                raise RuntimeError(f"unexpected C++ response: {response}")
            print(json.dumps({
                "runtime": "python",
                "protocol": connection.version(),
                "authorized": True,
                "response_kind": response["kind"],
                "response_source": response["source"],
            }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
