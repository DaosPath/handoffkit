use handoffkit_protocol::{
    DistributedJob, JobAssignment, RuntimeMode, SessionConfig, WorkerCapabilities, WorkerHeartbeat,
    DEFAULT_MAX_MESSAGE_BYTES,
};
use handoffkit_runtime::{
    heartbeat_now, CspSession, DedupStore, DistributedScheduler, FileDedupStore, WorkerRegistry,
    WorkerStatus,
};
use serde_json::json;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

#[test]
fn distributed_contract_fixtures_roundtrip_canonically() {
    let heartbeat: WorkerHeartbeat = serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../shared/contracts/fixtures/worker_heartbeat.json"
    )))
    .unwrap();
    let job: DistributedJob = serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../shared/contracts/fixtures/distributed_job.json"
    )))
    .unwrap();
    let assignment: JobAssignment = serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../shared/contracts/fixtures/job_assignment.json"
    )))
    .unwrap();
    heartbeat.validate().unwrap();
    job.validate().unwrap();
    assignment.validate().unwrap();
    assert_eq!(
        serde_json::to_value(heartbeat).unwrap()["worker_id"],
        "worker-rust-1"
    );
    assert_eq!(serde_json::to_value(job).unwrap()["job_id"], "job-1");
    assert_eq!(
        serde_json::to_value(assignment).unwrap()["assignment_id"],
        "assignment-1"
    );
}

fn capabilities(worker_id: &str, operations: &[&str]) -> WorkerCapabilities {
    WorkerCapabilities {
        worker_id: worker_id.to_string(),
        runtime: "rust".to_string(),
        os: "linux".to_string(),
        architecture: "x86_64".to_string(),
        cpu_cores: 4,
        memory_bytes: 8 * 1024 * 1024 * 1024,
        cuda: false,
        cuda_devices: Vec::new(),
        profiles: vec!["server".to_string()],
        operations: operations
            .iter()
            .map(|value| (*value).to_string())
            .collect(),
        metadata: HashMap::new(),
    }
}

fn distributed_config(id: &str) -> SessionConfig {
    SessionConfig {
        session_id: id.to_string(),
        runtime_mode: RuntimeMode::Distributed,
        channel_capacity: 4,
        max_message_bytes: DEFAULT_MAX_MESSAGE_BYTES,
        ack_timeout_ms: 100,
        dedup_capacity: 32,
        retry_policy: Default::default(),
        deadline: None,
        metadata: HashMap::new(),
    }
}

fn job(id: &str, key: &str) -> DistributedJob {
    DistributedJob {
        job_id: id.to_string(),
        operation: "evaluate".to_string(),
        payload: json!({"job": id}),
        requested_capabilities: vec!["evaluate".to_string()],
        idempotency_key: key.to_string(),
        deadline: None,
        metadata: HashMap::new(),
    }
}

#[test]
fn file_dedup_store_persists_release_and_capacity() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("dedup.ndjson");
    let store = FileDedupStore::open(&path, 2).unwrap();
    assert!(store.claim("one").unwrap());
    assert!(!store.claim("one").unwrap());
    assert!(store.claim("two").unwrap());
    assert!(store.release("one").unwrap());
    assert!(store.claim("three").unwrap());
    store.compact().unwrap();
    drop(store);

    let reopened = FileDedupStore::open(&path, 2).unwrap();
    assert_eq!(reopened.len(), 2);
    assert!(!reopened.claim("two").unwrap());
    assert!(!reopened.claim("three").unwrap());
    assert!(reopened.claim("four").unwrap());
    assert_eq!(reopened.len(), 2);
}

#[tokio::test]
async fn persistent_dedup_survives_session_restart() {
    let directory = tempfile::tempdir().unwrap();
    let store = Arc::new(FileDedupStore::open(directory.path().join("dedup.ndjson"), 32).unwrap());
    let first =
        CspSession::with_dedup_store(distributed_config("persistent"), store.clone()).unwrap();
    let channel = first.open_default_channel("work").await.unwrap();
    let envelope = first.envelope("work", "data", "test", "json", json!(1));
    channel.send(envelope.clone()).await.unwrap();
    assert_eq!(first.receive("work").await.unwrap(), Some(envelope.clone()));
    first.close().await.unwrap();

    let second = CspSession::with_dedup_store(distributed_config("persistent"), store).unwrap();
    let channel = second.open_default_channel("work").await.unwrap();
    let mut duplicate = envelope;
    duplicate.message_id = "duplicate".to_string();
    let fresh = second.envelope("work", "data", "test", "json", json!(2));
    channel.send(duplicate).await.unwrap();
    channel.send(fresh.clone()).await.unwrap();
    assert_eq!(second.receive("work").await.unwrap(), Some(fresh));
    second.close().await.unwrap();
}

#[tokio::test]
async fn registry_tracks_heartbeat_load_and_disconnects() {
    let registry = WorkerRegistry::new(Duration::from_millis(20)).unwrap();
    assert!(!registry
        .register(capabilities("worker-a", &["evaluate"]), 2)
        .await
        .unwrap());
    assert!(registry
        .heartbeat(&heartbeat_now("worker-a", 1, 1, 0.5))
        .await
        .unwrap());
    assert!(!registry
        .heartbeat(&heartbeat_now("worker-a", 1, 0, 0.0))
        .await
        .unwrap());
    let worker = registry.get("worker-a").await.unwrap();
    assert_eq!(worker.active_jobs, 1);
    assert_eq!(worker.status, WorkerStatus::Online);
    tokio::time::sleep(Duration::from_millis(22)).await;
    assert_eq!(registry.expire_stale().await, vec!["worker-a"]);
    assert_eq!(
        registry.get("worker-a").await.unwrap().status,
        WorkerStatus::Offline
    );
}

#[tokio::test]
async fn scheduler_routes_recovers_and_deduplicates_jobs() {
    let registry = WorkerRegistry::new(Duration::from_secs(1)).unwrap();
    registry
        .register(capabilities("worker-a", &["evaluate"]), 1)
        .await
        .unwrap();
    let scheduler =
        DistributedScheduler::new(registry.clone(), Duration::from_millis(20), 3).unwrap();
    assert!(scheduler
        .submit(job("job-1", "same-operation"))
        .await
        .unwrap());
    assert!(!scheduler
        .submit(job("job-copy", "same-operation"))
        .await
        .unwrap());
    let first = scheduler.schedule_next().await.unwrap().unwrap();
    assert_eq!(first.worker_id, "worker-a");
    assert_eq!(scheduler.recover_worker("worker-a").await, 1);
    assert_eq!(scheduler.snapshot().await.queued_jobs, 1);

    registry
        .register(capabilities("worker-b", &["evaluate"]), 1)
        .await
        .unwrap();
    let retry = scheduler.schedule_next().await.unwrap().unwrap();
    assert_eq!(retry.worker_id, "worker-b");
    assert_eq!(retry.attempt, 2);
    assert!(scheduler.complete(&retry.assignment_id).await);
    let snapshot = scheduler.snapshot().await;
    assert_eq!(snapshot.completed_jobs, 1);
    assert_eq!(snapshot.inflight_jobs, 0);
}

#[tokio::test]
async fn expired_assignment_lease_is_requeued() {
    let registry = WorkerRegistry::new(Duration::from_secs(1)).unwrap();
    registry
        .register(capabilities("worker", &["evaluate"]), 1)
        .await
        .unwrap();
    let scheduler = DistributedScheduler::new(registry, Duration::from_millis(5), 2).unwrap();
    scheduler.submit(job("lease", "lease-key")).await.unwrap();
    scheduler.schedule_next().await.unwrap().unwrap();
    tokio::time::sleep(Duration::from_millis(8)).await;
    assert_eq!(scheduler.recover_expired_leases().await, 1);
    assert_eq!(scheduler.snapshot().await.queued_jobs, 1);
}

#[tokio::test]
async fn scheduler_retry_never_exceeds_queue_capacity() {
    let registry = WorkerRegistry::new(Duration::from_secs(1)).unwrap();
    registry
        .register(capabilities("worker", &["evaluate"]), 1)
        .await
        .unwrap();
    let scheduler =
        DistributedScheduler::with_limits(registry, Duration::from_secs(1), 3, 1, 16).unwrap();
    scheduler.submit(job("job-1", "key-1")).await.unwrap();
    let assignment = scheduler.schedule_next().await.unwrap().unwrap();
    scheduler.submit(job("job-2", "key-2")).await.unwrap();
    assert!(scheduler.fail(&assignment.assignment_id, true).await);
    let snapshot = scheduler.snapshot().await;
    assert_eq!(snapshot.queued_jobs, 1);
    assert_eq!(snapshot.failed_jobs, 1);
}
