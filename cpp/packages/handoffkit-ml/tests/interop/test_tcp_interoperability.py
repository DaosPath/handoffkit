"""Real TCP TLS interoperability matrix against the C++ cpp-ml worker.

Each client is a separate runtime process. The test exercises TLS 1.3, mTLS,
certificate SAN authentication, length-delimited HK-CSP JSON framing, local
capability authorization, and a real worker response. It intentionally does
not use a mock server or an in-process adapter.
"""

from __future__ import annotations

import argparse
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import uuid


def repository_root() -> Path:
    return Path(__file__).resolve().parents[5]


def certificate_fingerprint(path: Path) -> str:
    from cryptography import x509
    from cryptography.hazmat.primitives import serialization

    certificate = x509.load_pem_x509_certificate(path.read_bytes())
    return "sha256:" + hashlib.sha256(
        certificate.public_bytes(serialization.Encoding.DER)
    ).hexdigest()


def generate_fixtures(output: Path, repository: Path) -> None:
    generator = repository / "shared" / "contracts" / "test-fixtures" / "tls" / "generate.py"
    # The repository fixture generator rejects output paths below the repo.
    # Generate in the OS temp area, then copy the ephemeral files into the
    # ignored release-test scratch tree.
    external = Path(tempfile.gettempdir()) / f"handoffkit-cpp-tcp-fixtures-{uuid.uuid4().hex[:10]}"
    external.mkdir()
    try:
        completed = subprocess.run(
            [sys.executable, str(generator), "--output", str(external)],
            capture_output=True,
            text=True,
            check=False,
        )
        if completed.returncode != 0:
            raise RuntimeError(
                "TLS fixture generation failed: "
                f"{completed.stdout[-1000:]} {completed.stderr[-1000:]}"
            )
        for source in external.iterdir():
            shutil.copy2(source, output / source.name)
    finally:
        shutil.rmtree(external, ignore_errors=True)


@contextmanager
def local_scratch(parent: Path):
    """Create a user-owned scratch directory under the repository.

    `tempfile.TemporaryDirectory` creates SYSTEM-only ACLs in this Windows
    runner, which prevents the real subprocesses from sharing fixture files.
    A normal mkdir keeps the workspace ACL and remains within `.local-tests`.
    """
    parent.mkdir(parents=True, exist_ok=True)
    scratch = parent / f"handoffkit-cpp-tcp-interop-{uuid.uuid4().hex[:10]}"
    scratch.mkdir()
    try:
        yield scratch
    finally:
        shutil.rmtree(scratch, ignore_errors=True)


def write_policy(root: Path, tls_root: Path, port: int, worker_id: str) -> Path:
    output = root / "output"
    snapshots = output / "snapshots"
    snapshots.mkdir(parents=True, exist_ok=True)
    client_fingerprint = certificate_fingerprint(tls_root / "client_cert.pem")
    policy = {
        "format": "handoffkit-cpp-ml-worker-tls-policy",
        "version": 1,
        "worker_id": worker_id,
        "worker_threads": 1,
        "queue_capacity": 4,
        "output_root": str(output),
        "hash_required": True,
        "signature_requirement": "optional",
        "max_size_bytes": 1048576,
        "allowed_roots": [str(output)],
        "snapshot_directory": str(snapshots),
        "durable_state_path": str(root / "scheduler.json"),
        "replay_state_path": str(root / "replay.json"),
        "auto_resume": False,
        "dispatcher_operations": ["worker:inspect"],
        "bind_host": "127.0.0.1",
        "port": port,
        "tls": {
            "security": {
                "profile": "standard",
                "require_mtls": True,
                "trust_domain": "handoffkit.internal",
                "ca_cert_path": str(tls_root / "ca_cert.pem"),
                "cert_path": str(tls_root / "server_cert.pem"),
                "key_path": str(tls_root / "server_key.pem"),
            },
            "server_name": "localhost",
            "timeout_ms": 5000,
            "peer_policy": {
                "expected_peer_id": "client-peer",
                "expected_node_id": "client-node",
                "expected_worker_id": "client-worker",
                "capabilities_by_fingerprint": {
                    client_fingerprint: ["worker:inspect", "worker_capabilities"],
                },
            },
        },
    }
    policy_path = root / "tls-policy.json"
    policy_path.write_text(json.dumps(policy, indent=2), encoding="utf-8")
    return policy_path


def client_args(root: Path, runtime: str, port: int, tls_root: Path, worker: str, session: str) -> tuple[list[str], Path]:
    common = [
        "--host", "127.0.0.1", "--port", str(port),
        "--ca", str(tls_root / "ca_cert.pem"),
        "--cert", str(tls_root / "client_cert.pem"),
        "--key", str(tls_root / "client_key.pem"),
        "--worker", worker, "--source", "client-peer", "--session", session,
        "--nonce", f"{session}-nonce",
    ]
    if runtime == "node":
        return [
            os.environ.get("HANDOFFKIT_NODE_BIN", "node"),
            str(root / "cpp" / "packages" / "handoffkit-ml" / "tests" / "interop" / "node_tcp_client.mjs"),
            *common,
        ], root
    if runtime == "python":
        return [
            sys.executable,
            str(root / "cpp" / "packages" / "handoffkit-ml" / "tests" / "interop" / "python_tcp_client.py"),
            *common,
        ], root
    if runtime == "go":
        return [
            os.environ.get("HANDOFFKIT_GO_BIN", "go"),
            "run", "./cmd/handoffkit-cpp-tcp-client", *common,
        ], root / "go" / "handoffkit"
    if runtime == "rust":
        return [
            os.environ.get("HANDOFFKIT_CARGO_BIN", "cargo"),
            "run", "--quiet", "--locked", "--manifest-path", str(root / "rust" / "Cargo.toml"),
            "-p", "handoffkit-transport", "--example", "cpp_tcp_client", "--", *common,
        ], root
    raise ValueError(runtime)


def server_args(root: Path, runtime: str, port: int, tls_root: Path) -> tuple[list[str], Path]:
    common = [
        "--host", "127.0.0.1", "--port", str(port),
        "--ca", str(tls_root / "ca_cert.pem"),
        "--cert", str(tls_root / "server_cert.pem"),
        "--key", str(tls_root / "server_key.pem"),
    ]
    if runtime == "node":
        return [
            os.environ.get("HANDOFFKIT_NODE_BIN", "node"),
            str(root / "cpp" / "packages" / "handoffkit-ml" / "tests" / "interop" / "node_tcp_server.mjs"),
            *common,
        ], root
    if runtime == "python":
        return [
            sys.executable,
            str(root / "cpp" / "packages" / "handoffkit-ml" / "tests" / "interop" / "python_tcp_server.py"),
            *common,
        ], root
    if runtime == "go":
        return [
            os.environ.get("HANDOFFKIT_GO_BIN", "go"),
            "run", "./cmd/handoffkit-cpp-tcp-server", *common,
        ], root / "go" / "handoffkit"
    if runtime == "rust":
        return [
            os.environ.get("HANDOFFKIT_CARGO_BIN", "cargo"),
            "run", "--quiet", "--locked", "--manifest-path", str(root / "rust" / "Cargo.toml"),
            "-p", "handoffkit-transport", "--example", "cpp_tcp_server", "--", *common,
        ], root
    raise ValueError(runtime)


def run_client(
    root: Path,
    runtime: str,
    port: int,
    tls_root: Path,
    worker: str,
    scratch: Path,
) -> dict:
    command, cwd = client_args(root, runtime, port, tls_root, worker, f"{runtime}-cpp-tcp")
    last = ""
    for attempt in range(1, 31):
        completed = subprocess.run(
            command,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=90,
            check=False,
        )
        if completed.returncode == 0:
            lines = [line.strip() for line in completed.stdout.splitlines() if line.strip()]
            if not lines:
                raise RuntimeError(f"{runtime} client returned no evidence")
            try:
                evidence = json.loads(lines[-1])
            except json.JSONDecodeError as error:
                raise RuntimeError(
                    f"{runtime} client returned non-JSON evidence: {completed.stdout[-1000:]}"
                ) from error
            evidence["attempt"] = attempt
            evidence["stderr_tail"] = completed.stderr[-500:]
            return evidence
        last = f"exit={completed.returncode}\nstdout={completed.stdout[-500:]}\nstderr={completed.stderr[-1000:]}"
        # A worker can still be binding its listener. Retry only transient
        # connection failures; a protocol/TLS failure is surfaced immediately.
        lowered = last.lower()
        if not any(marker in lowered for marker in ("econnrefused", "connection refused", "connect failed", "connect: connection")):
            break
        time.sleep(0.2)
    (scratch / f"{runtime}.failure.txt").write_text(last, encoding="utf-8")
    raise RuntimeError(f"{runtime} TCP interop client failed after retries: {last}")


def run_reverse_client(
    root: Path,
    runtime: str,
    port: int,
    tls_root: Path,
    cpp_client: Path,
    scratch: Path,
) -> dict:
    server_command, server_cwd = server_args(root, runtime, port, tls_root)
    source = f"{runtime}-server"
    client_command = [
        str(cpp_client), "127.0.0.1", str(port),
        str(tls_root / "ca_cert.pem"), str(tls_root / "client_cert.pem"),
        str(tls_root / "client_key.pem"), "server-peer", "server-node", source,
    ]
    server = subprocess.Popen(
        server_command,
        cwd=server_cwd,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    last = ""
    evidence = None
    try:
        for attempt in range(1, 31):
            completed = subprocess.run(
                client_command,
                cwd=root,
                capture_output=True,
                text=True,
                timeout=30,
                check=False,
            )
            if completed.returncode == 0:
                lines = [line.strip() for line in completed.stdout.splitlines() if line.strip()]
                if not lines:
                    raise RuntimeError(f"C++ reverse client returned no evidence for {runtime}")
                evidence = json.loads(lines[-1])
                evidence["attempt"] = attempt
                evidence["stderr_tail"] = completed.stderr[-500:]
                break
            last = f"exit={completed.returncode}\nstdout={completed.stdout[-500:]}\nstderr={completed.stderr[-1000:]}"
            lowered = last.lower()
            if not any(marker in lowered for marker in ("connect", "refused", "timeout", "could not resolve")):
                break
            time.sleep(0.2)
        if evidence is None:
            (scratch / f"cpp-to-{runtime}.failure.txt").write_text(last, encoding="utf-8")
            raise RuntimeError(f"C++ reverse client failed for {runtime}: {last}")
        return evidence
    finally:
        if server.poll() is None:
            server.terminate()
        try:
            server_stderr = server.communicate(timeout=5)[1]
        except subprocess.TimeoutExpired:
            server.kill()
            server_stderr = server.communicate()[1]
        if evidence is not None and server.returncode not in (0, -15, 143, 1):
            raise RuntimeError(f"{runtime} server exited unexpectedly: {server_stderr[-1000:]}")


def run(worker_binary: Path) -> dict:
    root = repository_root()
    worker_binary = worker_binary.resolve()
    if not worker_binary.is_file():
        raise FileNotFoundError(f"C++ worker does not exist: {worker_binary}")
    (root / ".local-tests").mkdir(parents=True, exist_ok=True)
    with local_scratch(root / ".local-tests") as scratch:
        tls_root = scratch / "tls"
        tls_root.mkdir()
        generate_fixtures(tls_root, root)
        worker_id = "cpp-ml-worker-interoperability"
        results: dict[str, dict] = {}
        cpp_client_name = "handoffkit-cpp-tcp-client" + worker_binary.suffix
        cpp_client = worker_binary.with_name(cpp_client_name)
        if not cpp_client.is_file():
            raise FileNotFoundError(
                f"C++ reverse interop client does not exist beside worker: {cpp_client}"
            )
        reverse_results: dict[str, dict] = {}
        for runtime in ("python", "node", "go", "rust"):
            runtime_root = scratch / runtime
            runtime_root.mkdir()
            # Allocate a port without opening a probe connection that could
            # occupy the C++ accept loop during its TLS handshake timeout.
            import socket

            with socket.socket() as probe:
                probe.bind(("127.0.0.1", 0))
                port = probe.getsockname()[1]
            policy_path = write_policy(runtime_root, tls_root, port, worker_id)
            process = subprocess.Popen(
                [str(worker_binary), "--tls-policy", str(policy_path)],
                cwd=root,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                text=True,
            )
            try:
                results[runtime] = run_client(root, runtime, port, tls_root, worker_id, scratch)
            finally:
                if process.poll() is None:
                    process.terminate()
                try:
                    stderr = process.communicate(timeout=5)[1]
                except subprocess.TimeoutExpired:
                    process.kill()
                    stderr = process.communicate()[1]
                if process.returncode not in (0, -15, 143, 1) and not results.get(runtime):
                    raise RuntimeError(f"C++ worker exited unexpectedly for {runtime}: {stderr[-1000:]}")
            runtime_root = scratch / f"reverse-{runtime}"
            runtime_root.mkdir()
            import socket

            with socket.socket() as probe:
                probe.bind(("127.0.0.1", 0))
                reverse_port = probe.getsockname()[1]
            reverse_results[runtime] = run_reverse_client(
                root, runtime, reverse_port, tls_root, cpp_client, scratch
            )
        return {
            "format": "handoffkit.security.cpp-tcp-interoperability",
            "format_version": 1,
            "transport": "TCP/TLSv1.3/mTLS/uint32-be-framed-json",
            "server": "cpp-ml-worker --tls-policy",
            "clients": results,
            "reverse_servers": reverse_results,
            "notice": "Interoperability evidence is a protocol/security path check, not a performance guarantee.",
        }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("worker", type=Path)
    args = parser.parse_args()
    output = run(args.worker)
    print(json.dumps(output, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
