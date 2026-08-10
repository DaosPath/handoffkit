from __future__ import annotations

import base64
import json
from pathlib import Path

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

import handoffkit.csp.security as security_module
from handoffkit.csp import (
    ARTIFACT_ALGORITHM_ECDSA_P256_SHA256,
    ArtifactSignatureError,
    ArtifactSigner,
    ArtifactSigningCredential,
    ArtifactTrustPolicy,
    ArtifactVerifier,
    SignedArtifact,
    detect_ecdsa_p256_sha256_support,
)

VECTOR_PATH = (
    Path(__file__).resolve().parents[2]
    / "contracts"
    / "test-fixtures"
    / "artifact-signing"
    / "vector.json"
)
NOW = 1_800_000_000
IDENTITY = "spiffe://handoffkit.internal/producer/build-1"


@pytest.fixture
def signing_keys() -> dict[str, Ed25519PrivateKey]:
    return {
        "producer": Ed25519PrivateKey.generate(),
        "wrong_signer": Ed25519PrivateKey.generate(),
    }


def signer(
    signing_keys: dict[str, Ed25519PrivateKey],
    name: str = "producer",
    identity: str = IDENTITY,
) -> ArtifactSigner:
    return ArtifactSigner(signing_keys[name], identity)


def credential(
    signing_keys: dict[str, Ed25519PrivateKey],
    name: str = "producer",
    identity: str = IDENTITY,
    *,
    valid_from: int = NOW - 100,
    valid_until: int = NOW + 100,
    revoked: bool = False,
) -> ArtifactSigningCredential:
    public_key_pem = (
        signing_keys[name]
        .public_key()
        .public_bytes(
            serialization.Encoding.PEM,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        )
    )
    return ArtifactSigningCredential(
        signer_identity=identity,
        public_key_pem=public_key_pem,
        valid_from=valid_from,
        valid_until=valid_until,
        revoked=revoked,
    )


def test_ed25519_shared_vector_verifies_without_private_fixture() -> None:
    vector = json.loads(VECTOR_PATH.read_text(encoding="utf-8"))
    data = base64.b64decode(vector["data_base64"], validate=True)
    signed = SignedArtifact.from_dict(vector["signed_artifact"])
    assert signed.canonical_payload().decode("utf-8") == vector["canonical_payload"]
    trusted = ArtifactSigningCredential(
        signer_identity=signed.signer_identity,
        public_key_pem=vector["public_key_pem"],
        valid_from=NOW - 100,
        valid_until=NOW + 100,
    )
    assert ArtifactVerifier.verify_signed_artifact(
        data,
        signed,
        ArtifactTrustPolicy([trusted]),
        now=NOW,
    )


def test_ed25519_artifact_sign_verify_and_canonical_payload(
    signing_keys: dict[str, Ed25519PrivateKey],
) -> None:
    data = b"handoffkit signed artifact\n"
    signed = signer(signing_keys).sign("artifact-1", data, created_at=NOW)
    policy = ArtifactTrustPolicy([credential(signing_keys)])

    canonical = json.loads(signed.canonical_payload())
    assert canonical == {
        "algorithm": "ed25519",
        "artifact_id": "artifact-1",
        "content_hash": "8416cac54bfdbe4faec6d73fdb57ae7cfa81703b311b66de3639e826a185f1e4",
        "created_at": NOW,
        "key_fingerprint": signed.key_fingerprint,
        "signer_identity": IDENTITY,
    }
    assert ArtifactVerifier.verify_signed_artifact(data, signed, policy, now=NOW)


@pytest.mark.parametrize(
    ("mutation", "expected_code"),
    [
        ("content", "artifact_integrity_mismatch"),
        ("signature", "artifact_signature_invalid"),
        ("identity", "artifact_signer_mismatch"),
    ],
)
def test_artifact_tamper_and_wrong_signer_rejected(
    signing_keys: dict[str, Ed25519PrivateKey],
    mutation: str,
    expected_code: str,
) -> None:
    data = b"signed payload"
    signed = signer(signing_keys).sign("artifact-2", data, created_at=NOW)
    candidate = signed
    candidate_data = data
    if mutation == "content":
        candidate_data = b"tampered payload"
    elif mutation == "signature":
        candidate = SignedArtifact.from_dict({**signed.to_dict(), "signature": "AAAA"})
    else:
        candidate = SignedArtifact.from_dict(
            {**signed.to_dict(), "signer_identity": "spiffe://evil.invalid/producer"}
        )

    with pytest.raises(ArtifactSignatureError) as caught:
        ArtifactVerifier.verify_signed_artifact(
            candidate_data,
            candidate,
            ArtifactTrustPolicy([credential(signing_keys)]),
            now=NOW,
        )
    assert caught.value.code == expected_code


def test_untrusted_expired_and_revoked_signers_rejected(
    signing_keys: dict[str, Ed25519PrivateKey],
) -> None:
    data = b"signed payload"
    signed = signer(signing_keys).sign("artifact-3", data, created_at=NOW)

    for policy, code in [
        (
            ArtifactTrustPolicy([credential(signing_keys, "wrong_signer")]),
            "artifact_signer_untrusted",
        ),
        (
            ArtifactTrustPolicy([credential(signing_keys, valid_until=NOW - 1)]),
            "artifact_signer_expired",
        ),
        (
            ArtifactTrustPolicy([credential(signing_keys, revoked=True)]),
            "artifact_signer_revoked",
        ),
        (
            ArtifactTrustPolicy(
                [credential(signing_keys)],
                allowed_algorithms=(),
            ),
            "artifact_algorithm_unsupported",
        ),
    ]:
        with pytest.raises(ArtifactSignatureError) as caught:
            ArtifactVerifier.verify_signed_artifact(data, signed, policy, now=NOW)
        assert caught.value.code == code


def test_signature_field_without_valid_crypto_is_never_verified(
    signing_keys: dict[str, Ed25519PrivateKey],
) -> None:
    signed = signer(signing_keys).sign("artifact-4", b"payload", created_at=NOW)
    forged = SignedArtifact.from_dict({**signed.to_dict(), "signature": ""})
    with pytest.raises(ArtifactSignatureError) as caught:
        ArtifactVerifier.verify_signed_artifact(
            b"payload",
            forged,
            ArtifactTrustPolicy([credential(signing_keys)]),
            now=NOW,
        )
    assert caught.value.code == "artifact_signature_invalid"


def _ecdsa_credential(
    private_key: ec.EllipticCurvePrivateKey,
    *,
    valid_from: int = NOW - 100,
    valid_until: int = NOW + 100,
    revoked: bool = False,
) -> ArtifactSigningCredential:
    public_key_pem = private_key.public_key().public_bytes(
        serialization.Encoding.PEM,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    return ArtifactSigningCredential(
        signer_identity=IDENTITY,
        public_key_pem=public_key_pem,
        valid_from=valid_from,
        valid_until=valid_until,
        revoked=revoked,
    )


def test_ecdsa_p256_artifact_sign_verify_and_policy_failures() -> None:
    if not detect_ecdsa_p256_sha256_support():
        pytest.skip("cryptography provider does not expose ECDSA-P256")

    data = b"handoffkit ecdsa artifact\n"
    producer = ec.generate_private_key(ec.SECP256R1())
    wrong_signer = ec.generate_private_key(ec.SECP256R1())
    signed = ArtifactSigner(producer, IDENTITY).sign("artifact-ecdsa", data, created_at=NOW)
    assert signed.algorithm == ARTIFACT_ALGORITHM_ECDSA_P256_SHA256
    policy = ArtifactTrustPolicy(
        [_ecdsa_credential(producer)],
        allowed_algorithms=(ARTIFACT_ALGORITHM_ECDSA_P256_SHA256,),
    )
    assert ArtifactVerifier.verify_signed_artifact(data, signed, policy, now=NOW)

    roundtrip = SignedArtifact.from_dict(signed.to_dict())
    assert ArtifactVerifier.verify_signed_artifact(data, roundtrip, policy, now=NOW)

    for candidate_data, candidate, candidate_policy, expected_code in [
        (b"tampered", signed, policy, "artifact_integrity_mismatch"),
        (
            data,
            SignedArtifact.from_dict({**signed.to_dict(), "signature": "AAAA"}),
            policy,
            "artifact_signature_invalid",
        ),
        (
            data,
            signed,
            ArtifactTrustPolicy(
                [_ecdsa_credential(wrong_signer)],
                allowed_algorithms=(ARTIFACT_ALGORITHM_ECDSA_P256_SHA256,),
            ),
            "artifact_signer_untrusted",
        ),
        (
            data,
            signed,
            ArtifactTrustPolicy(
                [_ecdsa_credential(producer, valid_until=NOW - 1)],
                allowed_algorithms=(ARTIFACT_ALGORITHM_ECDSA_P256_SHA256,),
            ),
            "artifact_signer_expired",
        ),
        (
            data,
            signed,
            ArtifactTrustPolicy(
                [_ecdsa_credential(producer, revoked=True)],
                allowed_algorithms=(ARTIFACT_ALGORITHM_ECDSA_P256_SHA256,),
            ),
            "artifact_signer_revoked",
        ),
    ]:
        with pytest.raises(ArtifactSignatureError) as caught:
            ArtifactVerifier.verify_signed_artifact(
                candidate_data, candidate, candidate_policy, now=NOW
            )
        assert caught.value.code == expected_code


def test_ecdsa_provider_unavailable_fails_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    producer = ec.generate_private_key(ec.SECP256R1())
    monkeypatch.setattr(security_module, "detect_ecdsa_p256_sha256_support", lambda: False)
    with pytest.raises(ArtifactSignatureError) as caught:
        ArtifactSigner(producer, IDENTITY)
    assert caught.value.code == "artifact_algorithm_unsupported"
