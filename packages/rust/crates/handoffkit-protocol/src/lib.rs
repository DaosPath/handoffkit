//! HK-CSP 1.0 wire contracts.
//!
//! This crate contains no async runtime and no transport dependencies.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fmt::{Display, Formatter};

pub const PROTOCOL_VERSION: &str = "1.0";
pub const DEFAULT_CHANNEL_CAPACITY: usize = 64;
pub const DEFAULT_MAX_MESSAGE_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProtocolError(pub String);

impl Display for ProtocolError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for ProtocolError {}

pub fn negotiate_version(remote: &str) -> Result<&'static str, ProtocolError> {
    let local_major = PROTOCOL_VERSION.split('.').next();
    let remote_major = remote.split('.').next();
    if remote_major == local_major {
        Ok(PROTOCOL_VERSION)
    } else {
        Err(ProtocolError(format!(
            "unsupported HK-CSP protocol version {remote}"
        )))
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum RuntimeMode {
    Classic,
    #[default]
    Session,
    Distributed,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum OverflowPolicy {
    #[default]
    Block,
    Reject,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RetryPolicy {
    #[serde(default = "default_max_attempts")]
    pub max_attempts: u32,
    #[serde(default = "default_base_delay_ms")]
    pub base_delay_ms: u64,
    #[serde(default = "default_max_delay_ms")]
    pub max_delay_ms: u64,
}

impl Default for RetryPolicy {
    fn default() -> Self {
        Self {
            max_attempts: default_max_attempts(),
            base_delay_ms: default_base_delay_ms(),
            max_delay_ms: default_max_delay_ms(),
        }
    }
}

fn default_max_attempts() -> u32 {
    3
}
fn default_base_delay_ms() -> u64 {
    100
}
fn default_max_delay_ms() -> u64 {
    2_000
}
fn default_channel_capacity() -> usize {
    DEFAULT_CHANNEL_CAPACITY
}
fn default_max_message_bytes() -> usize {
    DEFAULT_MAX_MESSAGE_BYTES
}
fn default_ack_timeout_ms() -> u64 {
    30_000
}
fn default_dedup_capacity() -> usize {
    4_096
}
fn default_attempt() -> u32 {
    1
}
fn default_protocol_version() -> String {
    PROTOCOL_VERSION.to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SessionConfig {
    pub session_id: String,
    #[serde(default)]
    pub runtime_mode: RuntimeMode,
    #[serde(default = "default_channel_capacity")]
    pub channel_capacity: usize,
    #[serde(default = "default_max_message_bytes")]
    pub max_message_bytes: usize,
    #[serde(default = "default_ack_timeout_ms")]
    pub ack_timeout_ms: u64,
    #[serde(default = "default_dedup_capacity")]
    pub dedup_capacity: usize,
    #[serde(default)]
    pub retry_policy: RetryPolicy,
    #[serde(default)]
    pub deadline: Option<String>,
    #[serde(default)]
    pub metadata: HashMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ChannelConfig {
    pub name: String,
    #[serde(default = "default_channel_capacity")]
    pub capacity: usize,
    #[serde(default)]
    pub overflow_policy: OverflowPolicy,
    #[serde(default)]
    pub requires_ack: bool,
    #[serde(default)]
    pub metadata: HashMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MessageEnvelope {
    #[serde(default = "default_protocol_version")]
    pub protocol_version: String,
    pub message_id: String,
    pub session_id: String,
    pub channel: String,
    pub kind: String,
    pub source: String,
    #[serde(default)]
    pub target: Option<String>,
    pub sequence: u64,
    pub created_at: String,
    #[serde(default)]
    pub deadline: Option<String>,
    #[serde(default)]
    pub correlation_id: Option<String>,
    #[serde(default)]
    pub causation_id: Option<String>,
    #[serde(default)]
    pub idempotency_key: Option<String>,
    #[serde(default = "default_attempt")]
    pub attempt: u32,
    #[serde(default)]
    pub requires_ack: bool,
    pub payload_type: String,
    pub payload: Value,
    #[serde(default)]
    pub metadata: HashMap<String, Value>,
}

impl MessageEnvelope {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        negotiate_version(&self.protocol_version)?;
        for (name, value) in [
            ("message_id", &self.message_id),
            ("session_id", &self.session_id),
            ("channel", &self.channel),
            ("kind", &self.kind),
            ("source", &self.source),
            ("payload_type", &self.payload_type),
        ] {
            if value.is_empty() {
                return Err(ProtocolError(format!("{name} must not be empty")));
            }
        }
        if self.attempt == 0 {
            return Err(ProtocolError("attempt must be at least 1".to_string()));
        }
        Ok(())
    }

    pub fn encoded_size(&self) -> Result<usize, serde_json::Error> {
        serde_json::to_vec(self).map(|bytes| bytes.len())
    }

    pub fn next_attempt(&self) -> Self {
        let mut next = self.clone();
        next.attempt += 1;
        next
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DeliveryAck {
    pub message_id: String,
    pub processed_at: String,
    #[serde(default)]
    pub metadata: HashMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DeliveryNack {
    pub message_id: String,
    pub code: String,
    pub message: String,
    #[serde(default)]
    pub retryable: bool,
    pub processed_at: String,
    #[serde(default)]
    pub metadata: HashMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProcessError {
    pub code: String,
    pub message: String,
    pub process_id: String,
    #[serde(default)]
    pub retryable: bool,
    #[serde(default)]
    pub details: HashMap<String, Value>,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkerCapabilities {
    pub worker_id: String,
    pub runtime: String,
    pub os: String,
    pub architecture: String,
    pub cpu_cores: u32,
    pub memory_bytes: u64,
    #[serde(default)]
    pub cuda: bool,
    #[serde(default)]
    pub cuda_devices: Vec<String>,
    #[serde(default)]
    pub profiles: Vec<String>,
    #[serde(default)]
    pub operations: Vec<String>,
    #[serde(default)]
    pub metadata: HashMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ArtifactRef {
    pub artifact_id: String,
    pub uri: String,
    pub sha256: String,
    pub size_bytes: u64,
    pub media_type: String,
    #[serde(default)]
    pub metadata: HashMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrainingJob {
    pub job_id: String,
    pub dataset: ArtifactRef,
    pub output: String,
    #[serde(default)]
    pub config: HashMap<String, Value>,
    #[serde(default)]
    pub requested_capabilities: Vec<String>,
    #[serde(default)]
    pub deadline: Option<String>,
    pub idempotency_key: String,
    #[serde(default)]
    pub metadata: HashMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EvaluationJob {
    pub job_id: String,
    pub model: ArtifactRef,
    pub dataset: ArtifactRef,
    pub output: String,
    #[serde(default)]
    pub config: HashMap<String, Value>,
    #[serde(default)]
    pub requested_capabilities: Vec<String>,
    #[serde(default)]
    pub deadline: Option<String>,
    pub idempotency_key: String,
    #[serde(default)]
    pub metadata: HashMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobProgress {
    pub job_id: String,
    pub phase: String,
    pub status: String,
    pub step: u64,
    pub total_steps: u64,
    pub progress: f64,
    #[serde(default)]
    pub loss: Option<f64>,
    #[serde(default)]
    pub metrics: HashMap<String, Value>,
    #[serde(default)]
    pub message: String,
    pub timestamp: String,
    #[serde(default)]
    pub artifacts: Vec<ArtifactRef>,
}
