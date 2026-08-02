//! Security profiles, identity, capability authorization, and replay protection.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::durable_replay::{nonce_key, DurableCommitFailure, DurableReplayState};
use crate::ProtocolError;

pub use crate::durable_replay::{
    DurableReplayOptions, DurableReplayStatus, ReplayContext, DURABLE_REPLAY_FORMAT,
    DURABLE_REPLAY_FORMAT_VERSION,
};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "kebab-case")]
pub enum SecurityProfile {
    #[default]
    Local,
    Standard,
    HybridPq,
    Research,
}

impl SecurityProfile {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Local => "local",
            Self::Standard => "standard",
            Self::HybridPq => "hybrid-pq",
            Self::Research => "research",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SecurityProfileNegotiationError {
    pub code: &'static str,
    pub message: String,
}

impl std::fmt::Display for SecurityProfileNegotiationError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for SecurityProfileNegotiationError {}

pub fn negotiate_security_profile(
    required: SecurityProfile,
    offered: SecurityProfile,
    supported: &[SecurityProfile],
) -> Result<SecurityProfile, SecurityProfileNegotiationError> {
    if required != offered {
        return Err(SecurityProfileNegotiationError {
            code: "security_profile_mismatch",
            message: "required and offered security profiles do not match".to_string(),
        });
    }
    if !supported.contains(&required) {
        return Err(SecurityProfileNegotiationError {
            code: "security_profile_unavailable",
            message: "the exact security profile has no active provider".to_string(),
        });
    }
    Ok(required)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SecurityConfig {
    #[serde(default)]
    pub profile: SecurityProfile,
    #[serde(default)]
    pub require_mtls: bool,
    #[serde(default)]
    pub allow_insecure_loopback: bool,
    #[serde(default = "default_trust_domain")]
    pub trust_domain: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ca_cert_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cert_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key_path: Option<String>,
    #[serde(default = "default_replay_window")]
    pub replay_window_seconds: u64,
    #[serde(default = "default_clock_skew")]
    pub max_clock_skew_seconds: u64,
}

fn default_trust_domain() -> String {
    "handoffkit.internal".to_string()
}

fn default_replay_window() -> u64 {
    300
}

fn default_clock_skew() -> u64 {
    10
}

impl Default for SecurityConfig {
    fn default() -> Self {
        Self {
            profile: SecurityProfile::Local,
            require_mtls: false,
            allow_insecure_loopback: false,
            trust_domain: default_trust_domain(),
            ca_cert_path: None,
            cert_path: None,
            key_path: None,
            replay_window_seconds: default_replay_window(),
            max_clock_skew_seconds: default_clock_skew(),
        }
    }
}

impl SecurityConfig {
    pub fn validate_listen_address(&self, host: &str) -> Result<(), ProtocolError> {
        let is_loopback = host == "127.0.0.1" || host == "localhost" || host == "::1";
        if matches!(
            self.profile,
            SecurityProfile::Local | SecurityProfile::Research
        ) && !is_loopback
        {
            return Err(ProtocolError(format!(
                "Profile '{}' cannot listen on non-loopback interface '{host}'",
                self.profile.as_str()
            )));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct PeerIdentity {
    pub peer_id: String,
    pub node_id: String,
    #[serde(default = "default_trust_domain")]
    pub trust_domain: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worker_id: Option<String>,
    #[serde(default)]
    pub credential_fingerprint: String,
    #[serde(default)]
    pub capabilities: Vec<String>,
    #[serde(default)]
    pub issued_at: u64,
    #[serde(default)]
    pub expires_at: u64,
}

impl PeerIdentity {
    pub fn is_valid_at(&self, timestamp: u64) -> bool {
        if self.expires_at > 0 && timestamp > self.expires_at {
            return false;
        }
        if self.issued_at > 0 && timestamp < self.issued_at.saturating_sub(60) {
            return false;
        }
        true
    }
}

pub const SECURITY_TRANSCRIPT_FORMAT: &str = "handoffkit.security.transcript";
pub const SECURITY_TRANSCRIPT_FORMAT_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SecurityTranscript {
    pub binding_hash: String,
    pub binding_type: String,
    pub capabilities_hash: String,
    pub format: String,
    pub format_version: u32,
    pub handshake_nonce: String,
    pub negotiated_group: Option<String>,
    pub protocol_version: String,
    pub receiver_credential_fingerprint: String,
    pub receiver_node_id: String,
    pub receiver_peer_id: String,
    pub requested_profile: String,
    pub selected_profile: String,
    pub sender_credential_fingerprint: String,
    pub sender_node_id: String,
    pub sender_peer_id: String,
    pub session_id: String,
    pub timestamp: String,
    pub tls_version: String,
    pub transcript_hash: String,
}

pub struct SecurityTranscriptInput<'a> {
    pub protocol_version: &'a str,
    pub requested_profile: SecurityProfile,
    pub selected_profile: SecurityProfile,
    pub sender: &'a PeerIdentity,
    pub receiver: &'a PeerIdentity,
    pub tls_version: &'a str,
    pub negotiated_group: Option<&'a str>,
    pub session_id: &'a str,
    pub handshake_nonce: &'a str,
    pub timestamp: &'a str,
}

impl SecurityTranscript {
    pub fn from_value(value: Value) -> Result<Self, SecurityPolicyError> {
        let transcript: Self = serde_json::from_value(value).map_err(|_| SecurityPolicyError {
            code: "security_transcript_invalid",
            message: "security transcript is malformed".to_string(),
        })?;
        transcript.validate(true)?;
        if transcript.transcript_hash != canonical_sha256(&transcript.unsigned_map())? {
            return Err(SecurityPolicyError {
                code: "security_transcript_hash_mismatch",
                message: "security transcript hash does not match its canonical payload"
                    .to_string(),
            });
        }
        Ok(transcript)
    }

    pub fn unsigned_map(&self) -> BTreeMap<&'static str, Value> {
        BTreeMap::from([
            ("binding_hash", Value::String(self.binding_hash.clone())),
            ("binding_type", Value::String(self.binding_type.clone())),
            (
                "capabilities_hash",
                Value::String(self.capabilities_hash.clone()),
            ),
            ("format", Value::String(self.format.clone())),
            ("format_version", Value::Number(self.format_version.into())),
            (
                "handshake_nonce",
                Value::String(self.handshake_nonce.clone()),
            ),
            (
                "negotiated_group",
                self.negotiated_group
                    .clone()
                    .map(Value::String)
                    .unwrap_or(Value::Null),
            ),
            (
                "protocol_version",
                Value::String(self.protocol_version.clone()),
            ),
            (
                "receiver_credential_fingerprint",
                Value::String(self.receiver_credential_fingerprint.clone()),
            ),
            (
                "receiver_node_id",
                Value::String(self.receiver_node_id.clone()),
            ),
            (
                "receiver_peer_id",
                Value::String(self.receiver_peer_id.clone()),
            ),
            (
                "requested_profile",
                Value::String(self.requested_profile.clone()),
            ),
            (
                "selected_profile",
                Value::String(self.selected_profile.clone()),
            ),
            (
                "sender_credential_fingerprint",
                Value::String(self.sender_credential_fingerprint.clone()),
            ),
            ("sender_node_id", Value::String(self.sender_node_id.clone())),
            ("sender_peer_id", Value::String(self.sender_peer_id.clone())),
            ("session_id", Value::String(self.session_id.clone())),
            ("timestamp", Value::String(self.timestamp.clone())),
            ("tls_version", Value::String(self.tls_version.clone())),
        ])
    }

    fn validate(&self, require_hash: bool) -> Result<(), SecurityPolicyError> {
        if self.format != SECURITY_TRANSCRIPT_FORMAT {
            return Err(SecurityPolicyError {
                code: "security_transcript_invalid",
                message: "security transcript format is not recognized".to_string(),
            });
        }
        if self.format_version != SECURITY_TRANSCRIPT_FORMAT_VERSION {
            return Err(SecurityPolicyError {
                code: "security_transcript_version",
                message: "security transcript format version is unavailable".to_string(),
            });
        }
        for value in [
            &self.binding_hash,
            &self.binding_type,
            &self.capabilities_hash,
            &self.handshake_nonce,
            &self.protocol_version,
            &self.receiver_credential_fingerprint,
            &self.receiver_node_id,
            &self.receiver_peer_id,
            &self.requested_profile,
            &self.selected_profile,
            &self.sender_credential_fingerprint,
            &self.sender_node_id,
            &self.sender_peer_id,
            &self.session_id,
            &self.timestamp,
            &self.tls_version,
        ] {
            if value.is_empty() {
                return Err(SecurityPolicyError {
                    code: "security_transcript_invalid",
                    message: "security transcript contains an empty required field".to_string(),
                });
            }
        }
        for value in [
            &self.binding_hash,
            &self.capabilities_hash,
            &self.receiver_credential_fingerprint,
            &self.sender_credential_fingerprint,
        ] {
            if !is_canonical_sha256(value) {
                return Err(SecurityPolicyError {
                    code: "security_transcript_invalid",
                    message: "security transcript contains an invalid SHA-256 value".to_string(),
                });
            }
        }
        if require_hash && !is_canonical_sha256(&self.transcript_hash) {
            return Err(SecurityPolicyError {
                code: "security_transcript_invalid",
                message: "security transcript hash is invalid".to_string(),
            });
        }
        Ok(())
    }
}

pub fn build_security_transcript(
    input: SecurityTranscriptInput<'_>,
) -> Result<SecurityTranscript, SecurityPolicyError> {
    let mut capabilities = input.sender.capabilities.clone();
    capabilities.sort();
    let capabilities_hash = canonical_sha256(&capabilities)?;
    let binding_hash = canonical_sha256(&BTreeMap::from([
        (
            "receiver_credential_fingerprint",
            normalize_transcript_fingerprint(&input.receiver.credential_fingerprint),
        ),
        (
            "sender_credential_fingerprint",
            normalize_transcript_fingerprint(&input.sender.credential_fingerprint),
        ),
        ("tls_version", input.tls_version.to_string()),
    ]))?;
    let mut transcript = SecurityTranscript {
        binding_hash,
        binding_type: "tls-certificate-endpoints".to_string(),
        capabilities_hash,
        format: SECURITY_TRANSCRIPT_FORMAT.to_string(),
        format_version: SECURITY_TRANSCRIPT_FORMAT_VERSION,
        handshake_nonce: input.handshake_nonce.to_string(),
        negotiated_group: input.negotiated_group.map(str::to_string),
        protocol_version: input.protocol_version.to_string(),
        receiver_credential_fingerprint: normalize_transcript_fingerprint(
            &input.receiver.credential_fingerprint,
        ),
        receiver_node_id: input.receiver.node_id.clone(),
        receiver_peer_id: input.receiver.peer_id.clone(),
        requested_profile: input.requested_profile.as_str().to_string(),
        selected_profile: input.selected_profile.as_str().to_string(),
        sender_credential_fingerprint: normalize_transcript_fingerprint(
            &input.sender.credential_fingerprint,
        ),
        sender_node_id: input.sender.node_id.clone(),
        sender_peer_id: input.sender.peer_id.clone(),
        session_id: input.session_id.to_string(),
        timestamp: input.timestamp.to_string(),
        tls_version: input.tls_version.to_string(),
        transcript_hash: String::new(),
    };
    transcript.validate(false)?;
    transcript.transcript_hash = canonical_sha256(&transcript.unsigned_map())?;
    Ok(transcript)
}

pub fn verify_security_transcript(
    value: Value,
    input: SecurityTranscriptInput<'_>,
) -> Result<SecurityTranscript, SecurityPolicyError> {
    let transcript = SecurityTranscript::from_value(value)?;
    let expected_profile = input.selected_profile.as_str();
    if transcript.requested_profile != expected_profile
        || transcript.selected_profile != expected_profile
    {
        return Err(SecurityPolicyError {
            code: "security_profile_mismatch",
            message: "security transcript attempted a profile downgrade".to_string(),
        });
    }
    let expected = build_security_transcript(input)?;
    if transcript.sender_peer_id != expected.sender_peer_id
        || transcript.sender_node_id != expected.sender_node_id
        || transcript.sender_credential_fingerprint != expected.sender_credential_fingerprint
        || transcript.receiver_peer_id != expected.receiver_peer_id
        || transcript.receiver_node_id != expected.receiver_node_id
        || transcript.receiver_credential_fingerprint != expected.receiver_credential_fingerprint
    {
        return Err(SecurityPolicyError {
            code: "security_transcript_identity_mismatch",
            message: "security transcript identities do not match authenticated TLS endpoints"
                .to_string(),
        });
    }
    if transcript != expected {
        return Err(SecurityPolicyError {
            code: "security_transcript_mismatch",
            message: "security transcript does not match the authenticated HK-CSP exchange"
                .to_string(),
        });
    }
    Ok(transcript)
}

fn canonical_sha256(value: &impl Serialize) -> Result<String, SecurityPolicyError> {
    let encoded = serde_json::to_vec(value).map_err(|error| SecurityPolicyError {
        code: "security_transcript_invalid",
        message: error.to_string(),
    })?;
    Ok(format!("sha256:{}", hex::encode(Sha256::digest(encoded))))
}

fn normalize_transcript_fingerprint(value: &str) -> String {
    let mut normalized = value.trim().to_ascii_lowercase().replace(':', "");
    if let Some(rest) = normalized.strip_prefix("sha256") {
        normalized = rest.to_string();
    }
    format!("sha256:{normalized}")
}

fn is_canonical_sha256(value: &str) -> bool {
    value.len() == 71
        && value.starts_with("sha256:")
        && value[7..]
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SignedArtifact {
    pub artifact_id: String,
    pub content_hash: String,
    pub signature: String,
    pub algorithm: String,
    pub signer_identity: String,
    pub key_fingerprint: String,
    pub created_at: u64,
}

impl SignedArtifact {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        if self.artifact_id.is_empty() || self.signer_identity.is_empty() {
            return Err(ProtocolError(
                "artifact_id and signer_identity must not be empty".to_string(),
            ));
        }
        if self.algorithm != "ed25519" {
            return Err(ProtocolError(format!(
                "unsupported artifact signature algorithm: {}",
                self.algorithm
            )));
        }
        if !is_lower_sha256(&self.content_hash) {
            return Err(ProtocolError(
                "content_hash must be a lowercase SHA-256 digest".to_string(),
            ));
        }
        if !self.key_fingerprint.starts_with("sha256:")
            || !is_lower_sha256(&self.key_fingerprint["sha256:".len()..])
        {
            return Err(ProtocolError(
                "key_fingerprint must be a canonical SHA-256 fingerprint".to_string(),
            ));
        }
        Ok(())
    }

    pub fn canonical_payload(&self) -> Result<Vec<u8>, ProtocolError> {
        self.validate()?;
        #[derive(Serialize)]
        struct Canonical<'a> {
            algorithm: &'a str,
            artifact_id: &'a str,
            content_hash: &'a str,
            created_at: u64,
            key_fingerprint: &'a str,
            signer_identity: &'a str,
        }
        serde_json::to_vec(&Canonical {
            algorithm: &self.algorithm,
            artifact_id: &self.artifact_id,
            content_hash: &self.content_hash,
            created_at: self.created_at,
            key_fingerprint: &self.key_fingerprint,
            signer_identity: &self.signer_identity,
        })
        .map_err(|error| ProtocolError(error.to_string()))
    }
}

fn is_lower_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

#[derive(Debug, Clone)]
pub struct CapabilityPolicy {
    pub allowed_operations: Option<HashSet<String>>,
    pub allowed_workspace_roots: Option<Vec<PathBuf>>,
}

impl CapabilityPolicy {
    pub fn new(
        allowed_operations: Option<Vec<String>>,
        allowed_workspace_roots: Option<Vec<PathBuf>>,
    ) -> Self {
        Self {
            allowed_operations: allowed_operations.map(|v| v.into_iter().collect()),
            allowed_workspace_roots,
        }
    }

    pub fn is_operation_authorized(&self, operation: &str, peer: Option<&PeerIdentity>) -> bool {
        if let Some(ref ops) = self.allowed_operations {
            if !ops.contains(operation) {
                return false;
            }
        }
        if let Some(p) = peer {
            if p.capabilities.iter().any(|c| c == "*" || c == operation) {
                return true;
            }
            if let Some(prefix) = operation.split(':').next() {
                let star_prefix = format!("{prefix}:*");
                if p.capabilities.iter().any(|c| c == &star_prefix) {
                    return true;
                }
            }
            return false;
        }
        true
    }

    pub fn authorize_job(
        &self,
        job_type: &str,
        peer: &PeerIdentity,
    ) -> Result<(), SecurityPolicyError> {
        let now_ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);

        if !peer.is_valid_at(now_ts) {
            return Err(SecurityPolicyError {
                code: "authentication_failed",
                message: format!(
                    "Peer identity '{}' has expired or is invalid.",
                    peer.peer_id
                ),
            });
        }

        let op = format!("job:{job_type}");
        if !self.is_operation_authorized(&op, Some(peer))
            && !self.is_operation_authorized(job_type, Some(peer))
        {
            return Err(SecurityPolicyError {
                code: "authorization_denied",
                message: format!(
                    "Peer '{}' is not authorized to execute job type '{job_type}'.",
                    peer.peer_id
                ),
            });
        }
        Ok(())
    }
}

#[derive(Debug)]
pub struct ReplayProtection {
    pub window_seconds: u64,
    pub max_clock_skew_seconds: u64,
    pub max_seen_nonces: usize,
    seen_nonces: HashMap<String, u64>,
    last_sequences: HashMap<String, u64>,
    durable: Option<DurableReplayState>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SecurityPolicyError {
    pub code: &'static str,
    pub message: String,
}

impl std::fmt::Display for SecurityPolicyError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for SecurityPolicyError {}

impl ReplayProtection {
    pub fn new(window_seconds: u64, max_clock_skew_seconds: u64, max_seen_nonces: usize) -> Self {
        Self {
            window_seconds,
            max_clock_skew_seconds,
            max_seen_nonces,
            seen_nonces: HashMap::new(),
            last_sequences: HashMap::new(),
            durable: None,
        }
    }

    pub fn new_durable(
        path: impl Into<PathBuf>,
        options: DurableReplayOptions,
    ) -> Result<Self, SecurityPolicyError> {
        let (durable, (last_sequences, seen_nonces)) = DurableReplayState::load(path, &options)?;
        Ok(Self {
            window_seconds: options.window_seconds,
            max_clock_skew_seconds: options.max_clock_skew_seconds,
            max_seen_nonces: options.max_seen_nonces,
            seen_nonces,
            last_sequences,
            durable: Some(durable),
        })
    }

    pub fn check_and_record(
        &mut self,
        session_scope: &str,
        sequence: u64,
        nonce: Option<&str>,
        created_at_ts: Option<u64>,
    ) -> Result<(), SecurityPolicyError> {
        self.check_and_record_context(session_scope, sequence, nonce, created_at_ts, None)
    }

    pub fn check_and_record_context(
        &mut self,
        session_scope: &str,
        sequence: u64,
        nonce: Option<&str>,
        created_at_ts: Option<u64>,
        context: Option<&ReplayContext>,
    ) -> Result<(), SecurityPolicyError> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);

        if let Some(ts) = created_at_ts {
            if ts < now.saturating_sub(self.window_seconds) {
                return Err(SecurityPolicyError {
                    code: "replay_timestamp_stale",
                    message: format!(
                        "Message timestamp is older than replay window ({}s).",
                        self.window_seconds
                    ),
                });
            }
            if ts > now + self.max_clock_skew_seconds {
                return Err(SecurityPolicyError {
                    code: "replay_timestamp_future",
                    message: format!(
                        "Message timestamp is in the future beyond max clock skew ({}s).",
                        self.max_clock_skew_seconds
                    ),
                });
            }
        }

        if let Some(&last) = self.last_sequences.get(session_scope) {
            if sequence <= last {
                return Err(SecurityPolicyError {
                    code: "replay_sequence",
                    message: format!(
                        "Sequence {sequence} is not strictly monotonic for session {session_scope} (last: {last})."
                    ),
                });
            }
        }

        let cutoff = now.saturating_sub(self.window_seconds);
        let mut candidate_nonces = self.seen_nonces.clone();
        candidate_nonces.retain(|_, timestamp| *timestamp >= cutoff);
        let mut candidate_sequences = self.last_sequences.clone();
        if let Some(n) = nonce {
            let key = nonce_key(session_scope, n);
            if candidate_nonces.contains_key(&key) {
                return Err(SecurityPolicyError {
                    code: "replay_nonce",
                    message: "Duplicate nonce detected.".to_string(),
                });
            }
            if candidate_nonces.len() >= self.max_seen_nonces {
                return Err(SecurityPolicyError {
                    code: "replay_state_capacity",
                    message: "Replay nonce capacity is exhausted.".to_string(),
                });
            }
            candidate_nonces.insert(key, now);
        }

        candidate_sequences.insert(session_scope.to_string(), sequence);
        if let Some(durable) = &mut self.durable {
            match durable.commit_candidate(
                session_scope,
                sequence,
                &candidate_sequences,
                &candidate_nonces,
                context,
                now,
            ) {
                Ok(()) => {}
                Err(DurableCommitFailure { error, committed }) => {
                    if committed {
                        self.last_sequences = candidate_sequences;
                        self.seen_nonces = candidate_nonces;
                    }
                    return Err(error);
                }
            }
        }
        self.last_sequences = candidate_sequences;
        self.seen_nonces = candidate_nonces;

        Ok(())
    }

    pub fn prune_old_nonces(&mut self, now: u64) {
        let cutoff = now.saturating_sub(self.window_seconds);
        self.seen_nonces.retain(|_, &mut ts| ts >= cutoff);
    }

    pub fn compact_durable(&mut self, now: u64) -> Result<(), SecurityPolicyError> {
        let durable = self.durable.as_mut().ok_or_else(|| SecurityPolicyError {
            code: "replay_state_not_durable",
            message: "Replay protection has no durable backend.".to_string(),
        })?;
        let cutoff = now.saturating_sub(self.window_seconds);
        let mut candidate_nonces = self.seen_nonces.clone();
        candidate_nonces.retain(|_, timestamp| *timestamp >= cutoff);
        let expired_scopes: HashSet<_> = durable.expired_scopes(now).into_iter().collect();
        let mut candidate_sequences = self.last_sequences.clone();
        for scope in &expired_scopes {
            candidate_sequences.remove(scope);
            let prefix = format!("{scope}\0");
            candidate_nonces.retain(|key, _| !key.starts_with(&prefix));
        }
        let changed =
            candidate_nonces.len() != self.seen_nonces.len() || !expired_scopes.is_empty();
        if !changed {
            return Ok(());
        }
        match durable.commit_compaction(&candidate_nonces, &expired_scopes) {
            Ok(()) => {}
            Err(DurableCommitFailure { error, committed }) => {
                if committed {
                    self.last_sequences = candidate_sequences;
                    self.seen_nonces = candidate_nonces;
                }
                return Err(error);
            }
        }
        self.last_sequences = candidate_sequences;
        self.seen_nonces = candidate_nonces;
        Ok(())
    }

    pub fn durable_status(&self) -> Option<DurableReplayStatus> {
        self.durable
            .as_ref()
            .map(|durable| durable.status(self.seen_nonces.len()))
    }
}
