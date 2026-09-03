use handoffkit_protocol::{
    ChannelConfig, DeliveryAck, DeliveryNack, OverflowPolicy, RetryPolicy, RuntimeMode,
    SessionConfig, DEFAULT_MAX_MESSAGE_BYTES,
};
use handoffkit_runtime::{CspRuntime, SessionState};
use proptest::prelude::*;
use serde_json::json;
use std::collections::{HashMap, VecDeque};
use std::time::Duration;

fn config() -> SessionConfig {
    SessionConfig {
        session_id: "state-machine".to_string(),
        runtime_mode: RuntimeMode::Session,
        channel_capacity: 4,
        max_message_bytes: DEFAULT_MAX_MESSAGE_BYTES,
        ack_timeout_ms: 20,
        dedup_capacity: 64,
        retry_policy: RetryPolicy {
            max_attempts: 2,
            base_delay_ms: 0,
            max_delay_ms: 0,
        },
        deadline: None,
        metadata: HashMap::new(),
    }
}

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 64,
        failure_persistence: None,
        ..ProptestConfig::default()
    })]

    #[test]
    fn generated_session_commands_preserve_invariants(commands in prop::collection::vec(0_u8..=7, 1..64)) {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async move {
            let csp = CspRuntime::new();
            let session = csp.create_session(config()).await.unwrap();
            let channel = session.open_channel(ChannelConfig {
                name: "work".to_string(),
                capacity: 4,
                overflow_policy: OverflowPolicy::Reject,
                requires_ack: false,
                metadata: HashMap::new(),
            }).await.unwrap();
            let mut model = VecDeque::new();
            let mut delivered = Vec::new();
            let mut sequence = 0_u64;

            for command in commands {
                match command {
                    0 if session.state() == SessionState::Running && channel.len() < 4 => {
                        let envelope = session.envelope("work", "data", "property", "json", json!({"sequence": sequence}));
                        sequence += 1;
                        model.push_back(envelope.message_id.clone());
                        session.send("work", envelope).await.unwrap();
                    }
                    1 if session.state() == SessionState::Running && !model.is_empty() => {
                        let envelope = session.receive("work").await.unwrap().unwrap();
                        assert_eq!(Some(envelope.message_id.clone()), model.pop_front());
                        delivered.push(envelope);
                    }
                    2 => {
                        assert!(!session.ack(DeliveryAck {
                            message_id: "unknown".to_string(),
                            processed_at: handoffkit_protocol::utc_now(),
                            metadata: HashMap::new(),
                        }).await);
                    }
                    3 => {
                        assert!(!session.nack(DeliveryNack {
                            message_id: "unknown".to_string(),
                            code: "permanent".to_string(),
                            message: "stop".to_string(),
                            retryable: false,
                            processed_at: handoffkit_protocol::utc_now(),
                            metadata: HashMap::new(),
                        }).await);
                    }
                    4 if session.state() == SessionState::Running && channel.len() < 4 => {
                        if let Some(previous) = delivered.last() {
                            let mut duplicate = previous.clone();
                            duplicate.message_id = format!("duplicate-{sequence}");
                            sequence += 1;
                            session.send("work", duplicate).await.unwrap();
                        }
                    }
                    5 => {
                        session.cancel();
                        session.cancel();
                    }
                    6 => {
                        tokio::time::timeout(Duration::from_secs(1), session.close()).await.unwrap().unwrap();
                        tokio::time::timeout(Duration::from_secs(1), session.close()).await.unwrap().unwrap();
                    }
                    7 if session.state() != SessionState::Running => {
                        let envelope = session.envelope("work", "data", "property", "json", json!({}));
                        assert!(session.send("work", envelope).await.is_err());
                    }
                    _ => {}
                }
                let diagnostics = session.diagnostics().await;
                assert!(diagnostics.queued_messages <= 4);
                assert!(diagnostics.pending_ack_count <= 4096);
                assert_eq!(diagnostics.process_count, 0);
            }
            tokio::time::timeout(Duration::from_secs(1), session.close()).await.unwrap().unwrap();
            assert_eq!(session.state(), SessionState::Closed);
            assert_eq!(session.diagnostics().await.process_count, 0);
        });
    }
}
