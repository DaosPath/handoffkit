"""Real TCP/TLS smoke test for handoffkit-cpp-ml-worker --tls-policy.

The test deliberately drives the executable, rather than a mock or an in-process
helper. It proves certificate-bound identity, local capability authorization,
framing, replay persistence, and the structured capability-claim rejection.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import socket
import ssl
import struct
import subprocess
import sys
import time
from tempfile import mkdtemp

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID, ObjectIdentifier


SPIFFE_URI = ObjectIdentifier("1.3.6.1.5.5.7.8.5")


def _key() -> rsa.RSAPrivateKey:
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def _write_key(path: Path, key: rsa.RSAPrivateKey) -> None:
    path.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.TraditionalOpenSSL,
            serialization.NoEncryption(),
        )
    )


def _write_cert(path: Path, cert: x509.Certificate) -> None:
    path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))


def _certificate(
    *,
    subject: str,
    key: rsa.RSAPrivateKey,
    issuer: x509.Name,
    issuer_key: rsa.RSAPrivateKey,
    ca: bool,
    san: list[str],
) -> x509.Certificate:
    now = dt.datetime.now(dt.timezone.utc)
    builder = (
        x509.CertificateBuilder()
        .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, subject)]))
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - dt.timedelta(minutes=1))
        .not_valid_after(now + dt.timedelta(days=2))
        .add_extension(x509.BasicConstraints(ca=ca, path_length=1 if ca else None), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=True,
                content_commitment=False,
                key_encipherment=not ca,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=ca,
                crl_sign=ca,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        .add_extension(x509.SubjectKeyIdentifier.from_public_key(key.public_key()), critical=False)
    )
    if not ca:
        builder = builder.add_extension(
            x509.AuthorityKeyIdentifier.from_issuer_public_key(issuer_key.public_key()),
            critical=False,
        )
    if san:
        builder = builder.add_extension(
            x509.SubjectAlternativeName(
                [x509.DNSName(value) if not value.startswith("spiffe://") else x509.UniformResourceIdentifier(value)
                 for value in san]
            ),
            critical=False,
        )
    if not ca:
        builder = builder.add_extension(
            x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH, ExtendedKeyUsageOID.CLIENT_AUTH]),
            critical=False,
        )
    return builder.sign(issuer_key, hashes.SHA256())


def _frame_send(sock: ssl.SSLSocket, value: dict) -> None:
    encoded = json.dumps(value, separators=(",", ":")).encode("utf-8")
    sock.sendall(struct.pack("!I", len(encoded)) + encoded)


def _frame_recv(sock: ssl.SSLSocket) -> dict:
    header = b""
    while len(header) < 4:
        chunk = sock.recv(4 - len(header))
        if not chunk:
            raise RuntimeError("worker closed before a CSP frame header")
        header += chunk
    size = struct.unpack("!I", header)[0]
    payload = b""
    while len(payload) < size:
        chunk = sock.recv(size - len(payload))
        if not chunk:
            raise RuntimeError("worker closed before a CSP frame payload")
        payload += chunk
    return json.loads(payload)


def _envelope(sequence: int, nonce: str, *, metadata: dict | None = None) -> dict:
    created = dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    return {
        "protocol_version": "1.0",
        "message_id": f"direct-{sequence}",
        "session_id": "direct-session",
        "channel": "control",
        "kind": "worker_capabilities",
        "source": "client",
        "target": "cpp-ml-worker-direct",
        "sequence": sequence,
        "created_at": created,
        "deadline": None,
        "correlation_id": None,
        "causation_id": None,
        "idempotency_key": f"direct-idempotency-{sequence}",
        "attempt": 1,
        "requires_ack": False,
        "payload_type": "worker_capabilities",
        "payload": {},
        "metadata": {"nonce": nonce, **(metadata or {})},
    }


def _connect(context: ssl.SSLContext, port: int) -> ssl.SSLSocket:
    deadline = time.monotonic() + 15
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            raw = socket.create_connection(("127.0.0.1", port), timeout=2)
            return context.wrap_socket(raw, server_hostname="localhost")
        except (ConnectionRefusedError, TimeoutError, OSError) as error:
            last_error = error
            time.sleep(0.1)
    raise RuntimeError(f"worker did not accept a TLS connection: {last_error}")


def main() -> int:
    worker = Path(sys.argv[1]).resolve()
    scratch_parent = Path(os.environ.get("HANDOFFKIT_TEST_SCRATCH", worker.parents[2] / ".local-tests"))
    scratch_parent.mkdir(parents=True, exist_ok=True)
    root = Path(mkdtemp(prefix="cpp-ml-tls-worker-", dir=scratch_parent))
    process: subprocess.Popen[bytes] | None = None
    try:
        ca_key = _key()
        ca_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "HandoffKit cpp-ml direct CA")])
        ca = _certificate(subject="HandoffKit cpp-ml direct CA", key=ca_key, issuer=ca_name, issuer_key=ca_key, ca=True, san=[])
        server_key = _key()
        server = _certificate(
            subject="cpp-ml-server",
            key=server_key,
            issuer=ca.subject,
            issuer_key=ca_key,
            ca=False,
            san=["localhost", "spiffe://handoffkit.internal/peer/server/node/cpp-ml-server"],
        )
        client_key = _key()
        client = _certificate(
            subject="cpp-ml-client",
            key=client_key,
            issuer=ca.subject,
            issuer_key=ca_key,
            ca=False,
            san=["spiffe://handoffkit.internal/peer/client/node/cpp-ml-client/worker/direct-client"],
        )
        ca_path = root / "ca.pem"
        server_cert = root / "server.pem"
        server_key_path = root / "server.key"
        client_cert = root / "client.pem"
        client_key_path = root / "client.key"
        _write_cert(ca_path, ca)
        _write_cert(server_cert, server)
        _write_key(server_key_path, server_key)
        _write_cert(client_cert, client)
        _write_key(client_key_path, client_key)
        output_root = root / "output"
        output_root.mkdir()
        (output_root / "snapshots").mkdir()
        probe = socket.socket()
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
        probe.close()
        fingerprint = "sha256:" + hashlib.sha256(client.public_bytes(serialization.Encoding.DER)).hexdigest()
        policy = {
            "format": "handoffkit-cpp-ml-worker-tls-policy",
            "version": 1,
            "worker_id": "cpp-ml-worker-direct",
            "worker_threads": 1,
            "queue_capacity": 4,
            "output_root": str(output_root),
            "hash_required": True,
            "signature_requirement": "optional",
            "max_size_bytes": 1048576,
            "allowed_roots": [str(output_root)],
            "snapshot_directory": str(output_root / "snapshots"),
            "durable_state_path": str(root / "scheduler.json"),
            "replay_state_path": str(root / "replay.json"),
            "auto_resume": False,
            "dispatcher_operations": ["worker:inspect", "job:training", "job:evaluation", "job:cancel", "session:close"],
            "bind_host": "127.0.0.1",
            "port": port,
            "tls": {
                "security": {
                    "profile": "standard",
                    "require_mtls": True,
                    "trust_domain": "handoffkit.internal",
                    "ca_cert_path": str(ca_path),
                    "cert_path": str(server_cert),
                    "key_path": str(server_key_path),
                },
                "server_name": "localhost",
                "timeout_ms": 5000,
                "peer_policy": {
                    "expected_peer_id": "client",
                    "expected_node_id": "cpp-ml-client",
                    "expected_worker_id": "direct-client",
                    "capabilities_by_fingerprint": {
                        fingerprint: ["worker:inspect", "job:training", "job:evaluation", "job:cancel", "session:close"]
                    },
                },
            },
        }
        policy_path = root / "tls-policy.json"
        policy_path.write_text(json.dumps(policy), encoding="utf-8")
        process = subprocess.Popen(
            [str(worker), "--tls-policy", str(policy_path)],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
        context = ssl.create_default_context(ssl.Purpose.SERVER_AUTH, cafile=str(ca_path))
        context.minimum_version = ssl.TLSVersion.TLSv1_3
        context.maximum_version = ssl.TLSVersion.TLSv1_3
        context.load_cert_chain(certfile=str(client_cert), keyfile=str(client_key_path))
        try:
            connection = _connect(context, port)
        except Exception as error:
            if process is not None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
                stderr = process.stderr.read().decode("utf-8", errors="replace") if process.stderr else ""
                raise RuntimeError(f"{error}\nworker stderr:\n{stderr}") from error
        with connection:
            _frame_send(connection, _envelope(1, "direct-nonce-1"))
            response = _frame_recv(connection)
            assert response["kind"] == "worker_capabilities", response
            assert response["source"] == "cpp-ml-worker-direct", response
            assert response["payload"]["worker_id"] == "cpp-ml-worker-direct", response
            _frame_send(connection, _envelope(2, "direct-nonce-2", metadata={"capabilities": ["*"]}))
            rejected = _frame_recv(connection)
            assert rejected["payload"]["code"] == "capability_claim_rejected", rejected

        # A fresh TLS session with the same credential/session/sequence is
        # rejected by the durable replay state, not merely process-local RAM.
        with _connect(context, port) as connection:
            _frame_send(connection, _envelope(1, "direct-nonce-1"))
            replay = _frame_recv(connection)
            assert replay["payload"]["code"] == "replay_sequence", replay

        # A real process restart must reload the same durable replay ledger;
        # process-local RAM alone is not sufficient for the security gate.
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
        if process.returncode not in (0, -15, 1):
            stderr = process.stderr.read().decode("utf-8", errors="replace") if process.stderr else ""
            raise RuntimeError(f"cpp-ml worker restart exited unexpectedly: {process.returncode}\n{stderr}")
        process = subprocess.Popen(
            [str(worker), "--tls-policy", str(policy_path)],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
        with _connect(context, port) as connection:
            _frame_send(connection, _envelope(1, "direct-nonce-1"))
            restarted_replay = _frame_recv(connection)
            assert restarted_replay["payload"]["code"] == "replay_sequence", restarted_replay
        print("[PASS] cpp-ml direct TLS worker TCP/CSP/replay/capability integration")
        return 0
    finally:
        if process is not None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
            if process.returncode not in (0, -15, 1):
                stderr = process.stderr.read().decode("utf-8", errors="replace") if process.stderr else ""
                raise RuntimeError(f"cpp-ml worker exited unexpectedly: {process.returncode}\n{stderr}")
        for path in sorted(root.rglob("*"), reverse=True):
            if path.is_file() or path.is_symlink():
                path.unlink(missing_ok=True)
            elif path.is_dir():
                path.rmdir()
        root.rmdir()


if __name__ == "__main__":
    raise SystemExit(main())
