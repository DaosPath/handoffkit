//! HK-CSP 1.0 wire contracts.
//!
//! This crate contains no async runtime and no transport dependencies.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fmt::{Display, Formatter};

mod durable_replay;
pub mod security;

pub const PROTOCOL_VERSION: &str = "1.0";
pub const DEFAULT_CHANNEL_CAPACITY: usize = 64;
pub const DEFAULT_MAX_MESSAGE_BYTES: usize = 8 * 1024 * 1024;
pub const DEFAULT_MAX_NESTING_DEPTH: usize = 64;
pub const MIN_MESSAGE_BYTES: usize = 1_024;
pub const MAX_ERROR_MESSAGE_BYTES: usize = 2_048;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProtocolError(pub String);

impl Display for ProtocolError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for ProtocolError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ValidationLimits {
    pub max_message_bytes: usize,
    pub max_nesting_depth: usize,
}

impl Default for ValidationLimits {
    fn default() -> Self {
        Self {
            max_message_bytes: DEFAULT_MAX_MESSAGE_BYTES,
            max_nesting_depth: DEFAULT_MAX_NESTING_DEPTH,
        }
    }
}

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

impl RetryPolicy {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        if self.max_attempts == 0 {
            return Err(ProtocolError(
                "retry_policy.max_attempts must be at least 1".to_string(),
            ));
        }
        if self.max_attempts > 100 {
            return Err(ProtocolError(
                "retry_policy.max_attempts must not exceed 100".to_string(),
            ));
        }
        if self.base_delay_ms > self.max_delay_ms {
            return Err(ProtocolError(
                "retry_policy.base_delay_ms must not exceed max_delay_ms".to_string(),
            ));
        }
        Ok(())
    }

    pub fn delay_ms(&self, attempt: u32) -> u64 {
        let exponent = attempt.saturating_sub(1).min(20);
        self.base_delay_ms
            .saturating_mul(1_u64 << exponent)
            .min(self.max_delay_ms)
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum EdgeProfile {
    EdgeSmall,
    EdgeStandard,
    Server,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EdgeTimeouts {
    pub connect_ms: u64,
    pub io_ms: u64,
    pub ack_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EdgeLoggingPolicy {
    pub level: String,
    pub include_payloads: bool,
    pub redact_paths: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EdgeRuntimeProfile {
    pub name: EdgeProfile,
    pub channel_capacity: usize,
    pub max_frame_bytes: usize,
    pub pending_ack_limit: usize,
    pub dedup_capacity: usize,
    pub durable_replay_capacity: usize,
    pub connection_limit: usize,
    pub heartbeat_seconds: u64,
    pub reconnect: RetryPolicy,
    pub timeout: EdgeTimeouts,
    pub artifact_limit_bytes: u64,
    pub memory_budget_bytes: u64,
    pub durable_state_limit_bytes: u64,
    pub logging: EdgeLoggingPolicy,
    pub security_profile: String,
}

impl EdgeRuntimeProfile {
    pub fn for_profile(name: EdgeProfile) -> Self {
        let mut profile = match name {
            EdgeProfile::EdgeSmall => Self {
                name,
                channel_capacity: 16,
                max_frame_bytes: 1_048_576,
                pending_ack_limit: 32,
                dedup_capacity: 512,
                durable_replay_capacity: 2_048,
                connection_limit: 8,
                heartbeat_seconds: 30,
                reconnect: RetryPolicy {
                    max_attempts: 5,
                    base_delay_ms: 250,
                    max_delay_ms: 5_000,
                },
                timeout: EdgeTimeouts {
                    connect_ms: 5_000,
                    io_ms: 15_000,
                    ack_ms: 10_000,
                },
                artifact_limit_bytes: 16_777_216,
                memory_budget_bytes: 268_435_456,
                durable_state_limit_bytes: 8_388_608,
                logging: EdgeLoggingPolicy {
                    level: "warning".to_string(),
                    include_payloads: false,
                    redact_paths: true,
                },
                security_profile: "standard".to_string(),
            },
            EdgeProfile::EdgeStandard => Self {
                name,
                channel_capacity: 64,
                max_frame_bytes: 4_194_304,
                pending_ack_limit: 128,
                dedup_capacity: 2_048,
                durable_replay_capacity: 10_000,
                connection_limit: 32,
                heartbeat_seconds: 15,
                reconnect: RetryPolicy {
                    max_attempts: 5,
                    base_delay_ms: 100,
                    max_delay_ms: 3_000,
                },
                timeout: EdgeTimeouts {
                    connect_ms: 5_000,
                    io_ms: 30_000,
                    ack_ms: 30_000,
                },
                artifact_limit_bytes: 67_108_864,
                memory_budget_bytes: 1_073_741_824,
                durable_state_limit_bytes: 33_554_432,
                logging: EdgeLoggingPolicy {
                    level: "info".to_string(),
                    include_payloads: false,
                    redact_paths: true,
                },
                security_profile: "standard".to_string(),
            },
            EdgeProfile::Server => Self {
                name,
                channel_capacity: 256,
                max_frame_bytes: 8_388_608,
                pending_ack_limit: 1_024,
                dedup_capacity: 16_384,
                durable_replay_capacity: 100_000,
                connection_limit: 256,
                heartbeat_seconds: 10,
                reconnect: RetryPolicy {
                    max_attempts: 8,
                    base_delay_ms: 50,
                    max_delay_ms: 2_000,
                },
                timeout: EdgeTimeouts {
                    connect_ms: 5_000,
                    io_ms: 60_000,
                    ack_ms: 60_000,
                },
                artifact_limit_bytes: 536_870_912,
                memory_budget_bytes: 4_294_967_296,
                durable_state_limit_bytes: 268_435_456,
                logging: EdgeLoggingPolicy {
                    level: "info".to_string(),
                    include_payloads: false,
                    redact_paths: true,
                },
                security_profile: "standard".to_string(),
            },
        };
        debug_assert!(profile.validate().is_ok());
        profile.name = name;
        profile
    }

    pub fn from_name(name: &str) -> Result<Self, ProtocolError> {
        let profile = match name {
            "edge-small" => EdgeProfile::EdgeSmall,
            "edge-standard" => EdgeProfile::EdgeStandard,
            "server" => EdgeProfile::Server,
            _ => return Err(ProtocolError("edge profile name is invalid".to_string())),
        };
        Ok(Self::for_profile(profile))
    }

    pub fn validate(&self) -> Result<(), ProtocolError> {
        if self.channel_capacity == 0
            || self.max_frame_bytes == 0
            || self.pending_ack_limit == 0
            || self.dedup_capacity == 0
            || self.durable_replay_capacity == 0
            || self.connection_limit == 0
            || self.heartbeat_seconds == 0
            || self.timeout.connect_ms == 0
            || self.timeout.io_ms == 0
            || self.timeout.ack_ms == 0
            || self.artifact_limit_bytes == 0
            || self.memory_budget_bytes == 0
            || self.durable_state_limit_bytes == 0
        {
            return Err(ProtocolError(
                "edge runtime limits must be positive".to_string(),
            ));
        }
        if !(MIN_MESSAGE_BYTES..=DEFAULT_MAX_MESSAGE_BYTES).contains(&self.max_frame_bytes) {
            return Err(ProtocolError("edge max_frame_bytes is invalid".to_string()));
        }
        self.reconnect.validate()?;
        if !matches!(self.logging.level.as_str(), "warning" | "info")
            || self.logging.include_payloads
            || !self.logging.redact_paths
        {
            return Err(ProtocolError("edge logging policy is unsafe".to_string()));
        }
        if self.security_profile != "standard" {
            return Err(ProtocolError(
                "edge profiles require the standard security profile".to_string(),
            ));
        }
        Ok(())
    }

    pub fn session_config(
        &self,
        session_id: impl Into<String>,
    ) -> Result<SessionConfig, ProtocolError> {
        self.validate()?;
        let mut metadata = HashMap::new();
        metadata.insert(
            "edge_profile".to_string(),
            serde_json::to_value(self.name).map_err(|error| ProtocolError(error.to_string()))?,
        );
        let config = SessionConfig {
            session_id: session_id.into(),
            runtime_mode: RuntimeMode::Session,
            channel_capacity: self.channel_capacity,
            max_message_bytes: self.max_frame_bytes,
            ack_timeout_ms: self.timeout.ack_ms,
            dedup_capacity: self.dedup_capacity,
            retry_policy: self.reconnect.clone(),
            deadline: None,
            metadata,
        };
        config.validate()?;
        Ok(config)
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

impl SessionConfig {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        require_nonempty("session_id", &self.session_id)?;
        if self.channel_capacity == 0 {
            return Err(ProtocolError(
                "channel_capacity must be at least 1".to_string(),
            ));
        }
        if self.max_message_bytes < MIN_MESSAGE_BYTES {
            return Err(ProtocolError(format!(
                "max_message_bytes must be at least {MIN_MESSAGE_BYTES}"
            )));
        }
        if self.ack_timeout_ms == 0 {
            return Err(ProtocolError(
                "ack_timeout_ms must be at least 1".to_string(),
            ));
        }
        if self.dedup_capacity == 0 {
            return Err(ProtocolError(
                "dedup_capacity must be at least 1".to_string(),
            ));
        }
        if let Some(deadline) = &self.deadline {
            parse_timestamp("deadline", deadline)?;
        }
        self.retry_policy.validate()
    }
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

impl ChannelConfig {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        require_nonempty("channel.name", &self.name)?;
        if self.capacity == 0 {
            return Err(ProtocolError(
                "channel.capacity must be at least 1".to_string(),
            ));
        }
        Ok(())
    }
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
        self.validate_with_limits(ValidationLimits::default())
    }

    pub fn validate_with_limits(&self, limits: ValidationLimits) -> Result<(), ProtocolError> {
        negotiate_version(&self.protocol_version)?;
        for (name, value) in [
            ("message_id", &self.message_id),
            ("session_id", &self.session_id),
            ("channel", &self.channel),
            ("kind", &self.kind),
            ("source", &self.source),
            ("payload_type", &self.payload_type),
        ] {
            require_nonempty(name, value)?;
        }
        validate_optional_nonempty("target", self.target.as_deref())?;
        validate_optional_nonempty("correlation_id", self.correlation_id.as_deref())?;
        validate_optional_nonempty("causation_id", self.causation_id.as_deref())?;
        validate_optional_nonempty("idempotency_key", self.idempotency_key.as_deref())?;
        if self.attempt == 0 {
            return Err(ProtocolError("attempt must be at least 1".to_string()));
        }
        parse_timestamp("created_at", &self.created_at)?;
        if let Some(deadline) = &self.deadline {
            parse_timestamp("deadline", deadline)?;
        }
        let encoded_size = self
            .encoded_size()
            .map_err(|error| ProtocolError(format!("cannot encode envelope: {error}")))?;
        if encoded_size > limits.max_message_bytes {
            return Err(ProtocolError(format!(
                "message exceeds limit of {} bytes",
                limits.max_message_bytes
            )));
        }
        let payload_depth = json_depth(&self.payload);
        let metadata_depth = self
            .metadata
            .values()
            .map(json_depth)
            .max()
            .unwrap_or(0)
            .saturating_add(1);
        if payload_depth.max(metadata_depth) > limits.max_nesting_depth {
            return Err(ProtocolError(format!(
                "message nesting depth exceeds limit of {}",
                limits.max_nesting_depth
            )));
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

impl DeliveryAck {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        require_nonempty("message_id", &self.message_id)?;
        parse_timestamp("processed_at", &self.processed_at)?;
        Ok(())
    }
}

impl DeliveryNack {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        require_nonempty("message_id", &self.message_id)?;
        require_nonempty("code", &self.code)?;
        parse_timestamp("processed_at", &self.processed_at)?;
        Ok(())
    }
}

impl ProcessError {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        require_nonempty("code", &self.code)?;
        require_nonempty("process_id", &self.process_id)?;
        parse_timestamp("timestamp", &self.timestamp)?;
        Ok(())
    }

    pub fn sanitized(mut self) -> Self {
        self.message = sanitize_error_message(&self.message);
        self
    }
}

impl ArtifactRef {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        require_nonempty("artifact_id", &self.artifact_id)?;
        require_nonempty("uri", &self.uri)?;
        require_nonempty("sha256", &self.sha256)?;
        require_nonempty("media_type", &self.media_type)?;
        if self.sha256.len() != 64 || !self.sha256.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(ProtocolError(
                "sha256 must contain exactly 64 hexadecimal characters".to_string(),
            ));
        }
        Ok(())
    }
}

impl WorkerCapabilities {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        require_nonempty("worker_id", &self.worker_id)?;
        require_nonempty("runtime", &self.runtime)?;
        require_nonempty("os", &self.os)?;
        require_nonempty("architecture", &self.architecture)?;
        if self.cpu_cores == 0 {
            return Err(ProtocolError("cpu_cores must be at least 1".to_string()));
        }
        Ok(())
    }
}

impl TrainingJob {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        require_nonempty("job_id", &self.job_id)?;
        require_nonempty("output", &self.output)?;
        require_nonempty("idempotency_key", &self.idempotency_key)?;
        self.dataset.validate()?;
        if let Some(deadline) = &self.deadline {
            parse_timestamp("deadline", deadline)?;
        }
        Ok(())
    }
}

impl EvaluationJob {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        require_nonempty("job_id", &self.job_id)?;
        require_nonempty("output", &self.output)?;
        require_nonempty("idempotency_key", &self.idempotency_key)?;
        self.model.validate()?;
        self.dataset.validate()?;
        if let Some(deadline) = &self.deadline {
            parse_timestamp("deadline", deadline)?;
        }
        Ok(())
    }
}

impl JobProgress {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        require_nonempty("job_id", &self.job_id)?;
        require_nonempty("phase", &self.phase)?;
        require_nonempty("status", &self.status)?;
        parse_timestamp("timestamp", &self.timestamp)?;
        if !self.progress.is_finite() || !(0.0..=1.0).contains(&self.progress) {
            return Err(ProtocolError(
                "progress must be a finite number between 0 and 1".to_string(),
            ));
        }
        if self.step > self.total_steps {
            return Err(ProtocolError(
                "step must not exceed total_steps".to_string(),
            ));
        }
        for artifact in &self.artifacts {
            artifact.validate()?;
        }
        Ok(())
    }
}

impl WorkerHeartbeat {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        require_nonempty("worker_id", &self.worker_id)?;
        parse_timestamp("timestamp", &self.timestamp)?;
        if !self.load.is_finite() || !(0.0..=1.0).contains(&self.load) {
            return Err(ProtocolError(
                "load must be a finite number between 0 and 1".to_string(),
            ));
        }
        Ok(())
    }
}

impl DistributedJob {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        require_nonempty("job_id", &self.job_id)?;
        require_nonempty("operation", &self.operation)?;
        require_nonempty("idempotency_key", &self.idempotency_key)?;
        if let Some(deadline) = &self.deadline {
            parse_timestamp("deadline", deadline)?;
        }
        Ok(())
    }
}

impl JobAssignment {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        require_nonempty("assignment_id", &self.assignment_id)?;
        require_nonempty("job_id", &self.job_id)?;
        require_nonempty("worker_id", &self.worker_id)?;
        if self.attempt == 0 {
            return Err(ProtocolError("attempt must be at least 1".to_string()));
        }
        let assigned_at = parse_timestamp("assigned_at", &self.assigned_at)?;
        let lease_deadline = parse_timestamp("lease_deadline", &self.lease_deadline)?;
        if lease_deadline < assigned_at {
            return Err(ProtocolError(
                "lease_deadline must not be earlier than assigned_at".to_string(),
            ));
        }
        Ok(())
    }
}

pub fn utc_now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

pub fn sanitize_error_message(message: impl AsRef<str>) -> String {
    let mut sanitized = message
        .as_ref()
        .replace(['\r', '\n'], " ")
        .replace('\0', "");
    for prefix in ["Bearer ", "sk-", "gsk_", "pypi-"] {
        sanitized = redact_token_after(&sanitized, prefix);
    }
    if sanitized.len() > MAX_ERROR_MESSAGE_BYTES {
        let mut boundary = MAX_ERROR_MESSAGE_BYTES;
        while !sanitized.is_char_boundary(boundary) {
            boundary -= 1;
        }
        sanitized.truncate(boundary);
    }
    sanitized
}

/// Map validation text to a stable code used by differential corpus runners.
pub fn validation_error_code(error: impl Display) -> &'static str {
    let message = error.to_string().to_lowercase();
    for (needle, code) in [
        ("protocol version", "unsupported_version"),
        ("rfc 3339", "invalid_timestamp"),
        ("deadline must not", "invalid_deadline"),
        ("must not be empty", "empty_field"),
        ("at least", "below_minimum"),
        ("must not exceed", "above_maximum"),
        ("nesting depth", "nesting_too_deep"),
        ("message exceeds", "message_too_large"),
        ("invalid_profile", "invalid_profile"),
        ("sha256", "invalid_sha256"),
        ("between 0 and 1", "invalid_progress"),
        ("step must not exceed", "invalid_progress"),
    ] {
        if message.contains(needle) {
            return code;
        }
    }
    "invalid_contract"
}

pub fn json_depth(value: &Value) -> usize {
    match value {
        Value::Array(items) => 1 + items.iter().map(json_depth).max().unwrap_or(0),
        Value::Object(items) => 1 + items.values().map(json_depth).max().unwrap_or(0),
        _ => 1,
    }
}

fn require_nonempty(name: &str, value: &str) -> Result<(), ProtocolError> {
    if value.trim().is_empty() {
        Err(ProtocolError(format!("{name} must not be empty")))
    } else {
        Ok(())
    }
}

fn validate_optional_nonempty(name: &str, value: Option<&str>) -> Result<(), ProtocolError> {
    if value.is_some_and(|item| item.trim().is_empty()) {
        Err(ProtocolError(format!("{name} must not be empty when set")))
    } else {
        Ok(())
    }
}

fn parse_timestamp(
    name: &str,
    value: &str,
) -> Result<chrono::DateTime<chrono::FixedOffset>, ProtocolError> {
    chrono::DateTime::parse_from_rfc3339(value)
        .map_err(|_| ProtocolError(format!("{name} must be an RFC 3339 timestamp")))
}

fn redact_token_after(value: &str, prefix: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut remainder = value;
    while let Some(position) = remainder.find(prefix) {
        let (before, sensitive) = remainder.split_at(position);
        output.push_str(before);
        output.push_str(prefix);
        output.push_str("[REDACTED]");
        let token = &sensitive[prefix.len()..];
        let end = token
            .find(|character: char| {
                character.is_whitespace() || matches!(character, ',' | ';' | ')' | ']' | '}')
            })
            .unwrap_or(token.len());
        remainder = &token[end..];
    }
    output.push_str(remainder);
    output
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkerHeartbeat {
    pub worker_id: String,
    pub sequence: u64,
    pub active_jobs: u32,
    pub load: f64,
    pub timestamp: String,
    #[serde(default)]
    pub metadata: HashMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DistributedJob {
    pub job_id: String,
    pub operation: String,
    pub payload: Value,
    #[serde(default)]
    pub requested_capabilities: Vec<String>,
    pub idempotency_key: String,
    #[serde(default)]
    pub deadline: Option<String>,
    #[serde(default)]
    pub metadata: HashMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobAssignment {
    pub assignment_id: String,
    pub job_id: String,
    pub worker_id: String,
    pub attempt: u32,
    pub assigned_at: String,
    pub lease_deadline: String,
    pub payload: Value,
    #[serde(default)]
    pub metadata: HashMap<String, Value>,
}
