use handoffkit_protocol::{
    ArtifactRef, ChannelConfig, DeliveryAck, DeliveryNack, JobProgress, OverflowPolicy,
    RetryPolicy, RuntimeMode, SessionConfig, DEFAULT_MAX_MESSAGE_BYTES,
};
use handoffkit_runtime::{CspRuntime, DeliveryReceipt, RuntimeError, SessionState};
use serde_json::json;
use std::collections::HashMap;
use std::time::Duration;

fn config(id: &str) -> SessionConfig {
    SessionConfig {
        session_id: id.to_string(),
        runtime_mode: RuntimeMode::Session,
        channel_capacity: 2,
        max_message_bytes: DEFAULT_MAX_MESSAGE_BYTES,
        ack_timeout_ms: 40,
        dedup_capacity: 32,
        retry_policy: RetryPolicy {
            max_attempts: 3,
            base_delay_ms: 1,
            max_delay_ms: 2,
        },
        deadline: None,
        metadata: HashMap::new(),
    }
}

#[tokio::test]
async fn channel_is_fifo_and_closes_cleanly() {
    let runtime = CspRuntime::new();
    let session = runtime.create_session(config("fifo")).await.unwrap();
    let channel = session.open_default_channel("work").await.unwrap();
    for value in 0..3 {
        if value == 2 {
            let receiver = session.clone();
            let task = tokio::spawn(async move { receiver.receive("work").await.unwrap() });
            channel
                .send(session.envelope("work", "data", "test", "json", json!(value)))
                .await
                .unwrap();
            assert_eq!(task.await.unwrap().unwrap().payload, json!(0));
        } else {
            channel
                .send(session.envelope("work", "data", "test", "json", json!(value)))
                .await
                .unwrap();
        }
    }
    assert_eq!(
        session.receive("work").await.unwrap().unwrap().payload,
        json!(1)
    );
    assert_eq!(
        session.receive("work").await.unwrap().unwrap().payload,
        json!(2)
    );
    channel.close().await;
    assert_eq!(session.receive("work").await.unwrap(), None);
    assert_eq!(session.state(), SessionState::Running);
    session.close().await.unwrap();
    assert_eq!(session.state(), SessionState::Closed);
}

#[tokio::test]
async fn blocking_backpressure_waits_for_capacity() {
    let runtime = CspRuntime::new();
    let mut session_config = config("backpressure");
    session_config.channel_capacity = 1;
    let session = runtime.create_session(session_config).await.unwrap();
    let channel = session.open_default_channel("work").await.unwrap();
    channel
        .send(session.envelope("work", "data", "test", "json", json!(1)))
        .await
        .unwrap();
    let sender = channel.clone();
    let second = session.envelope("work", "data", "test", "json", json!(2));
    let blocked = tokio::spawn(async move { sender.send(second).await });
    tokio::time::sleep(Duration::from_millis(20)).await;
    assert!(!blocked.is_finished());
    assert_eq!(channel.receive().await.unwrap().unwrap().payload, json!(1));
    blocked.await.unwrap().unwrap();
    assert_eq!(channel.receive().await.unwrap().unwrap().payload, json!(2));
}

#[tokio::test]
async fn reject_policy_reports_backpressure() {
    let runtime = CspRuntime::new();
    let session = runtime.create_session(config("reject")).await.unwrap();
    let channel = session
        .open_channel(ChannelConfig {
            name: "work".to_string(),
            capacity: 1,
            overflow_policy: OverflowPolicy::Reject,
            requires_ack: false,
            metadata: HashMap::new(),
        })
        .await
        .unwrap();
    channel
        .send(session.envelope("work", "data", "test", "json", json!(1)))
        .await
        .unwrap();
    let error = channel
        .send(session.envelope("work", "data", "test", "json", json!(2)))
        .await
        .unwrap_err();
    assert_eq!(error.code, "backpressure");
    assert!(error.retryable);
}

#[tokio::test]
async fn acknowledgement_channel_rejects_untracked_send() {
    let runtime = CspRuntime::new();
    let session = runtime.create_session(config("ack-channel")).await.unwrap();
    let channel = session
        .open_channel(ChannelConfig {
            name: "work".to_string(),
            capacity: 1,
            overflow_policy: OverflowPolicy::Block,
            requires_ack: true,
            metadata: HashMap::new(),
        })
        .await
        .unwrap();
    let error = channel
        .send(session.envelope("work", "data", "test", "json", json!(1)))
        .await
        .unwrap_err();
    assert_eq!(error.code, "ack_required");
}

#[tokio::test]
async fn cancellation_interrupts_receive() {
    let runtime = CspRuntime::new();
    let session = runtime.create_session(config("cancel")).await.unwrap();
    session.open_default_channel("work").await.unwrap();
    let receiver = session.clone();
    let waiting = tokio::spawn(async move { receiver.receive("work").await });
    tokio::time::sleep(Duration::from_millis(10)).await;
    session.cancel();
    let error = waiting.await.unwrap().unwrap_err();
    assert_eq!(error.code, "cancelled");
    assert_eq!(session.state(), SessionState::Cancelled);
}

#[tokio::test]
async fn cancellation_interrupts_select_and_close_finalizes_session() {
    let runtime = CspRuntime::new();
    let session = runtime
        .create_session(config("select-cancel"))
        .await
        .unwrap();
    session.open_default_channel("first").await.unwrap();
    session.open_default_channel("second").await.unwrap();
    let receiver = session.clone();
    let waiting = tokio::spawn(async move { receiver.select(&["first", "second"]).await });
    tokio::time::sleep(Duration::from_millis(10)).await;
    session.cancel();
    let error = waiting.await.unwrap().unwrap_err();
    assert_eq!(error.code, "cancelled");
    session.close().await.unwrap();
    assert_eq!(session.state(), SessionState::Closed);
    assert!(session.channel("first").await.unwrap().is_closed());
}

#[tokio::test]
async fn session_deadline_interrupts_operations() {
    let mut deadline_config = config("deadline");
    deadline_config.deadline = Some(
        (chrono::Utc::now() + chrono::Duration::milliseconds(30))
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
    );
    let runtime = CspRuntime::new();
    let session = runtime.create_session(deadline_config).await.unwrap();
    session.open_default_channel("work").await.unwrap();
    let error = session.receive("work").await.unwrap_err();
    assert_eq!(error.code, "deadline_exceeded");
}

#[tokio::test]
async fn session_deadline_interrupts_select() {
    let mut deadline_config = config("select-deadline");
    deadline_config.deadline = Some(
        (chrono::Utc::now() + chrono::Duration::milliseconds(30))
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
    );
    let runtime = CspRuntime::new();
    let session = runtime.create_session(deadline_config).await.unwrap();
    session.open_default_channel("first").await.unwrap();
    session.open_default_channel("second").await.unwrap();
    let error = session.select(&["first", "second"]).await.unwrap_err();
    assert_eq!(error.code, "deadline_exceeded");
}

#[tokio::test]
async fn session_deadline_never_extends_an_earlier_envelope_deadline() {
    let mut deadline_config = config("deadline-inheritance");
    deadline_config.deadline = Some(
        (chrono::Utc::now() + chrono::Duration::seconds(60))
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
    );
    let runtime = CspRuntime::new();
    let session = runtime.create_session(deadline_config).await.unwrap();
    session.open_default_channel("work").await.unwrap();
    let earlier = (chrono::Utc::now() + chrono::Duration::seconds(10))
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let mut envelope = session.envelope("work", "data", "test", "json", json!({}));
    envelope.deadline = Some(earlier.clone());
    session.send("work", envelope).await.unwrap();
    assert_eq!(
        session.receive("work").await.unwrap().unwrap().deadline,
        Some(earlier)
    );
}

#[tokio::test]
async fn ack_completes_delivery() {
    let runtime = CspRuntime::new();
    let session = runtime.create_session(config("ack")).await.unwrap();
    session.open_default_channel("work").await.unwrap();
    let consumer = session.clone();
    let task = tokio::spawn(async move {
        let envelope = consumer.receive("work").await.unwrap().unwrap();
        consumer
            .ack(DeliveryAck {
                message_id: envelope.message_id,
                processed_at: handoffkit_protocol::utc_now(),
                metadata: HashMap::new(),
            })
            .await;
    });
    let envelope = session.envelope("work", "data", "producer", "json", json!({"ok": true}));
    let receipt = session.send_with_ack("work", envelope).await.unwrap();
    assert!(matches!(receipt, DeliveryReceipt::Ack(_)));
    task.await.unwrap();
}

#[tokio::test]
async fn retry_reuses_identity_and_deduplicates() {
    let runtime = CspRuntime::new();
    let session = runtime.create_session(config("retry")).await.unwrap();
    session.open_default_channel("work").await.unwrap();
    let consumer = session.clone();
    let task = tokio::spawn(async move {
        let first = consumer.receive("work").await.unwrap().unwrap();
        consumer
            .nack(DeliveryNack {
                message_id: first.message_id.clone(),
                code: "temporary".to_string(),
                message: "retry".to_string(),
                retryable: true,
                processed_at: handoffkit_protocol::utc_now(),
                metadata: HashMap::new(),
            })
            .await;
        let duplicate = consumer
            .channel("work")
            .await
            .unwrap()
            .receive()
            .await
            .unwrap()
            .unwrap();
        assert_eq!(duplicate.message_id, first.message_id);
        assert_eq!(duplicate.attempt, 2);
        consumer
            .ack(DeliveryAck {
                message_id: duplicate.message_id,
                processed_at: handoffkit_protocol::utc_now(),
                metadata: HashMap::new(),
            })
            .await;
    });
    let envelope = session.envelope("work", "data", "producer", "json", json!({"ok": true}));
    let message_id = envelope.message_id.clone();
    let receipt = session.send_with_ack("work", envelope).await.unwrap();
    match receipt {
        DeliveryReceipt::Ack(ack) => assert_eq!(ack.message_id, message_id),
        DeliveryReceipt::Nack(_) => panic!("expected ACK"),
    }
    task.await.unwrap();
}

#[tokio::test]
async fn session_receive_suppresses_duplicate_idempotency_keys() {
    let runtime = CspRuntime::new();
    let session = runtime.create_session(config("dedup")).await.unwrap();
    let channel = session.open_default_channel("work").await.unwrap();
    let first = session.envelope("work", "data", "test", "json", json!(1));
    let mut duplicate = first.clone();
    duplicate.message_id = "different-message".to_string();
    let third = session.envelope("work", "data", "test", "json", json!(3));
    channel.send(first).await.unwrap();
    channel.send(duplicate).await.unwrap();
    let producer = channel.clone();
    let producer_task = tokio::spawn(async move { producer.send(third).await.unwrap() });
    assert_eq!(
        session.receive("work").await.unwrap().unwrap().payload,
        json!(1)
    );
    assert_eq!(
        session.receive("work").await.unwrap().unwrap().payload,
        json!(3)
    );
    producer_task.await.unwrap();
}

#[tokio::test]
async fn failed_process_propagates_structured_error() {
    let runtime = CspRuntime::new();
    let session = runtime.create_session(config("process")).await.unwrap();
    let handle = session
        .spawn("failure", |_context| async {
            Err(RuntimeError::new("worker_failed", "expected failure"))
        })
        .unwrap();
    let error = handle.wait().await.unwrap_err();
    assert_eq!(error.code, "worker_failed");
    session.close().await.unwrap();
}

#[tokio::test]
async fn process_can_be_cancelled_immediately_after_spawn() {
    let runtime = CspRuntime::new();
    let session = runtime
        .create_session(config("process-cancel"))
        .await
        .unwrap();
    let handle = session
        .spawn("long-running", |_context| async {
            std::future::pending::<()>().await;
            Ok(())
        })
        .unwrap();
    assert!(session.cancel_process(handle.id()).await);
    let error = handle.wait().await.unwrap_err();
    assert_eq!(error.code, "cancelled");
    session.close().await.unwrap();
}

#[tokio::test]
async fn session_deadline_cancels_compute_process() {
    let mut deadline_config = config("process-deadline");
    deadline_config.deadline = Some(
        (chrono::Utc::now() + chrono::Duration::milliseconds(25))
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
    );
    let runtime = CspRuntime::new();
    let session = runtime.create_session(deadline_config).await.unwrap();
    let handle = session
        .spawn("long-running", |_context| async {
            std::future::pending::<()>().await;
            Ok(())
        })
        .unwrap();
    let error = handle.wait().await.unwrap_err();
    assert_eq!(error.code, "deadline_exceeded");
    assert_eq!(session.state(), SessionState::Cancelled);
}

#[tokio::test]
async fn process_emits_progress_with_artifact_reference() {
    let runtime = CspRuntime::new();
    let session = runtime.create_session(config("progress")).await.unwrap();
    session.open_default_channel("progress").await.unwrap();
    let handle = session
        .spawn("trainer", |context| async move {
            context
                .progress(
                    "progress",
                    JobProgress {
                        job_id: "job-1".to_string(),
                        phase: "evaluation".to_string(),
                        status: "running".to_string(),
                        step: 1,
                        total_steps: 2,
                        progress: 0.5,
                        loss: None,
                        metrics: HashMap::new(),
                        message: "halfway".to_string(),
                        timestamp: handoffkit_protocol::utc_now(),
                        artifacts: vec![ArtifactRef {
                            artifact_id: "report".to_string(),
                            uri: "file:///tmp/report.json".to_string(),
                            sha256:
                                "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
                                    .to_string(),
                            size_bytes: 42,
                            media_type: "application/json".to_string(),
                            metadata: HashMap::new(),
                        }],
                    },
                )
                .await
        })
        .unwrap();
    let envelope = session.receive("progress").await.unwrap().unwrap();
    let progress: JobProgress = serde_json::from_value(envelope.payload).unwrap();
    assert_eq!(progress.artifacts[0].artifact_id, "report");
    handle.wait().await.unwrap();
    session.close().await.unwrap();
}
