"""Durable revocation policy, lifecycle, and artifact enforcement."""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from handoffkit.csp import (
    ArtifactSignatureError,
    ArtifactSigner,
    ArtifactSigningCredential,
    ArtifactTrustPolicy,
    ArtifactVerifier,
    DurableRevocationPolicy,
    RevocationEntry,
    SecurityError,
)

CONTRACTS = Path(__file__).resolve().parents[2] / "contracts"


def entry(
    kind: str = "certificate_fingerprint",
    value: str = "sha256:" + "a" * 64,
    *,
    now: int | None = None,
    effective_at: int | None = None,
    expires_at: int = 0,
) -> RevocationEntry:
    timestamp = int(time.time()) if now is None else now
    return RevocationEntry(
        kind=kind,
        value=value,
        reason="credential compromise",
        revoked_at=timestamp,
        effective_at=effective_at,
        expires_at=expires_at,
    )


def test_revocation_persists_reloads_and_scopes_subjects(tmp_path):
    path = tmp_path / "revocations.json"
    policy = DurableRevocationPolicy(path)
    policy.revoke(entry())
    policy.revoke(entry("peer_id", "peer-a"))
    policy.revoke(entry("issuer", "CN=HandoffKit Test CA"))
    policy.revoke(entry("trust_domain", "HANDOFFKIT.INTERNAL"))

    restored = DurableRevocationPolicy(path)
    assert restored.status()["generation"] == 4
    assert restored.is_revoked("certificate_fingerprint", "AA:" * 31 + "AA")
    assert restored.is_revoked("peer_id", "peer-a")
    assert restored.is_revoked("issuer", "CN=HandoffKit Test CA")
    assert restored.is_revoked("trust_domain", "handoffkit.internal")
    assert not restored.is_revoked("peer_id", "peer-b")
    assert not restored.is_revoked("certificate_fingerprint", "sha256:" + "b" * 64)


def test_python_loads_shared_durable_revocation_fixture(tmp_path):
    fixture = CONTRACTS / "test-fixtures/security/durable-revocation-v1.json"
    path = tmp_path / "shared-revocations.json"
    path.write_bytes(fixture.read_bytes())
    if os.name == "posix":
        path.chmod(0o600)
    policy = DurableRevocationPolicy(path)
    assert policy.status(now=1_800_000_000) == {
        "format": "handoffkit.security.revocations",
        "format_version": 1,
        "generation": 3,
        "entries": 3,
        "active": 2,
    }
    assert policy.is_revoked(
        "certificate_fingerprint", "sha256:" + "a" * 64, now=1_800_000_000
    )
    assert policy.is_revoked(
        "signer_fingerprint", "sha256:" + "b" * 64, now=1_800_000_000
    )
    assert not policy.is_revoked("peer_id", "peer-b", now=1_800_000_000)


def test_revocation_effective_window_remove_and_live_reload(tmp_path):
    path = tmp_path / "revocations.json"
    reader = DurableRevocationPolicy(path)
    writer = DurableRevocationPolicy(path)
    timestamp = int(time.time())
    writer.revoke(
        entry(
            "peer_id",
            "future-peer",
            now=timestamp,
            effective_at=timestamp + 10,
            expires_at=timestamp + 20,
        )
    )
    assert not reader.is_revoked("peer_id", "future-peer", now=timestamp + 11)
    reader.reload()
    assert not reader.is_revoked("peer_id", "future-peer", now=timestamp + 9)
    assert reader.is_revoked("peer_id", "future-peer", now=timestamp + 10)
    assert not reader.is_revoked("peer_id", "future-peer", now=timestamp + 20)
    assert writer.remove("peer_id", "future-peer")
    reader.reload()
    assert not reader.is_revoked("peer_id", "future-peer", now=timestamp + 11)


def test_revocation_corruption_is_quarantined_and_capacity_fails_closed(tmp_path):
    path = tmp_path / "revocations.json"
    policy = DurableRevocationPolicy(path, max_entries=1)
    policy.revoke(entry())
    with pytest.raises(SecurityError) as capacity:
        policy.revoke(entry("peer_id", "peer-a"))
    assert capacity.value.code == "revocation_state_capacity"
    assert policy.status()["entries"] == 1

    value = json.loads(path.read_text(encoding="utf-8"))
    value["checksum"] = "sha256:00"
    path.write_text(json.dumps(value), encoding="utf-8")
    if os.name == "posix":
        path.chmod(0o600)
    with pytest.raises(SecurityError) as corruption:
        DurableRevocationPolicy(path)
    assert corruption.value.code == "security_state_corrupt"
    assert not path.exists()


def test_durable_signer_revocation_is_enforced_by_ed25519_verifier(tmp_path):
    private_key = Ed25519PrivateKey.generate()
    public_pem = private_key.public_key().public_bytes(
        serialization.Encoding.PEM,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    credential = ArtifactSigningCredential(
        signer_identity="producer-a",
        public_key_pem=public_pem,
    )
    signer = ArtifactSigner(private_key, "producer-a")
    artifact = signer.sign("artifact-a", b"verified payload")
    revocations = DurableRevocationPolicy(tmp_path / "revocations.json")
    policy = ArtifactTrustPolicy([credential], revocation_policy=revocations)
    assert ArtifactVerifier.verify_signed_artifact(b"verified payload", artifact, policy)

    revocations.revoke(entry("signer_fingerprint", credential.fingerprint))
    with pytest.raises(ArtifactSignatureError) as revoked:
        ArtifactVerifier.verify_signed_artifact(b"verified payload", artifact, policy)
    assert revoked.value.code == "artifact_signer_revoked"
