use handoffkit_protocol::{
    DistributedJob, JobAssignment, RuntimeMode, SessionConfig, WorkerCapabilities, WorkerHeartbeat,
    DEFAULT_MAX_MESSAGE_BYTES,
};
use handoffkit_runtime::{
    heartbeat_now, CspSession, DedupStore, DistributedScheduler, FileDedupStore,
    FileSchedulerStateStore, RuntimeError, RuntimeResult, SchedulerStateStore, WorkerRegistry,
    WorkerStatus,
};
use serde_json::json;
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::Mutex;
use std::time::Duration;

#[test]
fn distributed_contract_fixtures_roundtrip_canonically() {
    let heartbeat: WorkerHeartbeat = serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../contracts/fixtures/worker_heartbeat.json"
    )))
    .unwrap();
    let job: DistributedJob = serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../contracts/fixtures/distributed_job.json"
    )))
    .unwrap();
    let assignment: JobAssignment = serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../contracts/fixtures/job_assignment.json"
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
    assert_eq!(scheduler.recover_worker("worker-a").await.unwrap(), 1);
    assert_eq!(scheduler.snapshot().await.queued_jobs, 1);

    registry
        .register(capabilities("worker-b", &["evaluate"]), 1)
        .await
        .unwrap();
    let retry = scheduler.schedule_next().await.unwrap().unwrap();
    assert_eq!(retry.worker_id, "worker-b");
    assert_eq!(retry.attempt, 2);
    assert!(scheduler.complete(&retry.assignment_id).await.unwrap());
    let snapshot = scheduler.snapshot().await;
    assert_eq!(snapshot.completed_jobs, 1);
    assert_eq!(snapshot.inflight_jobs, 0);
}

#[tokio::test]
async fn scheduler_rejects_exactly_once_request_before_deduplication() {
    let registry = WorkerRegistry::new(Duration::from_secs(1)).unwrap();
    let scheduler = DistributedScheduler::new(registry, Duration::from_secs(1), 3).unwrap();
    let mut requested = job("job-exactly-once", "key-exactly-once");
    requested
        .metadata
        .insert("require_exactly_once".to_string(), json!(true));
    let error = scheduler.submit(requested).await.unwrap_err();
    assert_eq!(error.code, "exactly_once_unavailable");
    assert_eq!(scheduler.snapshot().await.queued_jobs, 0);
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
    assert_eq!(scheduler.recover_expired_leases().await.unwrap(), 1);
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
    assert!(scheduler
        .fail(&assignment.assignment_id, true)
        .await
        .unwrap());
    let snapshot = scheduler.snapshot().await;
    assert_eq!(snapshot.queued_jobs, 1);
    assert_eq!(snapshot.failed_jobs, 1);
}

#[tokio::test]
async fn scheduler_state_survives_restart_and_requires_explicit_inflight_retry() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("scheduler.json");
    let store = Arc::new(FileSchedulerStateStore::new(&path, 0).unwrap());
    let registry = WorkerRegistry::new(Duration::from_secs(1)).unwrap();
    registry
        .register(capabilities("worker-a", &["evaluate"]), 1)
        .await
        .unwrap();
    let scheduler = DistributedScheduler::with_state_store(
        registry,
        Duration::from_secs(1),
        3,
        16,
        32,
        store.clone(),
    )
    .unwrap();
    assert!(scheduler.submit(job("active", "key-active")).await.unwrap());
    let active = scheduler.schedule_next().await.unwrap().unwrap();
    assert!(scheduler.submit(job("queued", "key-queued")).await.unwrap());
    drop(scheduler);

    let restarted_registry = WorkerRegistry::new(Duration::from_secs(1)).unwrap();
    restarted_registry
        .register(capabilities("worker-b", &["evaluate"]), 1)
        .await
        .unwrap();
    let restarted = DistributedScheduler::with_state_store(
        restarted_registry,
        Duration::from_secs(1),
        3,
        16,
        32,
        store.clone(),
    )
    .unwrap();
    let snapshot = restarted.snapshot().await;
    assert_eq!(snapshot.interrupted_jobs, 1);
    assert_eq!(snapshot.queued_jobs, 1);
    assert!(!restarted
        .submit(job("duplicate", "key-active"))
        .await
        .unwrap());
    assert_eq!(restarted.list_interrupted().await, vec![active.clone()]);
    assert!(restarted
        .retry_interrupted(&active.assignment_id)
        .await
        .unwrap());
    let retry = restarted.schedule_next().await.unwrap().unwrap();
    assert_eq!(retry.job_id, "active");
    assert_eq!(retry.attempt, 2);
    assert!(restarted.complete(&retry.assignment_id).await.unwrap());
    let queued = restarted.schedule_next().await.unwrap().unwrap();
    assert_eq!(queued.job_id, "queued");
    assert!(restarted.complete(&queued.assignment_id).await.unwrap());
    let generation = restarted.state_generation().await;
    assert!(generation >= 8);
    drop(restarted);

    let verified = DistributedScheduler::with_state_store(
        WorkerRegistry::new(Duration::from_secs(1)).unwrap(),
        Duration::from_secs(1),
        3,
        16,
        32,
        store,
    )
    .unwrap();
    let snapshot = verified.snapshot().await;
    assert_eq!(snapshot.completed_jobs, 2);
    assert_eq!(snapshot.queued_jobs, 0);
    assert_eq!(snapshot.inflight_jobs, 0);
    assert_eq!(snapshot.interrupted_jobs, 0);
    assert!(!verified
        .submit(job("duplicate-again", "key-queued"))
        .await
        .unwrap());
}

#[tokio::test]
async fn scheduler_state_opt_in_auto_resume_is_at_least_once() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("scheduler.json");
    let store = Arc::new(FileSchedulerStateStore::new(&path, 0).unwrap());
    let registry = WorkerRegistry::new(Duration::from_secs(1)).unwrap();
    registry
        .register(capabilities("worker-a", &["evaluate"]), 1)
        .await
        .unwrap();
    let scheduler = DistributedScheduler::with_state_store(
        registry,
        Duration::from_secs(1),
        3,
        16,
        32,
        store.clone(),
    )
    .unwrap();
    scheduler.submit(job("active", "key-active")).await.unwrap();
    scheduler.schedule_next().await.unwrap().unwrap();
    drop(scheduler);

    let resumed_registry = WorkerRegistry::new(Duration::from_secs(1)).unwrap();
    resumed_registry
        .register(capabilities("worker-b", &["evaluate"]), 1)
        .await
        .unwrap();
    let resumed = DistributedScheduler::with_state_store_auto_resume(
        resumed_registry,
        Duration::from_secs(1),
        3,
        16,
        32,
        store,
    )
    .unwrap();
    let snapshot = resumed.snapshot().await;
    assert_eq!(snapshot.interrupted_jobs, 0);
    assert_eq!(snapshot.queued_jobs, 1);
    assert_eq!(resumed.schedule_next().await.unwrap().unwrap().attempt, 2);
}

#[tokio::test]
async fn scheduler_state_migrates_supported_v0_envelope() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("scheduler.json");
    let store = Arc::new(FileSchedulerStateStore::new(&path, 0).unwrap());
    let scheduler = DistributedScheduler::with_state_store(
        WorkerRegistry::new(Duration::from_secs(1)).unwrap(),
        Duration::from_secs(1),
        3,
        16,
        32,
        store.clone(),
    )
    .unwrap();
    scheduler.submit(job("queued", "key-queued")).await.unwrap();
    drop(scheduler);
    let mut legacy: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    legacy.as_object_mut().unwrap().remove("checksum");
    legacy.as_object_mut().unwrap().remove("interrupted");
    legacy["format_version"] = json!(0);
    store.commit(&serde_json::to_vec(&legacy).unwrap()).unwrap();

    let migrated = DistributedScheduler::with_state_store(
        WorkerRegistry::new(Duration::from_secs(1)).unwrap(),
        Duration::from_secs(1),
        3,
        16,
        32,
        store.clone(),
    )
    .unwrap();
    assert_eq!(migrated.snapshot().await.queued_jobs, 1);
    let current: serde_json::Value =
        serde_json::from_slice(&store.load().unwrap().unwrap()).unwrap();
    assert_eq!(current["format_version"], json!(1));
    assert!(current.get("interrupted").is_some());
}

#[tokio::test]
async fn scheduler_state_checksum_tamper_is_quarantined() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("scheduler.json");
    let scheduler = DistributedScheduler::with_state_store(
        WorkerRegistry::new(Duration::from_secs(1)).unwrap(),
        Duration::from_secs(1),
        3,
        16,
        32,
        Arc::new(FileSchedulerStateStore::new(&path, 0).unwrap()),
    )
    .unwrap();
    scheduler.submit(job("queued", "key-queued")).await.unwrap();
    drop(scheduler);

    let mut document: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    document["checksum"] = json!("sha256:tampered");
    std::fs::write(&path, serde_json::to_vec(&document).unwrap()).unwrap();
    let result = DistributedScheduler::with_state_store(
        WorkerRegistry::new(Duration::from_secs(1)).unwrap(),
        Duration::from_secs(1),
        3,
        16,
        32,
        Arc::new(FileSchedulerStateStore::new(&path, 0).unwrap()),
    );
    let error = match result {
        Ok(_) => panic!("tampered scheduler state must fail closed"),
        Err(error) => error,
    };
    assert_eq!(error.code, "security_state_corrupt");
    assert!(!path.exists());
    assert!(std::fs::read_dir(directory.path()).unwrap().any(|entry| {
        entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with("scheduler.json.corrupt-")
    }));
}

#[tokio::test]
async fn scheduler_state_backup_and_restore_preserve_validated_state() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("scheduler.json");
    let backup = directory.path().join("backups/scheduler.json");
    let store = Arc::new(FileSchedulerStateStore::new(&path, 0).unwrap());
    let scheduler = DistributedScheduler::with_state_store(
        WorkerRegistry::new(Duration::from_secs(1)).unwrap(),
        Duration::from_secs(1),
        3,
        16,
        32,
        store.clone(),
    )
    .unwrap();
    scheduler.submit(job("backup", "backup-key")).await.unwrap();
    store.backup(&backup).unwrap();
    assert!(backup.exists());
    std::fs::remove_file(&path).unwrap();
    store.restore(&backup).unwrap();

    let restored = DistributedScheduler::with_state_store(
        WorkerRegistry::new(Duration::from_secs(1)).unwrap(),
        Duration::from_secs(1),
        3,
        16,
        32,
        Arc::new(FileSchedulerStateStore::new(&path, 0).unwrap()),
    )
    .unwrap();
    let snapshot = restored.snapshot().await;
    assert_eq!(snapshot.queued_jobs, 1);
    assert!(!restored
        .submit(job("duplicate", "backup-key"))
        .await
        .unwrap());
}

struct FailingSchedulerStore {
    committed: bool,
    payload: Mutex<Vec<u8>>,
}

impl FailingSchedulerStore {
    fn new(committed: bool) -> Self {
        Self {
            committed,
            payload: Mutex::new(Vec::new()),
        }
    }
}

impl SchedulerStateStore for FailingSchedulerStore {
    fn load(&self) -> RuntimeResult<Option<Vec<u8>>> {
        Ok(None)
    }

    fn commit(&self, payload: &[u8]) -> RuntimeResult<()> {
        *self.payload.lock().unwrap() = payload.to_vec();
        let code = if self.committed {
            "scheduler_state_durability_uncertain"
        } else {
            "security_state_write_failed"
        };
        Err(RuntimeError::new(code, "injected scheduler state failure"))
    }

    fn quarantine(&self, _reason: &str) -> RuntimeError {
        RuntimeError::new("unexpected_quarantine", "quarantine should not run")
    }
}

#[tokio::test]
async fn scheduler_commit_outcome_controls_rollback() {
    let uncommitted_store = Arc::new(FailingSchedulerStore::new(false));
    let uncommitted = DistributedScheduler::with_state_store(
        WorkerRegistry::new(Duration::from_secs(1)).unwrap(),
        Duration::from_secs(1),
        3,
        16,
        16,
        uncommitted_store,
    )
    .unwrap();
    let error = uncommitted
        .submit(job("job-commit", "key-commit"))
        .await
        .unwrap_err();
    assert_eq!(error.code, "security_state_write_failed");
    assert_eq!(uncommitted.snapshot().await.queued_jobs, 0);

    let committed_store = Arc::new(FailingSchedulerStore::new(true));
    let committed = DistributedScheduler::with_state_store(
        WorkerRegistry::new(Duration::from_secs(1)).unwrap(),
        Duration::from_secs(1),
        3,
        16,
        16,
        committed_store.clone(),
    )
    .unwrap();
    let submitted = job("job-commit", "key-commit");
    let error = committed.submit(submitted.clone()).await.unwrap_err();
    assert_eq!(error.code, "scheduler_state_durability_uncertain");
    let snapshot = committed.snapshot().await;
    assert_eq!(snapshot.queued_jobs, 1);
    assert_eq!(committed.state_generation().await, 1);
    assert!(!committed.submit(submitted).await.unwrap());
    assert!(!committed_store.payload.lock().unwrap().is_empty());
}

#[tokio::test]
async fn scheduler_never_evicts_active_dedup_identity() {
    let scheduler = DistributedScheduler::with_limits(
        WorkerRegistry::new(Duration::from_secs(1)).unwrap(),
        Duration::from_secs(1),
        3,
        2,
        1,
    )
    .unwrap();
    assert!(scheduler.submit(job("job-1", "key-1")).await.unwrap());
    assert!(!scheduler.submit(job("job-1", "key-2")).await.unwrap());
    let error = scheduler.submit(job("job-2", "key-2")).await.unwrap_err();
    assert_eq!(error.code, "scheduler_backpressure");
    assert_eq!(scheduler.snapshot().await.queued_jobs, 1);
}

#[tokio::test]
async fn rust_loads_shared_durable_scheduler_fixture() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("scheduler.json");
    let fixture = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../contracts/test-fixtures/runtime/durable-scheduler-v1.json"
    );
    std::fs::copy(fixture, &path).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
    }
    let scheduler = DistributedScheduler::with_state_store(
        WorkerRegistry::new(Duration::from_secs(1)).unwrap(),
        Duration::from_secs(1),
        3,
        16,
        32,
        Arc::new(FileSchedulerStateStore::new(&path, 0).unwrap()),
    )
    .unwrap();
    let snapshot = scheduler.snapshot().await;
    assert_eq!(snapshot.queued_jobs, 1);
    assert_eq!(snapshot.inflight_jobs, 0);
    assert_eq!(snapshot.interrupted_jobs, 1);
    assert_eq!(snapshot.completed_jobs, 2);
    assert_eq!(snapshot.failed_jobs, 1);
    assert_eq!(scheduler.state_generation().await, 7);
    assert_eq!(
        scheduler.list_interrupted().await[0].assignment_id,
        "assignment-scheduler-interrupted"
    );
}
