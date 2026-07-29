use handoffkit_protocol::{
    sanitize_error_message, validation_error_code, ArtifactRef, ChannelConfig, DeliveryAck,
    DeliveryNack, JobProgress, MessageEnvelope, ProcessError, RetryPolicy, RuntimeMode,
    SessionConfig, WorkerCapabilities, DEFAULT_MAX_MESSAGE_BYTES,
};
use proptest::prelude::*;
use serde::de::DeserializeOwned;
use serde_json::{json, Map, Value};
use std::collections::HashMap;

fn property_config() -> ProptestConfig {
    ProptestConfig {
        cases: 128,
        failure_persistence: None,
        ..ProptestConfig::default()
    }
}

fn json_value() -> impl Strategy<Value = Value> {
    let leaf = prop_oneof![
        Just(Value::Null),
        any::<bool>().prop_map(Value::Bool),
        (-10_000_i64..=10_000).prop_map(|value| json!(value)),
        ".{0,32}".prop_map(Value::String),
    ];
    leaf.prop_recursive(4, 32, 4, |inner| {
        prop_oneof![
            prop::collection::vec(inner.clone(), 0..4).prop_map(Value::Array),
            prop::collection::hash_map("[A-Za-z0-9]{1,8}", inner, 0..4)
                .prop_map(|items| Value::Object(items.into_iter().collect::<Map<_, _>>())),
        ]
    })
}

fn validate_case<T, E, F>(value: &Value, validate: F) -> Result<Value, String>
where
    T: DeserializeOwned + serde::Serialize,
    E: ToString,
    F: FnOnce(&T) -> Result<(), E>,
{
    let decoded: T = serde_json::from_value(value.clone()).map_err(|error| error.to_string())?;
    validate(&decoded).map_err(|error| error.to_string())?;
    serde_json::to_value(decoded).map_err(|error| error.to_string())
}

#[test]
fn shared_differential_validation_corpus() {
    let corpus: Value = serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../contracts/corpus/csp-validation.json"
    )))
    .unwrap();
    for case in corpus["cases"].as_array().unwrap() {
        let kind = case["kind"].as_str().unwrap();
        let value = &case["value"];
        let result = match kind {
            "message_envelope" => {
                validate_case::<MessageEnvelope, _, _>(value, MessageEnvelope::validate)
            }
            "session_config" => {
                validate_case::<SessionConfig, _, _>(value, SessionConfig::validate)
            }
            "channel_config" => {
                validate_case::<ChannelConfig, _, _>(value, ChannelConfig::validate)
            }
            "delivery_ack" => validate_case::<DeliveryAck, _, _>(value, DeliveryAck::validate),
            "delivery_nack" => validate_case::<DeliveryNack, _, _>(value, DeliveryNack::validate),
            "process_error" => validate_case::<ProcessError, _, _>(value, ProcessError::validate),
            "artifact_ref" => validate_case::<ArtifactRef, _, _>(value, ArtifactRef::validate),
            "worker_capabilities" => {
                validate_case::<WorkerCapabilities, _, _>(value, WorkerCapabilities::validate)
            }
            "job_progress" => validate_case::<JobProgress, _, _>(value, JobProgress::validate),
            "security_config" => {
                let decoded: Result<handoffkit_protocol::security::SecurityConfig, _> = serde_json::from_value(value.clone());
                match decoded {
                    Ok(cfg) => serde_json::to_value(cfg).map_err(|e| e.to_string()),
                    Err(_) => Err("invalid_profile".to_string()),
                }
            }
            "peer_identity" => {
                let decoded: Result<handoffkit_protocol::security::PeerIdentity, _> = serde_json::from_value(value.clone());
                match decoded {
                    Ok(peer) => serde_json::to_value(peer).map_err(|e| e.to_string()),
                    Err(e) => Err(e.to_string()),
                }
            }
            unsupported => panic!("unsupported corpus kind: {unsupported}"),
        };
        let id = case["id"].as_str().unwrap();
        if case["valid"].as_bool().unwrap() {
            assert_eq!(result.unwrap(), *value, "{id}");
        } else {
            let error = result.unwrap_err();
            assert_eq!(
                validation_error_code(error),
                case["error_code"].as_str().unwrap(),
                "{id}"
            );
        }
    }
}

proptest! {
    #![proptest_config(property_config())]

    #[test]
    fn envelope_roundtrip_and_retry_preserve_identity(
        message_id in "[A-Za-z0-9]{1,24}",
        session_id in "[A-Za-z0-9]{1,24}",
        channel in "[A-Za-z0-9]{1,24}",
        sequence in any::<u32>(),
        payload in json_value(),
        requires_ack in any::<bool>(),
    ) {
        let envelope = MessageEnvelope {
            protocol_version: "1.0".to_string(),
            message_id,
            session_id,
            channel,
            kind: "data".to_string(),
            source: "property".to_string(),
            target: None,
            sequence: u64::from(sequence),
            created_at: "2026-01-01T00:00:00Z".to_string(),
            deadline: None,
            correlation_id: None,
            causation_id: None,
            idempotency_key: Some("stable-operation".to_string()),
            attempt: 1,
            requires_ack,
            payload_type: "json".to_string(),
            payload,
            metadata: HashMap::new(),
        };
        envelope.validate().unwrap();
        let encoded = serde_json::to_vec(&envelope).unwrap();
        let decoded: MessageEnvelope = serde_json::from_slice(&encoded).unwrap();
        prop_assert_eq!(&decoded, &envelope);
        let retried = envelope.next_attempt();
        prop_assert_eq!(&retried.message_id, &envelope.message_id);
        prop_assert_eq!(&retried.idempotency_key, &envelope.idempotency_key);
        prop_assert_eq!(retried.attempt, envelope.attempt + 1);
    }

    #[test]
    fn configuration_roundtrip(
        capacity in 1_usize..=4096,
        max_message_bytes in 1024_usize..=(16 * 1024 * 1024),
        attempts in 1_u32..=100,
        base_delay in 0_u64..=1000,
        delay_delta in 0_u64..=1000,
    ) {
        let config = SessionConfig {
            session_id: "property".to_string(),
            runtime_mode: RuntimeMode::Session,
            channel_capacity: capacity,
            max_message_bytes,
            ack_timeout_ms: 30_000,
            dedup_capacity: 4096,
            retry_policy: RetryPolicy {
                max_attempts: attempts,
                base_delay_ms: base_delay,
                max_delay_ms: base_delay + delay_delta,
            },
            deadline: None,
            metadata: HashMap::new(),
        };
        config.validate().unwrap();
        let decoded: SessionConfig = serde_json::from_value(serde_json::to_value(&config).unwrap()).unwrap();
        prop_assert_eq!(decoded, config);
    }

    #[test]
    fn sanitization_bounds_and_redacts(secret in "[A-Za-z0-9]{1,80}") {
        let message = format!("failure Bearer {secret} sk-{secret} gsk_{secret} pypi-{secret}\nnext");
        let sanitized = sanitize_error_message(message);
        for prefix in ["Bearer ", "sk-", "gsk_", "pypi-"] {
            let exposed = format!("{}{}", prefix, secret);
            prop_assert!(!sanitized.contains(&exposed));
        }
        prop_assert!(!sanitized.contains('\n'));
        prop_assert!(sanitized.len() <= 2048);
    }
}

#[test]
fn auxiliary_contracts_validate() {
    let ack = DeliveryAck {
        message_id: "message".to_string(),
        processed_at: "2026-01-01T00:00:00Z".to_string(),
        metadata: HashMap::new(),
    };
    assert!(ack.validate().is_ok());
    let mut invalid = ack;
    invalid.message_id.clear();
    assert_eq!(
        validation_error_code(invalid.validate().unwrap_err()),
        "empty_field"
    );
    assert_eq!(DEFAULT_MAX_MESSAGE_BYTES, 8 * 1024 * 1024);
}
