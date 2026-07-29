//! Security profiles, identity, capability authorization, and replay protection.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::ProtocolError;

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
        if (host == "0.0.0.0" || host == "::") && self.allow_insecure_loopback {
            return Err(ProtocolError(
                "allow_insecure_loopback cannot be used with public bind (0.0.0.0)".to_string(),
            ));
        }
        let is_loopback = host == "127.0.0.1" || host == "localhost" || host == "::1";
        if self.profile == SecurityProfile::Local && !is_loopback && !self.allow_insecure_loopback {
            return Err(ProtocolError(format!(
                "Profile 'local' cannot listen on non-loopback interface '{host}' without allow_insecure_loopback=true"
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
            if !p.capabilities.is_empty() {
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
        }
        true
    }

    pub fn authorize_job(&self, job_type: &str, peer: &PeerIdentity) -> Result<(), ProtocolError> {
        let now_ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);

        if !peer.is_valid_at(now_ts) {
            return Err(ProtocolError(format!(
                "Peer identity '{}' has expired or is invalid.",
                peer.peer_id
            )));
        }

        let op = format!("job:{job_type}");
        if !self.is_operation_authorized(&op, Some(peer))
            && !self.is_operation_authorized(job_type, Some(peer))
        {
            return Err(ProtocolError(format!(
                "Peer '{}' is not authorized to execute job type '{job_type}'.",
                peer.peer_id
            )));
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
}

impl ReplayProtection {
    pub fn new(window_seconds: u64, max_clock_skew_seconds: u64, max_seen_nonces: usize) -> Self {
        Self {
            window_seconds,
            max_clock_skew_seconds,
            max_seen_nonces,
            seen_nonces: HashMap::new(),
            last_sequences: HashMap::new(),
        }
    }

    pub fn check_and_record(
        &mut self,
        session_id: &str,
        sequence: u64,
        nonce: Option<&str>,
        created_at_ts: Option<u64>,
    ) -> Result<(), ProtocolError> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);

        if let Some(ts) = created_at_ts {
            if ts < now.saturating_sub(self.window_seconds) {
                return Err(ProtocolError(format!(
                    "Message timestamp is older than replay window ({}s).",
                    self.window_seconds
                )));
            }
            if ts > now + self.max_clock_skew_seconds {
                return Err(ProtocolError(format!(
                    "Message timestamp is in the future beyond max clock skew ({}s).",
                    self.max_clock_skew_seconds
                )));
            }
        }

        if let Some(&last) = self.last_sequences.get(session_id) {
            if sequence <= last {
                return Err(ProtocolError(format!(
                    "Sequence {sequence} is not strictly monotonic for session {session_id} (last: {last})."
                )));
            }
        }
        self.last_sequences.insert(session_id.to_string(), sequence);

        if let Some(n) = nonce {
            self.prune_old_nonces(now);
            if self.seen_nonces.contains_key(n) {
                return Err(ProtocolError(format!("Duplicate nonce detected: {n}")));
            }
            if self.seen_nonces.len() >= self.max_seen_nonces {
                if let Some(oldest_key) = self.seen_nonces.keys().next().cloned() {
                    self.seen_nonces.remove(&oldest_key);
                }
            }
            self.seen_nonces.insert(n.to_string(), now);
        }

        Ok(())
    }

    pub fn prune_old_nonces(&mut self, now: u64) {
        let cutoff = now.saturating_sub(self.window_seconds);
        self.seen_nonces.retain(|_, &mut ts| ts >= cutoff);
    }
}
