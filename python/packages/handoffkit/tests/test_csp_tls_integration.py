from __future__ import annotations

import asyncio
import ssl
import subprocess
import sys
import tempfile
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pytest
from cryptography import x509

from handoffkit.csp import (
    AuthenticationError,
    AuthorizationError,
    CapabilityPolicy,
    CertificateIdentityPolicy,
    ChannelClosedError,
    LengthDelimitedTransport,
    MessageEnvelope,
    NetworkConfig,
    PeerIdentity,
    ReplayDetectedError,
    ReplayProtection,
    SecurityConfig,
    SecurityError,
    SecurityProfile,
    TcpTransport,
    build_ssl_context,
    certificate_fingerprint,
    make_envelope,
)

TLS_GENERATOR = (
    Path(__file__).resolve().parents[4]
    / "shared"
    / "contracts"
    / "test-fixtures"
    / "tls"
    / "generate.py"
)
_TLS_TEMP_DIRECTORY = tempfile.TemporaryDirectory(prefix="handoffkit-python-tls-")
TLS_FIXTURES = Path(_TLS_TEMP_DIRECTORY.name)
subprocess.run(
    [sys.executable, str(TLS_GENERATOR), "--output", str(TLS_FIXTURES)],
    check=True,
    capture_output=True,
    text=True,
)
CA = TLS_FIXTURES / "ca_cert.pem"
ROGUE_CA = TLS_FIXTURES / "rogue_ca_cert.pem"
ISSUER = "CN=HandoffKit Test CA"
TRUST_DOMAIN = "handoffkit.internal"
OPERATION = "message:echo"


def fixture_identity(name: str, capabilities: tuple[str, ...] = (OPERATION,)) -> PeerIdentity:
    cert = x509.load_pem_x509_certificate((TLS_FIXTURES / f"{name}_cert.pem").read_bytes())
    identities = cert.extensions.get_extension_for_class(
        x509.SubjectAlternativeName
    ).value.get_values_for_type(x509.UniformResourceIdentifier)
    identity_uri = next(value for value in identities if value.startswith("spiffe://"))
    parsed = identity_uri.removeprefix("spiffe://")
    trust_domain, path = parsed.split("/", maxsplit=1)
    parts = path.split("/")
    return PeerIdentity(
        peer_id=parts[1],
        node_id=parts[3],
        worker_id=parts[5] if len(parts) == 6 else None,
        trust_domain=trust_domain,
        credential_fingerprint=certificate_fingerprint(TLS_FIXTURES / f"{name}_cert.pem"),
        capabilities=capabilities,
        issued_at=int(cert.not_valid_before_utc.timestamp()),
        expires_at=int(cert.not_valid_after_utc.timestamp()),
    )


def identity_policy(
    certificate_names: tuple[str, ...],
    *,
    expected: PeerIdentity | None = None,
    revoked: tuple[str, ...] = (),
    trust_domain: str = TRUST_DOMAIN,
) -> CertificateIdentityPolicy:
    grants = {
        certificate_fingerprint(TLS_FIXTURES / f"{name}_cert.pem"): (OPERATION,)
        for name in certificate_names
    }
    return CertificateIdentityPolicy(
        trust_domain=trust_domain,
        capabilities_by_fingerprint=grants,
        revoked_fingerprints=frozenset(revoked),
        expected_peer_id=expected.peer_id if expected else None,
        expected_node_id=expected.node_id if expected else None,
        expected_worker_id=expected.worker_id if expected else None,
        allowed_issuer_names=(ISSUER,) if trust_domain == TRUST_DOMAIN else (),
    )


def network_config(
    own_certificate: str | None,
    accepted_peers: tuple[str, ...],
    *,
    server: bool,
    ca: Path = CA,
    require_mtls: bool = True,
    peer_expected: PeerIdentity | None = None,
    replay: ReplayProtection | None = None,
    revoked: tuple[str, ...] = (),
    trust_domain: str = TRUST_DOMAIN,
) -> NetworkConfig:
    security = SecurityConfig(
        profile=SecurityProfile.STANDARD,
        require_mtls=require_mtls,
        trust_domain=trust_domain,
        ca_cert_path=str(ca),
        cert_path=(str(TLS_FIXTURES / f"{own_certificate}_cert.pem") if own_certificate else None),
        key_path=(str(TLS_FIXTURES / f"{own_certificate}_key.pem") if own_certificate else None),
        replay_window_seconds=30,
        max_clock_skew_seconds=3,
    )
    return NetworkConfig(
        connect_timeout_ms=1000,
        io_timeout_ms=1000,
        security_config=security,
        identity_policy=identity_policy(
            accepted_peers,
            expected=peer_expected,
            revoked=revoked,
            trust_domain=trust_domain,
        ),
        capability_policy=CapabilityPolicy(allowed_operations=[OPERATION]),
        replay_protection=replay or ReplayProtection(window_seconds=30, max_skew_seconds=3),
    )


def secure_envelope(
    identity: PeerIdentity,
    *,
    session_id: str = "tls-session",
    sequence: int = 1,
    nonce: str = "nonce-1",
    operation: str = OPERATION,
    created_at: str | None = None,
    declared_overrides: dict[str, Any] | None = None,
) -> MessageEnvelope:
    declared = identity.to_dict()
    declared.update(declared_overrides or {})
    envelope = make_envelope(
        session_id=session_id,
        channel="secure",
        source=identity.peer_id,
        payload_type="json",
        payload={"ok": True},
        sequence=sequence,
    )
    return replace(
        envelope,
        created_at=created_at or envelope.created_at,
        metadata={
            "peer_identity": declared,
            "security_nonce": nonce,
            "operation": operation,
        },
    )


async def close_server(server: asyncio.Server) -> None:
    server.close()
    await server.wait_closed()


def test_python_tls13_mtls_roundtrip_uses_real_tcp_and_certificate_identity() -> None:
    async def scenario() -> None:
        client_identity = fixture_identity("client")
        server_identity = fixture_identity("server")
        server_config = network_config(
            "server", ("client",), server=True, peer_expected=client_identity
        )
        client_config = network_config(
            "client", ("server",), server=False, peer_expected=server_identity
        )
        completed = asyncio.Event()
        failures: list[BaseException] = []

        async def echo(transport: TcpTransport) -> None:
            try:
                assert transport.authenticated_peer == client_identity
                request = await transport.receive()
                ssl_object = transport.writer.get_extra_info("ssl_object")
                assert ssl_object.version() == "TLSv1.3"
                await transport.send(
                    secure_envelope(
                        server_identity,
                        session_id=request.session_id,
                        sequence=1,
                        nonce="server-response-1",
                    )
                )
            except BaseException as exc:  # surfaced after server callback task exits
                failures.append(exc)
            finally:
                await transport.close()
                completed.set()

        server = await TcpTransport.start_server(echo, "127.0.0.1", 0, config=server_config)
        port = server.sockets[0].getsockname()[1]
        client = await TcpTransport.connect(
            "127.0.0.1", port, config=client_config, server_hostname="localhost"
        )
        assert client.authenticated_peer == server_identity
        assert client.writer.get_extra_info("ssl_object").version() == "TLSv1.3"
        await client.send(secure_envelope(client_identity))
        response = await client.receive()
        assert response.source == "server-peer"
        await client.close()
        await asyncio.wait_for(completed.wait(), 2)
        await close_server(server)
        assert failures == []

    asyncio.run(scenario())


@pytest.mark.parametrize(
    ("server_certificate", "client_ca", "expected_error"),
    [
        ("wrong_host_server", CA, "hostname"),
        ("expired_server", CA, "expired"),
        ("server", ROGUE_CA, "certificate"),
        ("rogue_server", CA, "certificate"),
    ],
)
def test_python_tls_rejects_invalid_server_certificates(
    server_certificate: str,
    client_ca: Path,
    expected_error: str,
) -> None:
    async def scenario() -> None:
        server_security = SecurityConfig(
            profile=SecurityProfile.STANDARD,
            ca_cert_path=str(CA),
            cert_path=str(TLS_FIXTURES / f"{server_certificate}_cert.pem"),
            key_path=str(TLS_FIXTURES / f"{server_certificate}_key.pem"),
        )
        server_context = build_ssl_context(server_security, is_server=True)

        async def close_immediately(
            _reader: asyncio.StreamReader, writer: asyncio.StreamWriter
        ) -> None:
            writer.close()

        server = await asyncio.start_server(close_immediately, "127.0.0.1", 0, ssl=server_context)
        client_config = network_config(
            "client",
            (server_certificate,),
            server=False,
            ca=client_ca,
            require_mtls=False,
        )
        port = server.sockets[0].getsockname()[1]
        with pytest.raises((ssl.SSLCertVerificationError, AuthenticationError)) as caught:
            await TcpTransport.connect(
                "127.0.0.1", port, config=client_config, server_hostname="localhost"
            )
        assert expected_error.lower() in str(caught.value).lower()
        await close_server(server)

    asyncio.run(scenario())


def test_python_mtls_rejects_missing_client_certificate() -> None:
    async def scenario() -> None:
        server_config = network_config("server", ("client",), server=True)
        called = asyncio.Event()

        async def handler(_transport: TcpTransport) -> None:
            called.set()

        server = await TcpTransport.start_server(handler, "127.0.0.1", 0, config=server_config)
        client_config = network_config(
            None,
            ("server",),
            server=False,
            require_mtls=False,
        )
        port = server.sockets[0].getsockname()[1]
        with pytest.raises((ssl.SSLError, ConnectionError, OSError, ChannelClosedError)):
            client = await TcpTransport.connect(
                "127.0.0.1", port, config=client_config, server_hostname="localhost"
            )
            await client.send(secure_envelope(fixture_identity("client")))
            await client.receive()
        await asyncio.sleep(0.05)
        assert not called.is_set()
        await close_server(server)

    asyncio.run(scenario())


def test_python_plaintext_public_bind_is_rejected_before_listen() -> None:
    async def scenario() -> None:
        with pytest.raises(ValueError, match="cannot listen on non-loopback"):
            await TcpTransport.start_server(
                lambda _transport: None,
                "0.0.0.0",
                0,
                config=NetworkConfig(
                    security_config=SecurityConfig(
                        profile=SecurityProfile.LOCAL,
                        allow_insecure_loopback=True,
                    )
                ),
            )

    asyncio.run(scenario())


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("peer_id", "spoofed-peer"),
        ("node_id", "spoofed-node"),
        ("worker_id", "spoofed-worker"),
        ("trust_domain", "evil.invalid"),
        ("credential_fingerprint", "sha256:00"),
        ("capabilities", ["*"]),
    ],
)
def test_python_secure_receive_rejects_declared_identity_spoof(field: str, value: object) -> None:
    async def scenario() -> None:
        client_identity = fixture_identity("client")
        server_config = network_config("server", ("client",), server=True)
        result: asyncio.Future[BaseException] = asyncio.get_running_loop().create_future()

        async def handler(transport: TcpTransport) -> None:
            try:
                await transport.receive()
            except BaseException as exc:
                result.set_result(exc)
            finally:
                await transport.close()

        server = await TcpTransport.start_server(handler, "127.0.0.1", 0, config=server_config)
        client_config = network_config("client", ("server",), server=False)
        client = await TcpTransport.connect(
            "127.0.0.1",
            server.sockets[0].getsockname()[1],
            config=client_config,
            server_hostname="localhost",
        )
        await client.send(secure_envelope(client_identity, declared_overrides={field: value}))
        error = await asyncio.wait_for(result, 2)
        assert isinstance(error, AuthenticationError)
        assert error.code == "declared_identity_mismatch"
        assert field in error.details["fields"]
        await client.close()
        await close_server(server)

    asyncio.run(scenario())


def test_python_secure_receive_integrates_replay_and_authorization() -> None:
    async def scenario() -> None:
        client_identity = fixture_identity("client")
        server_replay = ReplayProtection(window_seconds=30, max_skew_seconds=3)
        server_config = network_config(
            "server", ("client", "revoked_client"), server=True, replay=server_replay
        )
        outcomes: asyncio.Queue[BaseException | None] = asyncio.Queue()

        async def handler(transport: TcpTransport) -> None:
            try:
                await transport.receive()
            except BaseException as exc:
                await outcomes.put(exc)
            else:
                await outcomes.put(None)
            finally:
                await transport.close()

        server = await TcpTransport.start_server(handler, "127.0.0.1", 0, config=server_config)
        port = server.sockets[0].getsockname()[1]

        async def submit(envelope: MessageEnvelope, certificate: str = "client"):
            client_config = network_config(certificate, ("server",), server=False)
            client = await TcpTransport.connect(
                "127.0.0.1",
                port,
                config=client_config,
                server_hostname="localhost",
            )
            await client.send(envelope)
            outcome = await asyncio.wait_for(outcomes.get(), 2)
            await client.close()
            return outcome

        first = secure_envelope(client_identity, sequence=1, nonce="same")
        assert await submit(first) is None

        same_sequence = await submit(first)
        assert isinstance(same_sequence, ReplayDetectedError)

        same_nonce = await submit(secure_envelope(client_identity, sequence=2, nonce="same"))
        assert isinstance(same_nonce, ReplayDetectedError)

        different_session = await submit(
            secure_envelope(
                client_identity,
                session_id="other-session",
                sequence=1,
                nonce="same",
            )
        )
        assert different_session is None

        second_identity = fixture_identity("revoked_client")
        different_peer = await submit(
            secure_envelope(second_identity, sequence=1, nonce="same"),
            certificate="revoked_client",
        )
        assert different_peer is None

        now = datetime.now(timezone.utc)
        stale = await submit(
            secure_envelope(
                client_identity,
                session_id="stale",
                sequence=1,
                nonce="stale",
                created_at=(now - timedelta(seconds=60)).isoformat(),
            )
        )
        assert isinstance(stale, ReplayDetectedError)

        future = await submit(
            secure_envelope(
                client_identity,
                session_id="future",
                sequence=1,
                nonce="future",
                created_at=(now + timedelta(seconds=10)).isoformat(),
            )
        )
        assert isinstance(future, ReplayDetectedError)

        within_skew = await submit(
            secure_envelope(
                client_identity,
                session_id="skew",
                sequence=1,
                nonce="skew",
                created_at=(now + timedelta(seconds=1)).isoformat(),
            )
        )
        assert within_skew is None

        unauthorized = await submit(
            secure_envelope(
                client_identity,
                session_id="authz",
                sequence=1,
                nonce="authz",
                operation="job:admin",
            )
        )
        assert isinstance(unauthorized, AuthorizationError)

        await close_server(server)

        # Current replay state is process-local: a new state object accepts the
        # same peer/session/sequence after restart. This behavior is documented.
        restarted = ReplayProtection(window_seconds=30, max_skew_seconds=3)
        scope = f"{client_identity.credential_fingerprint}|{first.session_id}"
        restarted.check_and_record(
            scope,
            first.sequence,
            nonce="same",
            created_at_ts=datetime.fromisoformat(
                first.created_at.replace("Z", "+00:00")
            ).timestamp(),
        )

    asyncio.run(scenario())


def test_python_local_revocation_policy_rejects_valid_certificate() -> None:
    async def scenario() -> None:
        revoked = certificate_fingerprint(TLS_FIXTURES / "revoked_client_cert.pem")
        server_config = network_config(
            "server",
            ("revoked_client",),
            server=True,
            revoked=(revoked,),
        )
        called = asyncio.Event()

        async def handler(_transport: TcpTransport) -> None:
            called.set()

        server = await TcpTransport.start_server(handler, "127.0.0.1", 0, config=server_config)
        client_config = network_config("revoked_client", ("server",), server=False)
        client = await TcpTransport.connect(
            "127.0.0.1",
            server.sockets[0].getsockname()[1],
            config=client_config,
            server_hostname="localhost",
        )
        await client.send(secure_envelope(fixture_identity("revoked_client")))
        with pytest.raises((ConnectionError, ssl.SSLError, ChannelClosedError)):
            await client.receive()
        await asyncio.sleep(0.05)
        assert not called.is_set()
        await client.close()
        await close_server(server)

    asyncio.run(scenario())


def test_python_tls_context_uses_system_roots_without_custom_ca() -> None:
    context = build_ssl_context(SecurityConfig(profile=SecurityProfile.STANDARD))
    assert context is not None
    assert context.check_hostname is True
    assert context.verify_mode == ssl.CERT_REQUIRED
    assert context.cert_store_stats()["x509_ca"] > 0


def test_python_secure_profiles_reject_external_ssl_context_overrides() -> None:
    async def scenario() -> None:
        supplied = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        standard = network_config("client", ("server",), server=False)
        with pytest.raises(SecurityError) as client_override:
            await TcpTransport.connect(
                "127.0.0.1",
                9,
                config=standard,
                ssl_context=supplied,
                server_hostname="localhost",
            )
        assert client_override.value.code == "tls_context_override_forbidden"

        server_config = network_config("server", ("client",), server=True)
        with pytest.raises(SecurityError) as server_override:
            await TcpTransport.start_server(
                lambda _transport: None,
                "127.0.0.1",
                0,
                config=server_config,
                ssl_context=supplied,
            )
        assert server_override.value.code == "tls_context_override_forbidden"

        hybrid = replace(
            standard,
            security_config=replace(
                standard.security_config,
                profile=SecurityProfile.HYBRID_PQ,
            ),
        )
        with pytest.raises(SecurityError) as hybrid_override:
            await TcpTransport.connect(
                "127.0.0.1",
                9,
                config=hybrid,
                ssl_context=supplied,
                server_hostname="localhost",
            )
        assert hybrid_override.value.code == "security_profile_unavailable"

    asyncio.run(scenario())


def test_python_secure_transport_rejects_direct_socket_wrapping() -> None:
    standard = network_config("client", ("server",), server=False)
    with pytest.raises(SecurityError) as direct:
        LengthDelimitedTransport(None, None, config=standard)  # type: ignore[arg-type]
    assert direct.value.code == "secure_transport_factory_required"

    hybrid = replace(
        standard,
        security_config=replace(
            standard.security_config,
            profile=SecurityProfile.HYBRID_PQ,
        ),
    )
    with pytest.raises(SecurityError) as unavailable:
        LengthDelimitedTransport(None, None, config=hybrid)  # type: ignore[arg-type]
    assert unavailable.value.code == "security_profile_unavailable"
