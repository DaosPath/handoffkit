use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use ed25519_dalek::pkcs8::spki::der::pem::LineEnding;
use ed25519_dalek::pkcs8::{EncodePrivateKey, EncodePublicKey};
use ed25519_dalek::SigningKey;
use handoffkit_protocol::security::SignedArtifact;
use handoffkit_transport::{
    supported_crypto_capabilities, verify_signed_artifact, ArtifactSigner,
    ArtifactSigningCredential, ArtifactTrustPolicy,
};
use rand_core::OsRng;
use serde::Deserialize;
use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};

const NOW: u64 = 1_800_000_000;
const IDENTITY: &str = "spiffe://handoffkit.internal/producer/build-1";

#[derive(Deserialize)]
struct Vector {
    data_base64: String,
    public_key_pem: String,
    canonical_payload: String,
    signed_artifact: SignedArtifact,
}

fn vector_path() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../contracts/test-fixtures/artifact-signing/vector.json")
}

fn key_material() -> (String, String) {
    let key = SigningKey::generate(&mut OsRng);
    (
        key.to_pkcs8_pem(LineEnding::LF).unwrap().to_string(),
        key.verifying_key()
            .to_public_key_pem(LineEnding::LF)
            .unwrap(),
    )
}

fn credential(public_key_pem: &str) -> ArtifactSigningCredential {
    let mut credential =
        ArtifactSigningCredential::from_public_key_pem(public_key_pem, IDENTITY).unwrap();
    credential.valid_from = NOW - 100;
    credential.valid_until = NOW + 100;
    credential
}

fn error_code(data: &[u8], artifact: &SignedArtifact, policy: &ArtifactTrustPolicy) -> String {
    verify_signed_artifact(data, artifact, policy, NOW)
        .unwrap_err()
        .code
}

#[test]
fn rust_ed25519_verifies_public_shared_canonical_vector() {
    let vector: Vector = serde_json::from_slice(&fs::read(vector_path()).unwrap()).unwrap();
    let data = BASE64.decode(vector.data_base64).unwrap();
    let policy = ArtifactTrustPolicy::new(vec![credential(&vector.public_key_pem)]);
    verify_signed_artifact(&data, &vector.signed_artifact, &policy, NOW).unwrap();
    assert_eq!(
        String::from_utf8(vector.signed_artifact.canonical_payload().unwrap()).unwrap(),
        vector.canonical_payload,
    );
    assert_eq!(
        supported_crypto_capabilities()["signature_algorithms"],
        json!(["ed25519"])
    );
}

#[test]
fn rust_signs_with_ephemeral_key_and_rejects_negative_policies() {
    let data = b"signed payload";
    let (private_key_pem, public_key_pem) = key_material();
    let (_, wrong_public_key_pem) = key_material();
    let signer = ArtifactSigner::from_private_key_pem(&private_key_pem, IDENTITY).unwrap();
    let signed = signer.sign_artifact("artifact-2", data, NOW).unwrap();
    let policy = ArtifactTrustPolicy::new(vec![credential(&public_key_pem)]);
    verify_signed_artifact(data, &signed, &policy, NOW).unwrap();

    assert_eq!(
        error_code(b"tampered", &signed, &policy),
        "artifact_integrity_mismatch"
    );
    let mut invalid_signature = signed.clone();
    invalid_signature.signature = "AAAA".to_string();
    assert_eq!(
        error_code(data, &invalid_signature, &policy),
        "artifact_signature_invalid"
    );
    let mut wrong_identity = signed.clone();
    wrong_identity.signer_identity = "spiffe://evil.invalid/producer".to_string();
    assert_eq!(
        error_code(data, &wrong_identity, &policy),
        "artifact_signer_mismatch"
    );
    assert_eq!(
        error_code(
            data,
            &signed,
            &ArtifactTrustPolicy::new(vec![credential(&wrong_public_key_pem)])
        ),
        "artifact_signer_untrusted"
    );
    let mut expired = credential(&public_key_pem);
    expired.valid_until = NOW - 1;
    assert_eq!(
        error_code(data, &signed, &ArtifactTrustPolicy::new(vec![expired])),
        "artifact_signer_expired"
    );
    let mut revoked = credential(&public_key_pem);
    revoked.revoked = true;
    assert_eq!(
        error_code(data, &signed, &ArtifactTrustPolicy::new(vec![revoked])),
        "artifact_signer_revoked"
    );
    let mut disallowed = ArtifactTrustPolicy::new(vec![credential(&public_key_pem)]);
    disallowed.allowed_algorithms.clear();
    assert_eq!(
        error_code(data, &signed, &disallowed),
        "artifact_algorithm_unsupported"
    );

    let mut unsupported = signed.clone();
    unsupported.algorithm = "ecdsa".to_string();
    assert_eq!(
        error_code(data, &unsupported, &policy),
        "artifact_algorithm_unsupported"
    );
}
