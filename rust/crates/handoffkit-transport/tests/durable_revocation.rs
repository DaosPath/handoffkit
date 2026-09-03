use ed25519_dalek::pkcs8::{EncodePrivateKey, EncodePublicKey};
use ed25519_dalek::SigningKey;
use handoffkit_transport::{
    verify_signed_artifact, ArtifactSigner, ArtifactSigningCredential, ArtifactTrustPolicy,
    DurableRevocationOptions, DurableRevocationPolicy, RevocationEntry, RevocationKind,
};
use rand_core::OsRng;
use serde_json::Value;
use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

fn entry(
    kind: RevocationKind,
    value: &str,
    revoked_at: u64,
    effective_at: Option<u64>,
    expires_at: u64,
) -> RevocationEntry {
    RevocationEntry::new(
        kind,
        value,
        "credential compromise",
        revoked_at,
        effective_at,
        expires_at,
    )
    .unwrap()
}

#[test]
fn rust_revocation_persists_and_scopes_subjects() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("revocations.json");
    let policy = DurableRevocationPolicy::open(&path, DurableRevocationOptions::default()).unwrap();
    let timestamp = now();
    for candidate in [
        entry(
            RevocationKind::CertificateFingerprint,
            &format!("sha256:{}", "a".repeat(64)),
            timestamp,
            None,
            0,
        ),
        entry(RevocationKind::PeerId, "peer-a", timestamp, None, 0),
        entry(
            RevocationKind::Issuer,
            "CN=HandoffKit Test CA",
            timestamp,
            None,
            0,
        ),
        entry(
            RevocationKind::TrustDomain,
            "HANDOFFKIT.INTERNAL",
            timestamp,
            None,
            0,
        ),
    ] {
        policy.revoke(candidate).unwrap();
    }
    let restored =
        DurableRevocationPolicy::open(&path, DurableRevocationOptions::default()).unwrap();
    let status = restored.status(timestamp).unwrap();
    assert_eq!(
        (status.generation, status.entries, status.active),
        (4, 4, 4)
    );
    for (kind, value) in [
        (
            RevocationKind::CertificateFingerprint,
            format!("{}AA", "AA:".repeat(31)),
        ),
        (RevocationKind::PeerId, "peer-a".to_string()),
        (RevocationKind::Issuer, "CN=HandoffKit Test CA".to_string()),
        (
            RevocationKind::TrustDomain,
            "handoffkit.internal".to_string(),
        ),
    ] {
        assert!(restored.is_revoked(kind, &value, timestamp).unwrap());
    }
    assert!(!restored
        .is_revoked(
            RevocationKind::CertificateFingerprint,
            &format!("sha256:{}", "b".repeat(64)),
            timestamp,
        )
        .unwrap());
}

#[test]
fn rust_loads_shared_durable_revocation_fixture() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("shared-revocations.json");
    fs::write(
        &path,
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../shared/contracts/test-fixtures/security/durable-revocation-v1.json"
        )),
    )
    .unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
    }
    let policy = DurableRevocationPolicy::open(&path, DurableRevocationOptions::default()).unwrap();
    let status = policy.status(1_800_000_000).unwrap();
    assert_eq!(
        (status.generation, status.entries, status.active),
        (3, 3, 2)
    );
    assert!(policy
        .is_revoked(
            RevocationKind::CertificateFingerprint,
            &format!("sha256:{}", "a".repeat(64)),
            1_800_000_000,
        )
        .unwrap());
    assert!(policy
        .is_revoked(
            RevocationKind::SignerFingerprint,
            &format!("sha256:{}", "b".repeat(64)),
            1_800_000_000,
        )
        .unwrap());
    assert!(!policy
        .is_revoked(RevocationKind::PeerId, "peer-b", 1_800_000_000)
        .unwrap());
}

#[test]
fn rust_revocation_effective_window_remove_and_reload() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("revocations.json");
    let reader = DurableRevocationPolicy::open(&path, DurableRevocationOptions::default()).unwrap();
    let writer = DurableRevocationPolicy::open(&path, DurableRevocationOptions::default()).unwrap();
    let timestamp = now();
    writer
        .revoke(entry(
            RevocationKind::PeerId,
            "future-peer",
            timestamp,
            Some(timestamp + 10),
            timestamp + 20,
        ))
        .unwrap();
    assert!(!reader
        .is_revoked(RevocationKind::PeerId, "future-peer", timestamp + 11)
        .unwrap());
    reader.reload().unwrap();
    assert!(!reader
        .is_revoked(RevocationKind::PeerId, "future-peer", timestamp + 9)
        .unwrap());
    assert!(reader
        .is_revoked(RevocationKind::PeerId, "future-peer", timestamp + 10)
        .unwrap());
    assert!(!reader
        .is_revoked(RevocationKind::PeerId, "future-peer", timestamp + 20)
        .unwrap());
    assert!(writer
        .remove(RevocationKind::PeerId, "future-peer")
        .unwrap());
    reader.reload().unwrap();
    assert!(!reader
        .is_revoked(RevocationKind::PeerId, "future-peer", timestamp + 11)
        .unwrap());
}

#[test]
fn rust_revocation_capacity_and_corruption_fail_closed() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("revocations.json");
    let options = DurableRevocationOptions {
        max_entries: 1,
        ..DurableRevocationOptions::default()
    };
    let policy = DurableRevocationPolicy::open(&path, options.clone()).unwrap();
    policy
        .revoke(entry(RevocationKind::PeerId, "peer-a", now(), None, 0))
        .unwrap();
    assert_eq!(
        policy
            .revoke(entry(RevocationKind::PeerId, "peer-b", now(), None, 0))
            .unwrap_err()
            .code,
        "revocation_state_capacity"
    );
    let mut value: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    value["checksum"] = Value::String("sha256:00".to_string());
    fs::write(&path, serde_json::to_vec(&value).unwrap()).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
    }
    assert_eq!(
        DurableRevocationPolicy::open(&path, options)
            .unwrap_err()
            .code,
        "security_state_corrupt"
    );
    assert!(!path.exists());
}

#[test]
fn rust_ed25519_verification_enforces_durable_signer_revocation() {
    let signing_key = SigningKey::generate(&mut OsRng);
    let private_pem = signing_key.to_pkcs8_pem(Default::default()).unwrap();
    let public_pem = signing_key
        .verifying_key()
        .to_public_key_pem(Default::default())
        .unwrap();
    let signer = ArtifactSigner::from_private_key_pem(private_pem.as_str(), "producer-a").unwrap();
    let credential =
        ArtifactSigningCredential::from_public_key_pem(&public_pem, "producer-a").unwrap();
    let artifact = signer
        .sign_artifact("artifact-a", b"verified payload", now())
        .unwrap();
    let directory = tempfile::tempdir().unwrap();
    let revocations = DurableRevocationPolicy::open(
        directory.path().join("revocations.json"),
        DurableRevocationOptions::default(),
    )
    .unwrap();
    let mut policy = ArtifactTrustPolicy::new(vec![credential]);
    policy.revocation_policy = Some(revocations.clone());
    verify_signed_artifact(b"verified payload", &artifact, &policy, now()).unwrap();
    revocations
        .revoke(entry(
            RevocationKind::SignerFingerprint,
            &artifact.key_fingerprint,
            now(),
            None,
            0,
        ))
        .unwrap();
    assert_eq!(
        verify_signed_artifact(b"verified payload", &artifact, &policy, now())
            .unwrap_err()
            .code,
        "artifact_signer_revoked"
    );
}
