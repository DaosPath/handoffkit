use handoffkit_protocol::{
    DeliveryAck, RetryPolicy, RuntimeMode, SessionConfig, DEFAULT_MAX_MESSAGE_BYTES,
};
use handoffkit_runtime::{CspRuntime, DeliveryReceipt};
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;

fn config(id: &str, capacity: usize) -> SessionConfig {
    SessionConfig {
        session_id: id.to_string(),
        runtime_mode: RuntimeMode::Session,
        channel_capacity: capacity,
        max_message_bytes: DEFAULT_MAX_MESSAGE_BYTES,
        ack_timeout_ms: 2_000,
        dedup_capacity: 100_000,
        retry_policy: RetryPolicy {
            max_attempts: 3,
            base_delay_ms: 0,
            max_delay_ms: 0,
        },
        deadline: None,
        metadata: HashMap::new(),
    }
}

fn load_profile() -> (usize, usize, usize) {
    match std::env::var("HK_CSP_STRESS_PROFILE").as_deref() {
        Ok("stress") => (20_000, 32, 16),
        Ok("soak") => (100_000, 40, 20),
        _ => (512, 8, 4),
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn many_producers_consumers_capacity_one_complete_without_loss() {
    let (messages, producers, consumers) = load_profile();
    assert_eq!(messages % producers, 0);
    assert_eq!(messages % consumers, 0);
    let runtime = CspRuntime::new();
    let session = runtime.create_session(config("stress", 1)).await.unwrap();
    session.open_default_channel("work").await.unwrap();
    let received = Arc::new(Mutex::new(Vec::with_capacity(messages)));

    let mut consumer_tasks = Vec::new();
    for _ in 0..consumers {
        let consumer = session.clone();
        let output = Arc::clone(&received);
        consumer_tasks.push(tokio::spawn(async move {
            for _ in 0..(messages / consumers) {
                let envelope = consumer.receive("work").await.unwrap().unwrap();
                output.lock().await.push(envelope.sequence as usize);
            }
        }));
    }

    let mut producer_tasks = Vec::new();
    for producer in 0..producers {
        let sender = session.clone();
        producer_tasks.push(tokio::spawn(async move {
            for offset in 0..(messages / producers) {
                let sequence = producer * (messages / producers) + offset;
                let envelope = sender.envelope("work", "data", "producer", "json", json!(sequence));
                sender.send("work", envelope).await.unwrap();
            }
        }));
    }

    tokio::time::timeout(Duration::from_secs(30), async {
        for task in producer_tasks {
            task.await.unwrap();
        }
        for task in consumer_tasks {
            task.await.unwrap();
        }
    })
    .await
    .expect("stress harness deadlocked");

    let delivered = received.lock().await;
    assert_eq!(delivered.len(), messages);
    assert_eq!(
        delivered.iter().copied().collect::<HashSet<_>>().len(),
        messages
    );
    drop(delivered);
    session.close().await.unwrap();
    assert_eq!(session.diagnostics().await.process_count, 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn simultaneous_acknowledgements_resolve_matching_messages() {
    let runtime = CspRuntime::new();
    let session = runtime
        .create_session(config("ack-stress", 8))
        .await
        .unwrap();
    session.open_default_channel("work").await.unwrap();
    let consumer = session.clone();
    let worker = tokio::spawn(async move {
        for _ in 0..64 {
            let envelope = consumer.receive("work").await.unwrap().unwrap();
            assert!(
                consumer
                    .ack(DeliveryAck {
                        message_id: envelope.message_id,
                        processed_at: handoffkit_protocol::utc_now(),
                        metadata: HashMap::new(),
                    })
                    .await
            );
        }
    });
    let mut sends = Vec::new();
    for sequence in 0..64 {
        let sender = session.clone();
        sends.push(tokio::spawn(async move {
            let envelope = sender.envelope("work", "data", "producer", "json", json!(sequence));
            let expected = envelope.message_id.clone();
            match sender.send_with_ack("work", envelope).await.unwrap() {
                DeliveryReceipt::Ack(ack) => assert_eq!(ack.message_id, expected),
                DeliveryReceipt::Nack(_) => panic!("unexpected NACK"),
            }
        }));
    }
    for send in sends {
        send.await.unwrap();
    }
    worker.await.unwrap();
    assert_eq!(session.diagnostics().await.pending_ack_count, 0);
    session.close().await.unwrap();
}

#[tokio::test]
async fn closing_capacity_one_wakes_blocked_sender() {
    let runtime = CspRuntime::new();
    let session = runtime
        .create_session(config("close-blocked", 1))
        .await
        .unwrap();
    let channel = session.open_default_channel("work").await.unwrap();
    channel
        .send(session.envelope("work", "data", "test", "json", json!(1)))
        .await
        .unwrap();
    let blocked_channel = channel.clone();
    let blocked_envelope = session.envelope("work", "data", "test", "json", json!(2));
    let blocked = tokio::spawn(async move { blocked_channel.send(blocked_envelope).await });
    tokio::time::sleep(Duration::from_millis(10)).await;
    assert!(!blocked.is_finished());
    channel.close().await;
    let error = tokio::time::timeout(Duration::from_secs(1), blocked)
        .await
        .unwrap()
        .unwrap()
        .unwrap_err();
    assert_eq!(error.code, "channel_closed");
    session.close().await.unwrap();
}
