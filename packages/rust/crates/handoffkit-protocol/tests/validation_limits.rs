use handoffkit_protocol::{
    json_depth, sanitize_error_message, ChannelConfig, MessageEnvelope, OverflowPolicy,
    RetryPolicy, RuntimeMode, SessionConfig, ValidationLimits, PROTOCOL_VERSION,
};
use serde_json::json;
use std::collections::HashMap;

fn envelope() -> MessageEnvelope {
    MessageEnvelope {
        protocol_version: PROTOCOL_VERSION.to_string(),
        message_id: "msg-1".to_string(),
        session_id: "session-1".to_string(),
        channel: "work".to_string(),
        kind: "data".to_string(),
        source: "producer".to_string(),
        target: Some("consumer".to_string()),
        sequence: 1,
        created_at: "2026-01-01T00:00:00Z".to_string(),
        deadline: Some("2026-01-01T00:01:00Z".to_string()),
        correlation_id: None,
        causation_id: None,
        idempotency_key: Some("work-1".to_string()),
        attempt: 1,
        requires_ack: false,
        payload_type: "json".to_string(),
        payload: json!({"ok": true}),
        metadata: HashMap::new(),
    }
}

#[test]
fn validates_size_depth_and_timestamps() {
    let message = envelope();
    message.validate().unwrap();
    assert!(message
        .validate_with_limits(ValidationLimits {
            max_message_bytes: 10,
            max_nesting_depth: 64,
        })
        .unwrap_err()
        .0
        .contains("exceeds"));

    let mut deep = message.clone();
    deep.payload = json!({"one": {"two": {"three": true}}});
    assert!(deep
        .validate_with_limits(ValidationLimits {
            max_message_bytes: 8 * 1024 * 1024,
            max_nesting_depth: 3,
        })
        .is_err());

    let mut invalid_time = message;
    invalid_time.created_at = "tomorrow".to_string();
    assert!(invalid_time.validate().is_err());
}

#[test]
fn validates_session_channel_and_retry_configuration() {
    let config = SessionConfig {
        session_id: "session".to_string(),
        runtime_mode: RuntimeMode::Session,
        channel_capacity: 64,
        max_message_bytes: 1024,
        ack_timeout_ms: 100,
        dedup_capacity: 10,
        retry_policy: RetryPolicy::default(),
        deadline: None,
        metadata: HashMap::new(),
    };
    config.validate().unwrap();
    let mut invalid = config;
    invalid.channel_capacity = 0;
    assert!(invalid.validate().is_err());

    let channel = ChannelConfig {
        name: "work".to_string(),
        capacity: 1,
        overflow_policy: OverflowPolicy::Block,
        requires_ack: false,
        metadata: HashMap::new(),
    };
    channel.validate().unwrap();
}

#[test]
fn computes_backoff_and_sanitizes_errors() {
    let retry = RetryPolicy {
        max_attempts: 4,
        base_delay_ms: 10,
        max_delay_ms: 25,
    };
    assert_eq!(retry.delay_ms(1), 10);
    assert_eq!(retry.delay_ms(2), 20);
    assert_eq!(retry.delay_ms(3), 25);
    assert_eq!(sanitize_error_message("bad\nline\r\0"), "bad line ");
    assert_eq!(
        sanitize_error_message("request failed with Bearer secret-token and sk-example"),
        "request failed with Bearer [REDACTED] and sk-[REDACTED]"
    );
    assert_eq!(json_depth(&json!({"a": [1, {"b": true}]})), 4);
}
