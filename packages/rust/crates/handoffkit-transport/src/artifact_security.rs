use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use ed25519_dalek::pkcs8::{DecodePrivateKey, DecodePublicKey};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use handoffkit_protocol::security::SignedArtifact;
use handoffkit_runtime::{RuntimeError, RuntimeResult};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::{DurableRevocationPolicy, RevocationKind};

#[derive(Debug, Clone)]
pub struct ArtifactSigningCredential {
    pub signer_identity: String,
    pub public_key: VerifyingKey,
    pub valid_from: u64,
    pub valid_until: u64,
    pub revoked: bool,
}

impl ArtifactSigningCredential {
    pub fn from_public_key_pem(
        public_key_pem: &str,
        signer_identity: impl Into<String>,
    ) -> RuntimeResult<Self> {
        let public_key = VerifyingKey::from_public_key_pem(public_key_pem)
            .map_err(|error| RuntimeError::new("artifact_key_invalid", error.to_string()))?;
        Ok(Self {
            signer_identity: signer_identity.into(),
            public_key,
            valid_from: 0,
            valid_until: 0,
            revoked: false,
        })
    }

    pub fn fingerprint(&self) -> String {
        artifact_public_key_fingerprint(&self.public_key)
    }
}

#[derive(Debug, Clone)]
pub struct ArtifactTrustPolicy {
    pub credentials: HashMap<String, ArtifactSigningCredential>,
    pub allowed_algorithms: HashSet<String>,
    pub max_future_skew_seconds: u64,
    pub revocation_policy: Option<DurableRevocationPolicy>,
}

impl ArtifactTrustPolicy {
    pub fn new(credentials: Vec<ArtifactSigningCredential>) -> Self {
        Self {
            credentials: credentials
                .into_iter()
                .map(|credential| (credential.fingerprint(), credential))
                .collect(),
            allowed_algorithms: HashSet::from(["ed25519".to_string()]),
            max_future_skew_seconds: 10,
            revocation_policy: None,
        }
    }
}

pub struct ArtifactSigner {
    private_key: SigningKey,
    signer_identity: String,
}

impl ArtifactSigner {
    pub fn from_private_key_pem(
        private_key_pem: &str,
        signer_identity: impl Into<String>,
    ) -> RuntimeResult<Self> {
        let signer_identity = signer_identity.into();
        if signer_identity.is_empty() {
            return Err(RuntimeError::new(
                "artifact_signer_invalid",
                "signer_identity must not be empty",
            ));
        }
        let private_key = SigningKey::from_pkcs8_pem(private_key_pem)
            .map_err(|error| RuntimeError::new("artifact_key_invalid", error.to_string()))?;
        Ok(Self {
            private_key,
            signer_identity,
        })
    }

    pub fn key_fingerprint(&self) -> String {
        artifact_public_key_fingerprint(&self.private_key.verifying_key())
    }

    pub fn sign_artifact(
        &self,
        artifact_id: impl Into<String>,
        data: &[u8],
        created_at: u64,
    ) -> RuntimeResult<SignedArtifact> {
        let created_at = if created_at == 0 {
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|duration| duration.as_secs())
                .unwrap_or(0)
        } else {
            created_at
        };
        let mut artifact = SignedArtifact {
            artifact_id: artifact_id.into(),
            content_hash: hex::encode(Sha256::digest(data)),
            signature: String::new(),
            algorithm: "ed25519".to_string(),
            signer_identity: self.signer_identity.clone(),
            key_fingerprint: self.key_fingerprint(),
            created_at,
        };
        let signature = self.private_key.sign(&artifact.canonical_payload()?);
        artifact.signature = BASE64.encode(signature.to_bytes());
        Ok(artifact)
    }
}

pub fn artifact_public_key_fingerprint(public_key: &VerifyingKey) -> String {
    format!(
        "sha256:{}",
        hex::encode(Sha256::digest(public_key.as_bytes()))
    )
}

pub fn verify_signed_artifact(
    data: &[u8],
    artifact: &SignedArtifact,
    policy: &ArtifactTrustPolicy,
    now: u64,
) -> RuntimeResult<()> {
    artifact
        .validate()
        .map_err(|error| RuntimeError::new("artifact_contract_invalid", error.0))?;
    if !policy.allowed_algorithms.contains(&artifact.algorithm) {
        return Err(RuntimeError::new(
            "artifact_algorithm_unsupported",
            "artifact signature algorithm is not allowlisted",
        ));
    }
    if hex::encode(Sha256::digest(data)) != artifact.content_hash {
        return Err(RuntimeError::new(
            "artifact_integrity_mismatch",
            "artifact content does not match the signed SHA-256 digest",
        ));
    }
    let credential = policy
        .credentials
        .get(&artifact.key_fingerprint)
        .ok_or_else(|| {
            RuntimeError::new(
                "artifact_signer_untrusted",
                "artifact signer key is not trusted",
            )
        })?;
    if credential.signer_identity != artifact.signer_identity {
        return Err(RuntimeError::new(
            "artifact_signer_mismatch",
            "artifact signer identity does not match local key policy",
        ));
    }
    let signer_revoked = if let Some(revocations) = &policy.revocation_policy {
        revocations.is_revoked(
            RevocationKind::SignerFingerprint,
            &artifact.key_fingerprint,
            now,
        )? || revocations.is_revoked(RevocationKind::PeerId, &artifact.signer_identity, now)?
    } else {
        false
    };
    if credential.revoked || signer_revoked {
        return Err(RuntimeError::new(
            "artifact_signer_revoked",
            "artifact signer key is revoked",
        ));
    }
    if (credential.valid_from > 0 && now < credential.valid_from)
        || (credential.valid_until > 0 && now > credential.valid_until)
    {
        return Err(RuntimeError::new(
            "artifact_signer_expired",
            "artifact signer credential is outside its validity window",
        ));
    }
    if artifact.created_at > now.saturating_add(policy.max_future_skew_seconds)
        || (credential.valid_from > 0 && artifact.created_at < credential.valid_from)
        || (credential.valid_until > 0 && artifact.created_at > credential.valid_until)
    {
        return Err(RuntimeError::new(
            "artifact_timestamp_invalid",
            "artifact signature timestamp is outside the accepted window",
        ));
    }
    let signature_bytes = BASE64.decode(&artifact.signature).map_err(|_| {
        RuntimeError::new(
            "artifact_signature_invalid",
            "artifact signature is not valid base64",
        )
    })?;
    let signature = Signature::from_slice(&signature_bytes).map_err(|_| {
        RuntimeError::new(
            "artifact_signature_invalid",
            "artifact signature is not a valid Ed25519 signature",
        )
    })?;
    credential
        .public_key
        .verify(&artifact.canonical_payload()?, &signature)
        .map_err(|_| {
            RuntimeError::new(
                "artifact_signature_invalid",
                "artifact signature verification failed",
            )
        })
}
