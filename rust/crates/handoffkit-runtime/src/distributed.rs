use crate::{RuntimeError, RuntimeResult};
use handoffkit_protocol::{
    utc_now, DistributedJob, JobAssignment, WorkerCapabilities, WorkerHeartbeat,
};
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering as AtomicOrdering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{Mutex, RwLock};
use tokio::time::Instant;

const DEFAULT_SCHEDULER_QUEUE_CAPACITY: usize = 4_096;
const DEFAULT_SCHEDULER_IDEMPOTENCY_CAPACITY: usize = 100_000;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkerStatus {
    Online,
    Suspect,
    Offline,
}

#[derive(Debug, Clone)]
pub struct WorkerRecord {
    pub capabilities: WorkerCapabilities,
    pub status: WorkerStatus,
    pub active_jobs: u32,
    pub max_concurrency: u32,
    pub heartbeat_sequence: u64,
    pub last_seen: Instant,
}

#[derive(Clone)]
pub struct WorkerRegistry {
    workers: Arc<RwLock<HashMap<String, WorkerRecord>>>,
    heartbeat_timeout: Duration,
}

impl WorkerRegistry {
    pub fn new(heartbeat_timeout: Duration) -> RuntimeResult<Self> {
        if heartbeat_timeout.is_zero() {
            return Err(RuntimeError::new(
                "invalid_heartbeat_timeout",
                "heartbeat timeout must be greater than zero",
            ));
        }
        Ok(Self {
            workers: Arc::new(RwLock::new(HashMap::new())),
            heartbeat_timeout,
        })
    }

    pub async fn register(
        &self,
        capabilities: WorkerCapabilities,
        max_concurrency: u32,
    ) -> RuntimeResult<bool> {
        capabilities.validate()?;
        if max_concurrency == 0 {
            return Err(RuntimeError::new(
                "invalid_worker_capacity",
                "worker max_concurrency must be at least 1",
            ));
        }
        let worker_id = capabilities.worker_id.clone();
        let mut workers = self.workers.write().await;
        let replaced = workers.contains_key(&worker_id);
        workers.insert(
            worker_id,
            WorkerRecord {
                capabilities,
                status: WorkerStatus::Online,
                active_jobs: 0,
                max_concurrency,
                heartbeat_sequence: 0,
                last_seen: Instant::now(),
            },
        );
        Ok(replaced)
    }

    pub async fn heartbeat(&self, heartbeat: &WorkerHeartbeat) -> RuntimeResult<bool> {
        heartbeat.validate()?;
        let mut workers = self.workers.write().await;
        let worker = workers.get_mut(&heartbeat.worker_id).ok_or_else(|| {
            RuntimeError::new(
                "worker_not_found",
                format!("unknown worker '{}'", heartbeat.worker_id),
            )
        })?;
        if heartbeat.sequence <= worker.heartbeat_sequence {
            return Ok(false);
        }
        worker.heartbeat_sequence = heartbeat.sequence;
        worker.active_jobs = heartbeat.active_jobs.min(worker.max_concurrency);
        worker.last_seen = Instant::now();
        worker.status = WorkerStatus::Online;
        Ok(true)
    }

    pub async fn disconnect(&self, worker_id: &str) -> bool {
        let mut workers = self.workers.write().await;
        let Some(worker) = workers.get_mut(worker_id) else {
            return false;
        };
        worker.status = WorkerStatus::Offline;
        true
    }

    pub async fn expire_stale(&self) -> Vec<String> {
        let now = Instant::now();
        let mut workers = self.workers.write().await;
        let mut expired = Vec::new();
        for (worker_id, worker) in workers.iter_mut() {
            let elapsed = now.saturating_duration_since(worker.last_seen);
            if elapsed >= self.heartbeat_timeout {
                if worker.status != WorkerStatus::Offline {
                    expired.push(worker_id.clone());
                }
                worker.status = WorkerStatus::Offline;
            } else if elapsed >= self.heartbeat_timeout / 2 {
                worker.status = WorkerStatus::Suspect;
            }
        }
        expired
    }

    pub async fn reserve(&self, required: &[String]) -> Option<WorkerCapabilities> {
        let mut workers = self.workers.write().await;
        let selected = workers
            .values()
            .filter(|worker| {
                worker.status == WorkerStatus::Online
                    && worker.active_jobs < worker.max_concurrency
                    && required
                        .iter()
                        .all(|capability| worker.capabilities.operations.contains(capability))
            })
            .min_by(|left, right| {
                let left_load = f64::from(left.active_jobs) / f64::from(left.max_concurrency);
                let right_load = f64::from(right.active_jobs) / f64::from(right.max_concurrency);
                left_load
                    .partial_cmp(&right_load)
                    .unwrap_or(Ordering::Equal)
                    .then_with(|| {
                        left.capabilities
                            .worker_id
                            .cmp(&right.capabilities.worker_id)
                    })
            })
            .map(|worker| worker.capabilities.worker_id.clone())?;
        let worker = workers.get_mut(&selected)?;
        worker.active_jobs += 1;
        Some(worker.capabilities.clone())
    }

    pub async fn release(&self, worker_id: &str) -> bool {
        let mut workers = self.workers.write().await;
        let Some(worker) = workers.get_mut(worker_id) else {
            return false;
        };
        worker.active_jobs = worker.active_jobs.saturating_sub(1);
        true
    }

    pub async fn get(&self, worker_id: &str) -> Option<WorkerRecord> {
        self.workers.read().await.get(worker_id).cloned()
    }

    pub async fn list(&self) -> Vec<WorkerRecord> {
        let mut workers: Vec<_> = self.workers.read().await.values().cloned().collect();
        workers.sort_by(|left, right| {
            left.capabilities
                .worker_id
                .cmp(&right.capabilities.worker_id)
        });
        workers
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SchedulerSnapshot {
    pub queued_jobs: usize,
    pub inflight_jobs: usize,
    pub completed_jobs: usize,
    pub failed_jobs: usize,
}

#[derive(Debug, Clone)]
struct QueuedJob {
    job: DistributedJob,
    attempt: u32,
}

#[derive(Debug, Clone)]
struct InflightJob {
    assignment: JobAssignment,
    job: DistributedJob,
    lease_expires: Instant,
}

struct SeenJobs {
    keys: HashSet<String>,
    order: VecDeque<String>,
    capacity: usize,
}

impl SeenJobs {
    fn new(capacity: usize) -> Self {
        Self {
            keys: HashSet::new(),
            order: VecDeque::new(),
            capacity,
        }
    }

    fn claim(&mut self, key: String) -> bool {
        if !self.keys.insert(key.clone()) {
            return false;
        }
        self.order.push_back(key);
        while self.order.len() > self.capacity {
            if let Some(expired) = self.order.pop_front() {
                self.keys.remove(&expired);
            }
        }
        true
    }
}

pub struct DistributedScheduler {
    registry: WorkerRegistry,
    queue: Mutex<VecDeque<QueuedJob>>,
    inflight: Mutex<HashMap<String, InflightJob>>,
    seen: Mutex<SeenJobs>,
    completed: AtomicU64,
    failed: AtomicU64,
    sequence: AtomicU64,
    lease_duration: Duration,
    max_attempts: u32,
    queue_capacity: usize,
}

impl DistributedScheduler {
    pub fn new(
        registry: WorkerRegistry,
        lease_duration: Duration,
        max_attempts: u32,
    ) -> RuntimeResult<Self> {
        Self::with_limits(
            registry,
            lease_duration,
            max_attempts,
            DEFAULT_SCHEDULER_QUEUE_CAPACITY,
            DEFAULT_SCHEDULER_IDEMPOTENCY_CAPACITY,
        )
    }

    pub fn with_limits(
        registry: WorkerRegistry,
        lease_duration: Duration,
        max_attempts: u32,
        queue_capacity: usize,
        dedup_capacity: usize,
    ) -> RuntimeResult<Self> {
        if lease_duration.is_zero() {
            return Err(RuntimeError::new(
                "invalid_lease",
                "assignment lease must be greater than zero",
            ));
        }
        if max_attempts == 0 {
            return Err(RuntimeError::new(
                "invalid_attempts",
                "scheduler max_attempts must be at least 1",
            ));
        }
        if queue_capacity == 0 || dedup_capacity == 0 {
            return Err(RuntimeError::new(
                "invalid_capacity",
                "scheduler capacities must be at least 1",
            ));
        }
        Ok(Self {
            registry,
            queue: Mutex::new(VecDeque::new()),
            inflight: Mutex::new(HashMap::new()),
            seen: Mutex::new(SeenJobs::new(dedup_capacity)),
            completed: AtomicU64::new(0),
            failed: AtomicU64::new(0),
            sequence: AtomicU64::new(1),
            lease_duration,
            max_attempts,
            queue_capacity,
        })
    }

    pub async fn submit(&self, job: DistributedJob) -> RuntimeResult<bool> {
        job.validate()?;
        let mut seen = self.seen.lock().await;
        if seen.keys.contains(&job.idempotency_key) {
            return Ok(false);
        }
        let mut queue = self.queue.lock().await;
        if queue.len() >= self.queue_capacity {
            return Err(RuntimeError::new(
                "scheduler_backpressure",
                "distributed scheduler queue is at capacity",
            ));
        }
        debug_assert!(seen.claim(job.idempotency_key.clone()));
        queue.push_back(QueuedJob { job, attempt: 1 });
        Ok(true)
    }

    pub async fn schedule_next(&self) -> RuntimeResult<Option<JobAssignment>> {
        let queued = self.queue.lock().await.pop_front();
        let Some(queued) = queued else {
            return Ok(None);
        };
        let Some(worker) = self
            .registry
            .reserve(&queued.job.requested_capabilities)
            .await
        else {
            self.queue.lock().await.push_front(queued);
            return Ok(None);
        };
        let sequence = self.sequence.fetch_add(1, AtomicOrdering::Relaxed);
        let assigned_at = chrono::Utc::now();
        let lease_deadline = assigned_at
            + chrono::Duration::from_std(self.lease_duration).map_err(|_| {
                RuntimeError::new("invalid_lease", "assignment lease exceeds supported range")
            })?;
        let assignment = JobAssignment {
            assignment_id: format!("assignment-{}-{sequence}", std::process::id()),
            job_id: queued.job.job_id.clone(),
            worker_id: worker.worker_id,
            attempt: queued.attempt,
            assigned_at: assigned_at.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            lease_deadline: lease_deadline.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            payload: queued.job.payload.clone(),
            metadata: HashMap::new(),
        };
        assignment.validate()?;
        self.inflight.lock().await.insert(
            assignment.assignment_id.clone(),
            InflightJob {
                assignment: assignment.clone(),
                job: queued.job,
                lease_expires: Instant::now() + self.lease_duration,
            },
        );
        Ok(Some(assignment))
    }

    pub async fn complete(&self, assignment_id: &str) -> bool {
        let inflight = self.inflight.lock().await.remove(assignment_id);
        let Some(inflight) = inflight else {
            return false;
        };
        self.registry.release(&inflight.assignment.worker_id).await;
        self.completed.fetch_add(1, AtomicOrdering::Relaxed);
        true
    }

    pub async fn fail(&self, assignment_id: &str, retryable: bool) -> bool {
        let inflight = self.inflight.lock().await.remove(assignment_id);
        let Some(inflight) = inflight else {
            return false;
        };
        self.registry.release(&inflight.assignment.worker_id).await;
        let next_attempt = inflight.assignment.attempt + 1;
        if retryable && next_attempt <= self.max_attempts {
            let mut queue = self.queue.lock().await;
            if queue.len() < self.queue_capacity {
                queue.push_back(QueuedJob {
                    job: inflight.job,
                    attempt: next_attempt,
                });
            } else {
                self.failed.fetch_add(1, AtomicOrdering::Relaxed);
            }
        } else {
            self.failed.fetch_add(1, AtomicOrdering::Relaxed);
        }
        true
    }

    pub async fn recover_worker(&self, worker_id: &str) -> usize {
        self.registry.disconnect(worker_id).await;
        let assignment_ids: Vec<String> = self
            .inflight
            .lock()
            .await
            .iter()
            .filter(|(_, inflight)| inflight.assignment.worker_id == worker_id)
            .map(|(assignment_id, _)| assignment_id.clone())
            .collect();
        let mut recovered = 0;
        for assignment_id in assignment_ids {
            if self.fail(&assignment_id, true).await {
                recovered += 1;
            }
        }
        recovered
    }

    pub async fn recover_expired_leases(&self) -> usize {
        let now = Instant::now();
        let assignment_ids: Vec<String> = self
            .inflight
            .lock()
            .await
            .iter()
            .filter(|(_, inflight)| inflight.lease_expires <= now)
            .map(|(assignment_id, _)| assignment_id.clone())
            .collect();
        let mut recovered = 0;
        for assignment_id in assignment_ids {
            if self.fail(&assignment_id, true).await {
                recovered += 1;
            }
        }
        recovered
    }

    pub async fn snapshot(&self) -> SchedulerSnapshot {
        SchedulerSnapshot {
            queued_jobs: self.queue.lock().await.len(),
            inflight_jobs: self.inflight.lock().await.len(),
            completed_jobs: self.completed.load(AtomicOrdering::Relaxed) as usize,
            failed_jobs: self.failed.load(AtomicOrdering::Relaxed) as usize,
        }
    }

    pub fn registry(&self) -> &WorkerRegistry {
        &self.registry
    }
}

pub fn heartbeat_now(
    worker_id: impl Into<String>,
    sequence: u64,
    active_jobs: u32,
    load: f64,
) -> WorkerHeartbeat {
    WorkerHeartbeat {
        worker_id: worker_id.into(),
        sequence,
        active_jobs,
        load,
        timestamp: utc_now(),
        metadata: HashMap::new(),
    }
}
