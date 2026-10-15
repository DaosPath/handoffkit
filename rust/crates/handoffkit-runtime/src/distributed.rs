use crate::{
    RuntimeError, RuntimeResult, SchedulerStateStore, SCHEDULER_STATE_FORMAT,
    SCHEDULER_STATE_FORMAT_VERSION,
};
use handoffkit_protocol::{
    utc_now, DistributedJob, JobAssignment, WorkerCapabilities, WorkerHeartbeat,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{Mutex, RwLock};
use tokio::time::Instant;

const DEFAULT_SCHEDULER_QUEUE_CAPACITY: usize = 4_096;
const DEFAULT_SCHEDULER_IDEMPOTENCY_CAPACITY: usize = 100_000;
const MAX_SCHEDULER_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const SCHEDULER_DURABILITY_UNCERTAIN: &str = "scheduler_state_durability_uncertain";

fn scheduler_commit_applied(error: &RuntimeError) -> bool {
    error.code == SCHEDULER_DURABILITY_UNCERTAIN
}

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
    pub interrupted_jobs: usize,
    pub completed_jobs: usize,
    pub failed_jobs: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredAssignment {
    assignment: JobAssignment,
    job: DistributedJob,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct InterruptedJob {
    assignment: JobAssignment,
    job: DistributedJob,
    reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct SeenJob {
    idempotency_key: String,
    job_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredSchedulerState {
    completed: u64,
    failed: u64,
    format: String,
    format_version: u32,
    generation: u64,
    inflight: Vec<StoredAssignment>,
    interrupted: Vec<InterruptedJob>,
    queued: Vec<QueuedJob>,
    seen: Vec<SeenJob>,
}

#[derive(Clone)]
struct SeenJobs {
    keys: HashMap<String, String>,
    order: VecDeque<String>,
    capacity: usize,
}

impl SeenJobs {
    fn new(capacity: usize) -> Self {
        Self {
            keys: HashMap::new(),
            order: VecDeque::new(),
            capacity,
        }
    }

    fn claim(
        &mut self,
        key: String,
        job_id: String,
        active_job_ids: &HashSet<String>,
    ) -> RuntimeResult<bool> {
        if self.keys.contains_key(&key) {
            return Ok(false);
        }
        if self.order.len() >= self.capacity {
            let Some(index) = self.order.iter().position(|candidate| {
                self.keys
                    .get(candidate)
                    .is_some_and(|candidate_job_id| !active_job_ids.contains(candidate_job_id))
            }) else {
                return Err(RuntimeError::new(
                    "scheduler_backpressure",
                    "distributed scheduler deduplication state is at capacity",
                ));
            };
            if let Some(expired) = self.order.remove(index) {
                self.keys.remove(&expired);
            }
        }
        self.keys.insert(key.clone(), job_id);
        self.order.push_back(key);
        Ok(true)
    }
}

#[derive(Clone)]
struct SchedulerMemory {
    queue: VecDeque<QueuedJob>,
    inflight: HashMap<String, InflightJob>,
    interrupted: HashMap<String, InterruptedJob>,
    seen: SeenJobs,
    completed: u64,
    failed: u64,
    sequence: u64,
    generation: u64,
}

pub struct DistributedScheduler {
    registry: WorkerRegistry,
    memory: Mutex<SchedulerMemory>,
    lease_duration: Duration,
    max_attempts: u32,
    queue_capacity: usize,
    state_store: Option<Arc<dyn SchedulerStateStore>>,
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
        Self::with_optional_state_store(
            registry,
            lease_duration,
            max_attempts,
            queue_capacity,
            dedup_capacity,
            None,
            false,
        )
    }

    pub fn with_state_store(
        registry: WorkerRegistry,
        lease_duration: Duration,
        max_attempts: u32,
        queue_capacity: usize,
        dedup_capacity: usize,
        state_store: Arc<dyn SchedulerStateStore>,
    ) -> RuntimeResult<Self> {
        Self::with_optional_state_store(
            registry,
            lease_duration,
            max_attempts,
            queue_capacity,
            dedup_capacity,
            Some(state_store),
            false,
        )
    }

    /// Opt into at-least-once restart recovery. This never provides an
    /// exactly-once side-effect guarantee.
    pub fn with_state_store_auto_resume(
        registry: WorkerRegistry,
        lease_duration: Duration,
        max_attempts: u32,
        queue_capacity: usize,
        dedup_capacity: usize,
        state_store: Arc<dyn SchedulerStateStore>,
    ) -> RuntimeResult<Self> {
        Self::with_optional_state_store(
            registry,
            lease_duration,
            max_attempts,
            queue_capacity,
            dedup_capacity,
            Some(state_store),
            true,
        )
    }

    fn with_optional_state_store(
        registry: WorkerRegistry,
        lease_duration: Duration,
        max_attempts: u32,
        queue_capacity: usize,
        dedup_capacity: usize,
        state_store: Option<Arc<dyn SchedulerStateStore>>,
        auto_resume: bool,
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
        let mut memory = SchedulerMemory {
            queue: VecDeque::new(),
            inflight: HashMap::new(),
            interrupted: HashMap::new(),
            seen: SeenJobs::new(dedup_capacity),
            completed: 0,
            failed: 0,
            sequence: 1,
            generation: 0,
        };
        if let Some(store) = &state_store {
            if let Some(payload) = store.load()? {
                let (payload, migrated) = migrate_scheduler_state_payload(&payload)
                    .map_err(|error| store.quarantine(&error.message))?;
                if migrated {
                    store.commit(&payload)?;
                }
                let state: StoredSchedulerState = serde_json::from_slice(&payload)
                    .map_err(|_| store.quarantine("scheduler state fields are invalid"))?;
                validate_stored_state(&state, max_attempts, queue_capacity, dedup_capacity)
                    .map_err(|error| store.quarantine(&error.message))?;
                memory = memory_from_stored(state, dedup_capacity);
                if !memory.inflight.is_empty() {
                    for (assignment_id, item) in memory.inflight.drain() {
                        memory.interrupted.insert(
                            assignment_id,
                            InterruptedJob {
                                assignment: item.assignment,
                                job: item.job,
                                reason: "scheduler_restart".to_string(),
                            },
                        );
                    }
                    persist_memory(store.as_ref(), &mut memory)?;
                }
                if auto_resume {
                    auto_resume_memory(&mut memory, max_attempts, queue_capacity)?;
                    persist_memory(store.as_ref(), &mut memory)?;
                }
            }
        }
        Ok(Self {
            registry,
            memory: Mutex::new(memory),
            lease_duration,
            max_attempts,
            queue_capacity,
            state_store,
        })
    }

    pub async fn submit(&self, job: DistributedJob) -> RuntimeResult<bool> {
        job.validate()?;
        if job
            .metadata
            .get("require_exactly_once")
            .is_some_and(|value| value.as_bool() != Some(false))
        {
            return Err(RuntimeError::new(
                "exactly_once_unavailable",
                "Exactly-once external effects are unavailable; refusing fallback to at-least-once.",
            ));
        }
        let mut memory = self.memory.lock().await;
        if is_duplicate(&memory, &job) {
            return Ok(false);
        }
        if memory.queue.len() >= self.queue_capacity {
            return Err(RuntimeError::new(
                "scheduler_backpressure",
                "distributed scheduler queue is at capacity",
            ));
        }
        let previous = memory.clone();
        let active_job_ids = active_job_ids(&memory);
        memory.seen.claim(
            job.idempotency_key.clone(),
            job.job_id.clone(),
            &active_job_ids,
        )?;
        memory.queue.push_back(QueuedJob { job, attempt: 1 });
        if let Err(error) = self.persist(&mut memory) {
            if !scheduler_commit_applied(&error) {
                *memory = previous;
            }
            return Err(error);
        }
        Ok(true)
    }

    pub async fn schedule_next(&self) -> RuntimeResult<Option<JobAssignment>> {
        let mut memory = self.memory.lock().await;
        if memory.inflight.len() + memory.interrupted.len() >= self.queue_capacity {
            return Ok(None);
        }
        let previous = memory.clone();
        let queued = memory.queue.pop_front();
        let Some(queued) = queued else {
            return Ok(None);
        };
        let Some(worker) = self
            .registry
            .reserve(&queued.job.requested_capabilities)
            .await
        else {
            memory.queue.push_front(queued);
            return Ok(None);
        };
        let sequence = memory.sequence;
        memory.sequence = memory.sequence.saturating_add(1);
        let assigned_at = chrono::Utc::now();
        let lease_deadline = assigned_at
            + chrono::Duration::from_std(self.lease_duration).map_err(|_| {
                RuntimeError::new("invalid_lease", "assignment lease exceeds supported range")
            })?;
        let assignment = JobAssignment {
            assignment_id: format!(
                "assignment-{}-{}-{sequence}",
                std::process::id(),
                assigned_at.timestamp_micros()
            ),
            job_id: queued.job.job_id.clone(),
            worker_id: worker.worker_id.clone(),
            attempt: queued.attempt,
            assigned_at: assigned_at.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            lease_deadline: lease_deadline.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            payload: queued.job.payload.clone(),
            metadata: HashMap::new(),
        };
        if let Err(error) = assignment.validate() {
            *memory = previous;
            self.registry.release(&worker.worker_id).await;
            return Err(error.into());
        }
        memory.inflight.insert(
            assignment.assignment_id.clone(),
            InflightJob {
                assignment: assignment.clone(),
                job: queued.job,
                lease_expires: Instant::now() + self.lease_duration,
            },
        );
        if let Err(error) = self.persist(&mut memory) {
            if !scheduler_commit_applied(&error) {
                *memory = previous;
                self.registry.release(&worker.worker_id).await;
            }
            return Err(error);
        }
        Ok(Some(assignment))
    }

    pub async fn complete(&self, assignment_id: &str) -> RuntimeResult<bool> {
        let mut memory = self.memory.lock().await;
        let inflight = memory.inflight.get(assignment_id).cloned();
        let Some(inflight) = inflight else {
            return Ok(false);
        };
        let previous = memory.clone();
        memory.inflight.remove(assignment_id);
        memory.completed = memory.completed.saturating_add(1);
        if let Err(error) = self.persist(&mut memory) {
            if scheduler_commit_applied(&error) {
                self.registry.release(&inflight.assignment.worker_id).await;
            } else {
                *memory = previous;
            }
            return Err(error);
        }
        self.registry.release(&inflight.assignment.worker_id).await;
        Ok(true)
    }

    pub async fn fail(&self, assignment_id: &str, retryable: bool) -> RuntimeResult<bool> {
        let mut memory = self.memory.lock().await;
        let inflight = memory.inflight.get(assignment_id).cloned();
        let Some(inflight) = inflight else {
            return Ok(false);
        };
        let previous = memory.clone();
        fail_memory(
            &mut memory,
            assignment_id,
            retryable,
            self.max_attempts,
            self.queue_capacity,
        );
        if let Err(error) = self.persist(&mut memory) {
            if scheduler_commit_applied(&error) {
                self.registry.release(&inflight.assignment.worker_id).await;
            } else {
                *memory = previous;
            }
            return Err(error);
        }
        self.registry.release(&inflight.assignment.worker_id).await;
        Ok(true)
    }

    pub async fn recover_worker(&self, worker_id: &str) -> RuntimeResult<usize> {
        self.registry.disconnect(worker_id).await;
        let mut memory = self.memory.lock().await;
        let assignments: Vec<(String, InflightJob)> = memory
            .inflight
            .iter()
            .filter(|(_, inflight)| inflight.assignment.worker_id == worker_id)
            .map(|(assignment_id, item)| (assignment_id.clone(), item.clone()))
            .collect();
        if assignments.is_empty() {
            return Ok(0);
        }
        let previous = memory.clone();
        for (assignment_id, _) in &assignments {
            fail_memory(
                &mut memory,
                assignment_id,
                true,
                self.max_attempts,
                self.queue_capacity,
            );
        }
        if let Err(error) = self.persist(&mut memory) {
            if scheduler_commit_applied(&error) {
                for (_, item) in &assignments {
                    self.registry.release(&item.assignment.worker_id).await;
                }
            } else {
                *memory = previous;
            }
            return Err(error);
        }
        for (_, item) in &assignments {
            self.registry.release(&item.assignment.worker_id).await;
        }
        Ok(assignments.len())
    }

    pub async fn recover_expired_leases(&self) -> RuntimeResult<usize> {
        let now = Instant::now();
        let mut memory = self.memory.lock().await;
        let assignments: Vec<(String, InflightJob)> = memory
            .inflight
            .iter()
            .filter(|(_, inflight)| inflight.lease_expires <= now)
            .map(|(assignment_id, item)| (assignment_id.clone(), item.clone()))
            .collect();
        if assignments.is_empty() {
            return Ok(0);
        }
        let previous = memory.clone();
        for (assignment_id, _) in &assignments {
            fail_memory(
                &mut memory,
                assignment_id,
                true,
                self.max_attempts,
                self.queue_capacity,
            );
        }
        if let Err(error) = self.persist(&mut memory) {
            if scheduler_commit_applied(&error) {
                for (_, item) in &assignments {
                    self.registry.release(&item.assignment.worker_id).await;
                }
            } else {
                *memory = previous;
            }
            return Err(error);
        }
        for (_, item) in &assignments {
            self.registry.release(&item.assignment.worker_id).await;
        }
        Ok(assignments.len())
    }

    pub async fn snapshot(&self) -> SchedulerSnapshot {
        let memory = self.memory.lock().await;
        SchedulerSnapshot {
            queued_jobs: memory.queue.len(),
            inflight_jobs: memory.inflight.len(),
            interrupted_jobs: memory.interrupted.len(),
            completed_jobs: memory.completed as usize,
            failed_jobs: memory.failed as usize,
        }
    }

    pub async fn list_interrupted(&self) -> Vec<JobAssignment> {
        let memory = self.memory.lock().await;
        let mut identifiers: Vec<_> = memory.interrupted.keys().cloned().collect();
        identifiers.sort();
        identifiers
            .into_iter()
            .filter_map(|assignment_id| {
                memory
                    .interrupted
                    .get(&assignment_id)
                    .map(|item| item.assignment.clone())
            })
            .collect()
    }

    pub async fn retry_interrupted(&self, assignment_id: &str) -> RuntimeResult<bool> {
        let mut memory = self.memory.lock().await;
        let Some(item) = memory.interrupted.get(assignment_id).cloned() else {
            return Ok(false);
        };
        if memory.queue.len() >= self.queue_capacity {
            return Err(RuntimeError::new(
                "scheduler_backpressure",
                "distributed scheduler queue is at capacity",
            ));
        }
        let previous = memory.clone();
        memory.interrupted.remove(assignment_id);
        let next_attempt = item.assignment.attempt + 1;
        if next_attempt <= self.max_attempts {
            memory.queue.push_front(QueuedJob {
                job: item.job,
                attempt: next_attempt,
            });
        } else {
            memory.failed = memory.failed.saturating_add(1);
        }
        if let Err(error) = self.persist(&mut memory) {
            if !scheduler_commit_applied(&error) {
                *memory = previous;
            }
            return Err(error);
        }
        Ok(true)
    }

    pub async fn fail_interrupted(&self, assignment_id: &str) -> RuntimeResult<bool> {
        let mut memory = self.memory.lock().await;
        if !memory.interrupted.contains_key(assignment_id) {
            return Ok(false);
        }
        let previous = memory.clone();
        memory.interrupted.remove(assignment_id);
        memory.failed = memory.failed.saturating_add(1);
        if let Err(error) = self.persist(&mut memory) {
            if !scheduler_commit_applied(&error) {
                *memory = previous;
            }
            return Err(error);
        }
        Ok(true)
    }

    pub async fn state_generation(&self) -> u64 {
        self.memory.lock().await.generation
    }

    pub fn registry(&self) -> &WorkerRegistry {
        &self.registry
    }

    fn persist(&self, memory: &mut SchedulerMemory) -> RuntimeResult<()> {
        let Some(store) = &self.state_store else {
            return Ok(());
        };
        persist_memory(store.as_ref(), memory)
    }
}

fn fail_memory(
    memory: &mut SchedulerMemory,
    assignment_id: &str,
    retryable: bool,
    max_attempts: u32,
    queue_capacity: usize,
) {
    let Some(inflight) = memory.inflight.remove(assignment_id) else {
        return;
    };
    let next_attempt = inflight.assignment.attempt + 1;
    if retryable && next_attempt <= max_attempts && memory.queue.len() < queue_capacity {
        memory.queue.push_back(QueuedJob {
            job: inflight.job,
            attempt: next_attempt,
        });
    } else {
        memory.failed = memory.failed.saturating_add(1);
    }
}

fn active_job_ids(memory: &SchedulerMemory) -> HashSet<String> {
    memory
        .queue
        .iter()
        .map(|item| item.job.job_id.clone())
        .chain(memory.inflight.values().map(|item| item.job.job_id.clone()))
        .chain(
            memory
                .interrupted
                .values()
                .map(|item| item.job.job_id.clone()),
        )
        .collect()
}

fn is_duplicate(memory: &SchedulerMemory, job: &DistributedJob) -> bool {
    memory.seen.keys.contains_key(&job.idempotency_key)
        || memory
            .seen
            .keys
            .values()
            .any(|job_id| job_id == &job.job_id)
        || active_job_ids(memory).contains(&job.job_id)
}

fn stored_from_memory(memory: &SchedulerMemory, generation: u64) -> StoredSchedulerState {
    let mut inflight: Vec<_> = memory
        .inflight
        .values()
        .map(|item| StoredAssignment {
            assignment: item.assignment.clone(),
            job: item.job.clone(),
        })
        .collect();
    inflight.sort_by(|left, right| {
        left.assignment
            .assignment_id
            .cmp(&right.assignment.assignment_id)
    });
    let mut interrupted: Vec<_> = memory.interrupted.values().cloned().collect();
    interrupted.sort_by(|left, right| {
        left.assignment
            .assignment_id
            .cmp(&right.assignment.assignment_id)
    });
    let seen = memory
        .seen
        .order
        .iter()
        .filter_map(|key| {
            memory.seen.keys.get(key).map(|job_id| SeenJob {
                idempotency_key: key.clone(),
                job_id: job_id.clone(),
            })
        })
        .collect();
    StoredSchedulerState {
        completed: memory.completed,
        failed: memory.failed,
        format: SCHEDULER_STATE_FORMAT.to_string(),
        format_version: SCHEDULER_STATE_FORMAT_VERSION,
        generation,
        inflight,
        interrupted,
        queued: memory.queue.iter().cloned().collect(),
        seen,
    }
}

fn auto_resume_memory(
    memory: &mut SchedulerMemory,
    max_attempts: u32,
    queue_capacity: usize,
) -> RuntimeResult<()> {
    let mut identifiers: Vec<_> = memory.interrupted.keys().cloned().collect();
    identifiers.sort();
    for assignment_id in identifiers {
        if memory.queue.len() >= queue_capacity {
            return Err(RuntimeError::new(
                "scheduler_backpressure",
                "distributed scheduler queue is at capacity",
            ));
        }
        let Some(item) = memory.interrupted.remove(&assignment_id) else {
            continue;
        };
        let next_attempt = item.assignment.attempt.saturating_add(1);
        if next_attempt <= max_attempts {
            memory.queue.push_front(QueuedJob {
                job: item.job,
                attempt: next_attempt,
            });
        } else {
            memory.failed = memory.failed.saturating_add(1);
        }
    }
    Ok(())
}

fn migrate_scheduler_state_payload(payload: &[u8]) -> RuntimeResult<(Vec<u8>, bool)> {
    let mut value: Value = serde_json::from_slice(payload).map_err(|_| {
        RuntimeError::new(
            "scheduler_state_invalid",
            "scheduler state fields are invalid",
        )
    })?;
    let object = value.as_object_mut().ok_or_else(|| {
        RuntimeError::new("scheduler_state_invalid", "scheduler state root is invalid")
    })?;
    let Some(version) = object.get("format_version").and_then(Value::as_u64) else {
        return Ok((payload.to_vec(), false));
    };
    if version == u64::from(SCHEDULER_STATE_FORMAT_VERSION) {
        return Ok((payload.to_vec(), false));
    }
    if version != 0 || object.get("format").and_then(Value::as_str) != Some(SCHEDULER_STATE_FORMAT)
    {
        return Err(RuntimeError::new(
            "scheduler_state_invalid",
            "scheduler state format is unsupported",
        ));
    }
    let expected = [
        "completed",
        "failed",
        "format",
        "format_version",
        "generation",
        "inflight",
        "queued",
        "seen",
    ];
    if object.len() != expected.len() || expected.iter().any(|key| !object.contains_key(*key)) {
        return Err(RuntimeError::new(
            "scheduler_state_invalid",
            "scheduler v0 state fields are invalid",
        ));
    }
    object.insert(
        "format_version".to_string(),
        Value::from(SCHEDULER_STATE_FORMAT_VERSION),
    );
    object.insert("interrupted".to_string(), Value::Array(Vec::new()));
    let migrated = serde_json::to_vec(&value)?;
    Ok((migrated, true))
}

fn persist_memory(
    store: &dyn SchedulerStateStore,
    memory: &mut SchedulerMemory,
) -> RuntimeResult<()> {
    if memory.generation >= MAX_SCHEDULER_SAFE_INTEGER
        || memory.completed > MAX_SCHEDULER_SAFE_INTEGER
        || memory.failed > MAX_SCHEDULER_SAFE_INTEGER
    {
        return Err(RuntimeError::new(
            "scheduler_state_invalid",
            "scheduler state counters exceed the interoperable integer range",
        ));
    }
    let generation = memory.generation.saturating_add(1);
    let state = stored_from_memory(memory, generation);
    let payload = serde_json::to_vec(&state)?;
    match store.commit(&payload) {
        Ok(()) => {
            memory.generation = generation;
            Ok(())
        }
        Err(error) => {
            if scheduler_commit_applied(&error) {
                memory.generation = generation;
            }
            Err(error)
        }
    }
}

fn memory_from_stored(state: StoredSchedulerState, dedup_capacity: usize) -> SchedulerMemory {
    let mut seen = SeenJobs::new(dedup_capacity);
    for item in state.seen {
        seen.keys.insert(item.idempotency_key.clone(), item.job_id);
        seen.order.push_back(item.idempotency_key);
    }
    let inflight = state
        .inflight
        .into_iter()
        .map(|item| {
            let assignment_id = item.assignment.assignment_id.clone();
            (
                assignment_id,
                InflightJob {
                    assignment: item.assignment,
                    job: item.job,
                    lease_expires: Instant::now(),
                },
            )
        })
        .collect();
    let interrupted = state
        .interrupted
        .into_iter()
        .map(|item| (item.assignment.assignment_id.clone(), item))
        .collect();
    SchedulerMemory {
        queue: state.queued.into_iter().collect(),
        inflight,
        interrupted,
        seen,
        completed: state.completed,
        failed: state.failed,
        sequence: 1,
        generation: state.generation,
    }
}

fn record_active_job(
    job: &DistributedJob,
    job_ids: &mut HashSet<String>,
    active_identities: &mut HashMap<String, String>,
) -> RuntimeResult<()> {
    if !job_ids.insert(job.job_id.clone())
        || active_identities
            .insert(job.idempotency_key.clone(), job.job_id.clone())
            .is_some()
    {
        return Err(RuntimeError::new(
            "scheduler_state_invalid",
            "scheduler job is duplicated",
        ));
    }
    Ok(())
}

fn validate_stored_assignment(
    assignment: &JobAssignment,
    job: &DistributedJob,
    assignment_ids: &mut HashSet<String>,
    job_ids: &mut HashSet<String>,
    active_identities: &mut HashMap<String, String>,
) -> RuntimeResult<()> {
    assignment.validate()?;
    job.validate()?;
    if assignment.job_id != job.job_id || !assignment_ids.insert(assignment.assignment_id.clone()) {
        return Err(RuntimeError::new(
            "scheduler_state_invalid",
            "scheduler assignment identity is invalid or duplicated",
        ));
    }
    record_active_job(job, job_ids, active_identities)
}

fn validate_stored_state(
    state: &StoredSchedulerState,
    max_attempts: u32,
    queue_capacity: usize,
    dedup_capacity: usize,
) -> RuntimeResult<()> {
    if state.format != SCHEDULER_STATE_FORMAT
        || state.format_version != SCHEDULER_STATE_FORMAT_VERSION
    {
        return Err(RuntimeError::new(
            "scheduler_state_invalid",
            "scheduler state format is unsupported",
        ));
    }
    if state.completed > MAX_SCHEDULER_SAFE_INTEGER
        || state.failed > MAX_SCHEDULER_SAFE_INTEGER
        || state.generation > MAX_SCHEDULER_SAFE_INTEGER
    {
        return Err(RuntimeError::new(
            "scheduler_state_invalid",
            "scheduler state counters exceed the interoperable integer range",
        ));
    }
    if state.queued.len() > queue_capacity
        || state.inflight.len() + state.interrupted.len() > queue_capacity
    {
        return Err(RuntimeError::new(
            "scheduler_state_invalid",
            "scheduler state exceeds configured job capacity",
        ));
    }
    if state.seen.len() > dedup_capacity {
        return Err(RuntimeError::new(
            "scheduler_state_invalid",
            "scheduler state exceeds configured dedup capacity",
        ));
    }
    let mut job_ids = HashSet::new();
    let mut active_identities = HashMap::new();
    let mut assignment_ids = HashSet::new();
    for item in &state.queued {
        item.job.validate()?;
        if item.attempt == 0 || item.attempt > max_attempts {
            return Err(RuntimeError::new(
                "scheduler_state_invalid",
                "scheduler queued job is invalid",
            ));
        }
        record_active_job(&item.job, &mut job_ids, &mut active_identities)?;
    }
    for item in &state.inflight {
        validate_stored_assignment(
            &item.assignment,
            &item.job,
            &mut assignment_ids,
            &mut job_ids,
            &mut active_identities,
        )?;
    }
    for item in &state.interrupted {
        if item.reason != "scheduler_restart" {
            return Err(RuntimeError::new(
                "scheduler_state_invalid",
                "scheduler interrupted reason is invalid",
            ));
        }
        validate_stored_assignment(
            &item.assignment,
            &item.job,
            &mut assignment_ids,
            &mut job_ids,
            &mut active_identities,
        )?;
    }
    let mut seen = HashSet::new();
    let mut seen_job_ids = HashSet::new();
    for item in &state.seen {
        if item.idempotency_key.is_empty()
            || item.job_id.is_empty()
            || !seen.insert(item.idempotency_key.clone())
            || !seen_job_ids.insert(item.job_id.clone())
        {
            return Err(RuntimeError::new(
                "scheduler_state_invalid",
                "scheduler dedup identity is invalid or duplicated",
            ));
        }
    }
    if active_identities.iter().any(|(key, job_id)| {
        !state
            .seen
            .iter()
            .any(|item| &item.idempotency_key == key && &item.job_id == job_id)
    }) {
        return Err(RuntimeError::new(
            "scheduler_state_invalid",
            "scheduler active job is missing its dedup identity",
        ));
    }
    Ok(())
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
