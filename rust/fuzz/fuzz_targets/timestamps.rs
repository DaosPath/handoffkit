#![no_main]

use handoffkit_protocol::{MessageEnvelope, PROTOCOL_VERSION};
use libfuzzer_sys::fuzz_target;
use serde_json::json;
use std::collections::HashMap;

fuzz_target!(|data: &[u8]| {
    if data.len() > 4096 {
        return;
    }
    let timestamp = String::from_utf8_lossy(data).into_owned();
    let envelope = MessageEnvelope {
        protocol_version: PROTOCOL_VERSION.to_string(),
        message_id: "fuzz".to_string(),
        session_id: "fuzz".to_string(),
        channel: "fuzz".to_string(),
        kind: "data".to_string(),
        source: "fuzzer".to_string(),
        target: None,
        sequence: 0,
        created_at: timestamp.clone(),
        deadline: Some(timestamp),
        correlation_id: None,
        causation_id: None,
        idempotency_key: None,
        attempt: 1,
        requires_ack: false,
        payload_type: "json".to_string(),
        payload: json!({}),
        metadata: HashMap::new(),
    };
    let _ = envelope.validate();
});

