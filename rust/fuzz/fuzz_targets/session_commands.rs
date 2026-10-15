#![no_main]

use handoffkit_protocol::{RetryPolicy, RuntimeMode, SessionConfig, DEFAULT_MAX_MESSAGE_BYTES};
use handoffkit_runtime::CspRuntime;
use libfuzzer_sys::fuzz_target;
use serde_json::json;
use std::collections::HashMap;
use std::time::Duration;

fuzz_target!(|data: &[u8]| {
    if data.len() > 128 {
        return;
    }
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let _ = runtime.block_on(async {
        let config = SessionConfig {
            session_id: "fuzz".to_string(),
            runtime_mode: RuntimeMode::Session,
            channel_capacity: 4,
            max_message_bytes: DEFAULT_MAX_MESSAGE_BYTES,
            ack_timeout_ms: 5,
            dedup_capacity: 32,
            retry_policy: RetryPolicy {
                max_attempts: 2,
                base_delay_ms: 0,
                max_delay_ms: 0,
            },
            deadline: None,
            metadata: HashMap::new(),
        };
        let csp = CspRuntime::new();
        let session = csp.create_session(config).await?;
        let channel = session.open_default_channel("work").await?;
        for (sequence, command) in data.iter().enumerate() {
            match command % 5 {
                0 if channel.len() < channel.max_capacity() => {
                    let envelope = session.envelope("work", "data", "fuzzer", "json", json!(sequence));
                    let _ = session.send("work", envelope).await;
                }
                1 if !channel.is_empty() => {
                    let _ = session.receive("work").await;
                }
                2 => session.cancel(),
                3 => {
                    let _ = tokio::time::timeout(Duration::from_millis(20), session.close()).await;
                }
                _ => {}
            }
        }
        let _ = tokio::time::timeout(Duration::from_millis(20), session.close()).await;
        Ok::<(), handoffkit_runtime::RuntimeError>(())
    });
});
