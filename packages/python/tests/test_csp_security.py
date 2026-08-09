"""Tests for Python HK-CSP security profiles, TLS 1.3, mTLS, and capability authorization."""

import os
import time

import pytest

from handoffkit.csp.security import (
    ArtifactSignatureError,
    ArtifactVerifier,
    AuthorizationError,
    CapabilityPolicy,
    FileKeyStore,
    PeerIdentity,
    ReplayDetectedError,
    ReplayProtection,
    SecurityConfig,
    SecurityError,
    SecurityProfile,
    SecurityProfileUnavailableError,
    SignedArtifact,
    build_ssl_context,
    detect_hybrid_pq_support,
    get_supported_crypto_capabilities,
)


def test_security_profile_enum():
    assert SecurityProfile.LOCAL == "local"
    assert SecurityProfile.STANDARD == "standard"
    assert SecurityProfile.HYBRID_PQ == "hybrid-pq"
    assert SecurityProfile.RESEARCH == "research"


def test_security_config_defaults():
    cfg = SecurityConfig()
    assert cfg.profile == SecurityProfile.LOCAL
    assert cfg.require_mtls is False
    assert cfg.allow_insecure_loopback is False
    assert cfg.trust_domain == "handoffkit.internal"


@pytest.mark.parametrize(
    "kwargs",
    [
        {"ocsp_fetch": True},
        {"ocsp_responder_url": "https://ocsp.invalid"},
        {"ocsp_response_path": "response.der"},
        {"require_ocsp": True},
    ],
)
def test_python_ocsp_paths_fail_closed(kwargs):
    with pytest.raises(SecurityError) as caught:
        SecurityConfig(**kwargs)
    assert caught.value.code == "ocsp_fetch_unavailable"


def test_unsupported_artifact_algorithm_is_structured():
    with pytest.raises(ArtifactSignatureError) as caught:
        SignedArtifact(
            artifact_id="artifact-unsupported",
            content_hash="0" * 64,
            signature="",
            algorithm="ecdsa",
            signer_identity="spiffe://handoffkit.internal/producer/test",
            key_fingerprint="sha256:" + "0" * 64,
            created_at=1,
        )
    assert caught.value.code == "artifact_algorithm_unsupported"


def test_security_config_listen_validation():
    cfg = SecurityConfig(profile=SecurityProfile.LOCAL, allow_insecure_loopback=False)
    cfg.validate_listen_address("127.0.0.1")
    cfg.validate_listen_address("localhost")

    with pytest.raises(ValueError, match="cannot listen on non-loopback interface"):
        cfg.validate_listen_address("192.168.1.100")

    with pytest.raises(ValueError, match="cannot listen on non-loopback interface"):
        cfg_bad = SecurityConfig(allow_insecure_loopback=True)
        cfg_bad.validate_listen_address("0.0.0.0")

    with pytest.raises(ValueError, match="cannot listen on non-loopback interface"):
        SecurityConfig(profile=SecurityProfile.RESEARCH).validate_listen_address("::")


def test_peer_identity_serialization():
    identity = PeerIdentity(
        peer_id="p1",
        node_id="n1",
        worker_id="w1",
        trust_domain="handoffkit.internal",
        credential_fingerprint="sha256:abc",
        capabilities=("compute:gpu", "job:training"),
        issued_at=int(time.time()),
        expires_at=int(time.time()) + 3600,
    )
    assert identity.is_valid_at() is True

    serialized = identity.to_dict()
    deserialized = PeerIdentity.from_dict(serialized)
    assert deserialized.peer_id == "p1"
    assert deserialized.capabilities == ("compute:gpu", "job:training")


def test_peer_identity_expiration():
    identity = PeerIdentity(
        peer_id="p1",
        node_id="n1",
        issued_at=1000,
        expires_at=2000,
    )
    assert identity.is_valid_at(1500) is True
    assert identity.is_valid_at(2500) is False


def test_capability_policy_authorization():
    policy = CapabilityPolicy(allowed_operations=["job:training", "job:evaluation"])
    peer = PeerIdentity(
        peer_id="p1",
        node_id="n1",
        capabilities=("job:training",),
        issued_at=int(time.time()),
        expires_at=int(time.time()) + 3600,
    )

    policy.authorize_job("training", peer)

    with pytest.raises(AuthorizationError):
        policy.authorize_job("evaluation", peer)


def test_capability_policy_path_sandboxing(tmp_path):
    root = tmp_path / "workspace"
    root.mkdir()
    file_inside = root / "data.txt"
    file_inside.write_text("hello")
    file_outside = tmp_path / "outside.txt"

    policy = CapabilityPolicy(allowed_workspace_roots=[root])
    assert policy.is_path_authorized(file_inside) is True
    assert policy.is_path_authorized(file_outside) is False


def test_replay_protection_monotonic_sequences():
    rp = ReplayProtection(window_seconds=300, max_skew_seconds=10)
    rp.check_and_record("sess-1", sequence=1, nonce="nonce-1")
    rp.check_and_record("sess-1", sequence=2, nonce="nonce-2")

    with pytest.raises(ReplayDetectedError, match="not monotonic"):
        rp.check_and_record("sess-1", sequence=2, nonce="nonce-3")

    with pytest.raises(ReplayDetectedError, match="Duplicate nonce"):
        rp.check_and_record("sess-1", sequence=3, nonce="nonce-1")

    # Nonces and sequences are scoped by authenticated peer + session upstream.
    rp.check_and_record("sess-2", sequence=1, nonce="nonce-1")


def test_replay_protection_timestamp_tolerance():
    rp = ReplayProtection(window_seconds=100, max_skew_seconds=10)
    now = time.time()

    # Stale timestamp
    with pytest.raises(ReplayDetectedError, match="older than replay window"):
        rp.check_and_record("sess-3", sequence=1, created_at_ts=now - 200)

    # Future timestamp beyond skew
    with pytest.raises(ReplayDetectedError, match="in future"):
        rp.check_and_record("sess-3", sequence=1, created_at_ts=now + 50)


def test_artifact_verifier_sha256(tmp_path):
    f = tmp_path / "artifact.bin"
    content = b"HandoffKit 1.19.0 artifact payload"
    f.write_bytes(content)

    expected_hash = ArtifactVerifier.compute_sha256(content)
    assert ArtifactVerifier.verify_integrity(f, expected_hash) is True
    assert ArtifactVerifier.verify_integrity(f, "invalidhash") is False


def test_file_keystore_lifecycle_and_private_key_permissions(tmp_path):
    key = tmp_path / "private.pem"
    key.write_text("test-only-private-key", encoding="utf-8")
    key.chmod(0o600)
    store = FileKeyStore(key_path=key)
    assert store.get_private_key() == "test-only-private-key"
    store.close()
    with pytest.raises(SecurityError) as closed:
        store.get_private_key()
    assert closed.value.code == "keystore_closed"

    if os.name == "posix":
        key.chmod(0o644)
        with pytest.raises(SecurityError) as insecure:
            FileKeyStore(key_path=key).get_private_key()
        assert insecure.value.code == "insecure_key_permissions"


def test_get_supported_crypto_capabilities():
    caps = get_supported_crypto_capabilities()
    assert caps["tls13_supported"] is True
    assert caps["hybrid_pq_supported"] is detect_hybrid_pq_support()
    assert caps["signature_algorithms"] == ["ed25519"]
    assert caps["digest_algorithms"] == ["sha256"]
    assert ("hybrid-pq" in caps["profiles_supported"]) is caps["hybrid_pq_supported"]
    assert "hybrid-pq" in caps["profiles_recognized"]


def test_hybrid_pq_fails_closed_when_negotiation_cannot_be_proven():
    assert detect_hybrid_pq_support() is False
    with pytest.raises(SecurityProfileUnavailableError) as caught:
        build_ssl_context(SecurityConfig(profile=SecurityProfile.HYBRID_PQ))

    assert caught.value.to_dict() == {
        "code": "security_profile_unavailable",
        "message": (
            "The Python TLS integration cannot prove negotiation of required hybrid "
            "group X25519MLKEM768."
        ),
        "details": {
            "profile": "hybrid-pq",
            "provider": caught.value.details["provider"],
            "required_group": "X25519MLKEM768",
            "reason": "negotiated_group_unobservable",
        },
    }
