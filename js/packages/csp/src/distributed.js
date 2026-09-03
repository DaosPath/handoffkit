import {
  DistributedJob,
  JobAssignment,
  WorkerCapabilities,
  WorkerHeartbeat,
} from "./contracts.js";
import { SecurityError } from "./security.js";

export const WorkerStatus = Object.freeze({ ONLINE: "online", SUSPECT: "suspect", OFFLINE: "offline" });
export const SCHEDULER_STATE_FORMAT = "handoffkit.scheduler.state";
export const SCHEDULER_STATE_FORMAT_VERSION = 1;
const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;

function migrateSchedulerState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("scheduler state root is invalid");
  if (value.format !== SCHEDULER_STATE_FORMAT) return { value, migrated: false };
  if (value.format_version === SCHEDULER_STATE_FORMAT_VERSION) return { value, migrated: false };
  if (value.format_version !== 0) throw new TypeError("scheduler state format is unsupported");
  const expected = ["completed", "failed", "format", "format_version", "generation", "inflight", "queued", "seen"];
  if (Object.keys(value).sort().join("\0") !== expected.sort().join("\0")) throw new TypeError("scheduler v0 state fields are invalid");
  return {
    value: { ...value, format_version: SCHEDULER_STATE_FORMAT_VERSION, interrupted: [] },
    migrated: true,
  };
}

function schedulerCommitApplied(error) {
  return error?.committed === true || error?.details?.committed === true;
}

function identifier(prefix) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

export class WorkerRecord {
  constructor({ capabilities, status = WorkerStatus.ONLINE, heartbeatSequence = 0, activeJobs = 0, load = 0, lastSeen = Date.now(), metadata = {} }) {
    this.capabilities = capabilities instanceof WorkerCapabilities ? capabilities : new WorkerCapabilities(capabilities);
    this.status = status;
    this.heartbeatSequence = heartbeatSequence;
    this.activeJobs = activeJobs;
    this.load = load;
    this.lastSeen = lastSeen;
    this.metadata = { ...metadata };
  }
  get workerId() { return this.capabilities.toWire().worker_id; }
  with(changes) {
    return new WorkerRecord({
      capabilities: this.capabilities,
      status: this.status,
      heartbeatSequence: this.heartbeatSequence,
      activeJobs: this.activeJobs,
      load: this.load,
      lastSeen: this.lastSeen,
      metadata: this.metadata,
      ...changes,
    });
  }
}

export class WorkerRegistry {
  constructor({ suspectAfterMs = 15_000, offlineAfterMs = 45_000, clock = Date.now } = {}) {
    if (suspectAfterMs <= 0 || offlineAfterMs < suspectAfterMs) throw new TypeError("heartbeat thresholds are invalid");
    this.suspectAfterMs = suspectAfterMs;
    this.offlineAfterMs = offlineAfterMs;
    this.clock = clock;
    this.records = new Map();
  }
  register(value) {
    const capabilities = value instanceof WorkerCapabilities ? value : new WorkerCapabilities(value);
    const record = new WorkerRecord({ capabilities, lastSeen: this.clock() });
    this.records.set(record.workerId, record);
    return record;
  }
  heartbeat(value) {
    const heartbeat = value instanceof WorkerHeartbeat ? value : new WorkerHeartbeat(value);
    const wire = heartbeat.toWire();
    const current = this.required(wire.worker_id);
    if (wire.sequence <= current.heartbeatSequence) return false;
    this.records.set(wire.worker_id, current.with({
      status: WorkerStatus.ONLINE,
      heartbeatSequence: wire.sequence,
      activeJobs: wire.active_jobs,
      load: wire.load,
      lastSeen: this.clock(),
      metadata: wire.metadata,
    }));
    return true;
  }
  markDisconnected(workerId) { const current = this.required(workerId); this.records.set(workerId, current.with({ status: WorkerStatus.OFFLINE })); }
  expire() {
    const now = this.clock();
    const changed = [];
    for (const [workerId, record] of this.records) {
      const age = now - record.lastSeen;
      const status = age >= this.offlineAfterMs ? WorkerStatus.OFFLINE : age >= this.suspectAfterMs ? WorkerStatus.SUSPECT : WorkerStatus.ONLINE;
      if (status !== record.status) { this.records.set(workerId, record.with({ status })); changed.push(workerId); }
    }
    return changed;
  }
  reserve(requiredCapabilities = []) {
    const required = new Set(requiredCapabilities);
    const candidates = [...this.records.values()].filter((record) => {
      const operations = new Set(record.capabilities.toWire().operations ?? []);
      return record.status === WorkerStatus.ONLINE && [...required].every((item) => operations.has(item));
    });
    candidates.sort((left, right) => left.load - right.load || left.activeJobs - right.activeJobs || left.workerId.localeCompare(right.workerId));
    const chosen = candidates[0];
    if (!chosen) return null;
    const reserved = chosen.with({ activeJobs: chosen.activeJobs + 1 });
    this.records.set(chosen.workerId, reserved);
    return reserved;
  }
  release(workerId) { const current = this.required(workerId); this.records.set(workerId, current.with({ activeJobs: Math.max(0, current.activeJobs - 1) })); }
  get(workerId) { return this.records.get(workerId) ?? null; }
  list() { return [...this.records.values()].sort((left, right) => left.workerId.localeCompare(right.workerId)); }
  required(workerId) { const record = this.records.get(workerId); if (!record) throw new TypeError(`unknown worker ${workerId}`); return record; }
}

export class DistributedScheduler {
  constructor(registry, {
    maxAttempts = 3,
    leaseMs = 30_000,
    queueCapacity = 4096,
    dedupCapacity = 100_000,
    stateStore = null,
    autoResume = false,
  } = {}) {
    if (!(registry instanceof WorkerRegistry)) throw new TypeError("registry must be a WorkerRegistry");
    if (![maxAttempts, leaseMs, queueCapacity, dedupCapacity].every(Number.isSafeInteger)
      || maxAttempts < 1 || leaseMs < 1 || queueCapacity < 1 || dedupCapacity < 1) {
      throw new TypeError("scheduler limits must be positive safe integers");
    }
    if (typeof autoResume !== "boolean") throw new TypeError("autoResume must be a boolean");
    if (stateStore) {
      for (const name of ["load", "commit", "quarantine"]) {
        if (typeof stateStore[name] !== "function") throw new TypeError(`stateStore must implement ${name}()`);
      }
    }
    Object.assign(this, { registry, maxAttempts, leaseMs, queueCapacity, dedupCapacity, stateStore, autoResume });
    this.queue = [];
    this.assignments = new Map();
    this.interrupted = new Map();
    this.seen = new Map();
    this.completed = 0;
    this.failed = 0;
    this.generation = 0;
    if (stateStore) this.loadState();
    if (stateStore && autoResume) this.autoResumeInterrupted();
  }
  submit(value) {
    const job = value instanceof DistributedJob ? value : new DistributedJob(value);
    const wire = job.toWire();
    if (wire.metadata && Object.prototype.hasOwnProperty.call(wire.metadata, "require_exactly_once")
      && wire.metadata.require_exactly_once !== false) {
      throw new SecurityError(
        "Exactly-once external effects are unavailable; refusing fallback to at-least-once.",
        {
          code: "exactly_once_unavailable",
          details: { runtime: "javascript" },
        },
      );
    }
    if (this.isDuplicate(wire)) return false;
    if (this.queue.length >= this.queueCapacity) throw new Error("distributed scheduler queue is at capacity");
    const previous = this.captureState();
    try {
      this.claimSeen(wire);
      this.queue.push({ job, attempt: 1 });
      this.persist();
    } catch (error) {
      if (!schedulerCommitApplied(error)) this.restoreState(previous);
      throw error;
    }
    return true;
  }
  schedule() {
    if (this.assignments.size + this.interrupted.size >= this.queueCapacity) return null;
    const queued = this.queue.length;
    for (let index = 0; index < queued; index += 1) {
      const previous = this.captureState();
      const queuedState = this.queue.shift();
      const { job } = queuedState;
      const wire = job.toWire();
      const worker = this.registry.reserve(wire.requested_capabilities);
      if (!worker) { this.queue.push(queuedState); continue; }
      const assigned = Date.now();
      const assignment = new JobAssignment({
        assignment_id: identifier("assignment"),
        job_id: wire.job_id,
        worker_id: worker.workerId,
        attempt: queuedState.attempt,
        assigned_at: new Date(assigned).toISOString(),
        lease_deadline: new Date(assigned + this.leaseMs).toISOString(),
        payload: wire.payload,
        metadata: { ...wire.metadata, operation: wire.operation, idempotency_key: wire.idempotency_key },
      });
      this.assignments.set(assignment.toWire().assignment_id, { assignment, job });
      try {
        this.persist();
      } catch (error) {
        if (!schedulerCommitApplied(error)) {
          this.restoreState(previous);
          this.registry.release(worker.workerId);
        }
        throw error;
      }
      return assignment;
    }
    return null;
  }
  complete(assignmentId) {
    const state = this.assignments.get(assignmentId);
    if (!state) return false;
    const previous = this.captureState();
    try {
      this.assignments.delete(assignmentId);
      this.completed += 1;
      this.persist();
    } catch (error) {
      if (schedulerCommitApplied(error)) this.registry.release(state.assignment.toWire().worker_id);
      else this.restoreState(previous);
      throw error;
    }
    this.registry.release(state.assignment.toWire().worker_id);
    return true;
  }
  fail(assignmentId, { retryable = true } = {}) {
    const state = this.assignments.get(assignmentId);
    if (!state) return false;
    const previous = this.captureState();
    try {
      this.failState(assignmentId, retryable);
      this.persist();
    } catch (error) {
      if (schedulerCommitApplied(error)) this.registry.release(state.assignment.toWire().worker_id);
      else this.restoreState(previous);
      throw error;
    }
    this.registry.release(state.assignment.toWire().worker_id);
    return true;
  }
  recoverWorker(workerId) {
    const states = [...this.assignments]
      .filter(([, state]) => state.assignment.toWire().worker_id === workerId);
    if (states.length === 0) return 0;
    const previous = this.captureState();
    try {
      for (const [assignmentId] of states) this.failState(assignmentId, true);
      this.persist();
    } catch (error) {
      if (schedulerCommitApplied(error)) {
        for (const [, state] of states) this.registry.release(state.assignment.toWire().worker_id);
      } else this.restoreState(previous);
      throw error;
    }
    for (const [, state] of states) this.registry.release(state.assignment.toWire().worker_id);
    return states.length;
  }
  recoverExpired({ now = Date.now() } = {}) {
    const states = [...this.assignments]
      .filter(([, state]) => Date.parse(state.assignment.toWire().lease_deadline) <= now);
    if (states.length === 0) return 0;
    const previous = this.captureState();
    try {
      for (const [assignmentId] of states) this.failState(assignmentId, true);
      this.persist();
    } catch (error) {
      if (schedulerCommitApplied(error)) {
        for (const [, state] of states) this.registry.release(state.assignment.toWire().worker_id);
      } else this.restoreState(previous);
      throw error;
    }
    for (const [, state] of states) this.registry.release(state.assignment.toWire().worker_id);
    return states.length;
  }
  listInterrupted() {
    return [...this.interrupted]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, state]) => state.assignment);
  }
  retryInterrupted(assignmentId) {
    const state = this.interrupted.get(assignmentId);
    if (!state) return false;
    if (this.queue.length >= this.queueCapacity) throw new Error("distributed scheduler queue is at capacity");
    const previous = this.captureState();
    try {
      this.interrupted.delete(assignmentId);
      const nextAttempt = state.assignment.toWire().attempt + 1;
      if (nextAttempt <= this.maxAttempts) this.queue.unshift({ job: state.job, attempt: nextAttempt });
      else this.failed += 1;
      this.persist();
    } catch (error) {
      if (!schedulerCommitApplied(error)) this.restoreState(previous);
      throw error;
    }
    return true;
  }
  autoResumeInterrupted() {
    for (const assignmentId of [...this.interrupted.keys()].sort()) this.retryInterrupted(assignmentId);
  }
  failInterrupted(assignmentId) {
    if (!this.interrupted.has(assignmentId)) return false;
    const previous = this.captureState();
    try {
      this.interrupted.delete(assignmentId);
      this.failed += 1;
      this.persist();
    } catch (error) {
      if (!schedulerCommitApplied(error)) this.restoreState(previous);
      throw error;
    }
    return true;
  }
  snapshot() {
    return {
      queued: this.queue.length,
      assigned: this.assignments.size,
      interrupted: this.interrupted.size,
      completed: this.completed,
      failed: this.failed,
      seen_jobs: this.seen.size,
    };
  }
  get stateGeneration() { return this.generation; }
  failState(assignmentId, retryable) {
    const state = this.assignments.get(assignmentId);
    this.assignments.delete(assignmentId);
    const nextAttempt = state.assignment.toWire().attempt + 1;
    if (retryable && nextAttempt <= this.maxAttempts && this.queue.length < this.queueCapacity) {
      this.queue.unshift({ job: state.job, attempt: nextAttempt });
    } else {
      this.failed += 1;
    }
  }
  activeJobIds() {
    return new Set([
      ...this.queue.map((state) => state.job.toWire().job_id),
      ...[...this.assignments.values()].map((state) => state.job.toWire().job_id),
      ...[...this.interrupted.values()].map((state) => state.job.toWire().job_id),
    ]);
  }
  isDuplicate(wire) {
    return this.seen.has(wire.idempotency_key)
      || [...this.seen.values()].includes(wire.job_id)
      || this.activeJobIds().has(wire.job_id);
  }
  claimSeen(wire) {
    const activeJobIds = this.activeJobIds();
    while (this.seen.size >= this.dedupCapacity) {
      const evictable = [...this.seen].find(([, jobId]) => !activeJobIds.has(jobId));
      if (!evictable) throw new Error("distributed scheduler deduplication state is at capacity");
      this.seen.delete(evictable[0]);
    }
    this.seen.set(wire.idempotency_key, wire.job_id);
  }
  captureState() {
    return {
      queue: [...this.queue],
      assignments: new Map(this.assignments),
      interrupted: new Map(this.interrupted),
      seen: new Map(this.seen),
      completed: this.completed,
      failed: this.failed,
      generation: this.generation,
    };
  }
  restoreState(state) {
    Object.assign(this, state);
  }
  statePayload(generation) {
    if (![this.completed, this.failed, generation].every((value) => Number.isSafeInteger(value) && value >= 0)) {
      throw new TypeError("scheduler state counters exceed the interoperable integer range");
    }
    return {
      completed: this.completed,
      failed: this.failed,
      format: SCHEDULER_STATE_FORMAT,
      format_version: SCHEDULER_STATE_FORMAT_VERSION,
      generation,
      inflight: [...this.assignments]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([, state]) => ({ assignment: state.assignment.toWire(), job: state.job.toWire() })),
      interrupted: [...this.interrupted]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([, state]) => ({
          assignment: state.assignment.toWire(),
          job: state.job.toWire(),
          reason: state.reason,
        })),
      queued: this.queue.map((state) => ({ attempt: state.attempt, job: state.job.toWire() })),
      seen: [...this.seen].map(([idempotencyKey, jobId]) => ({
        idempotency_key: idempotencyKey,
        job_id: jobId,
      })),
    };
  }
  persist() {
    if (!this.stateStore) return;
    const generation = this.generation + 1;
    try {
      this.stateStore.commit(this.statePayload(generation));
    } catch (error) {
      if (schedulerCommitApplied(error)) this.generation = generation;
      throw error;
    }
    this.generation = generation;
  }
  loadState() {
    const value = this.stateStore.load();
    if (value === null || value === undefined) return;
    try {
      const migrated = migrateSchedulerState(value);
      if (migrated.migrated) this.stateStore.commit(migrated.value);
      this.decodeState(migrated.value);
    } catch (error) {
      this.stateStore.quarantine(`invalid scheduler state: ${error?.constructor?.name ?? "Error"}`);
    }
    if (this.assignments.size > 0) {
      for (const [assignmentId, state] of this.assignments) {
        this.interrupted.set(assignmentId, { ...state, reason: "scheduler_restart" });
      }
      this.assignments.clear();
      this.persist();
    }
  }
  decodeState(value) {
    const required = ["completed", "failed", "format", "format_version", "generation", "inflight", "interrupted", "queued", "seen"];
    if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).sort().join("\0") !== [...required].sort().join("\0")) {
      throw new TypeError("scheduler state fields are invalid");
    }
    if (value.format !== SCHEDULER_STATE_FORMAT || value.format_version !== SCHEDULER_STATE_FORMAT_VERSION) {
      throw new TypeError("scheduler state format is unsupported");
    }
    for (const name of ["completed", "failed", "generation"]) {
      if (!Number.isSafeInteger(value[name]) || value[name] < 0) throw new TypeError(`scheduler state ${name} is invalid`);
    }
    for (const name of ["inflight", "interrupted", "queued", "seen"]) {
      if (!Array.isArray(value[name])) throw new TypeError("scheduler state collections are invalid");
    }
    if (value.queued.length > this.queueCapacity) throw new TypeError("scheduler queue exceeds configured capacity");
    if (value.inflight.length + value.interrupted.length > this.queueCapacity) throw new TypeError("scheduler interrupted state exceeds configured capacity");
    if (value.seen.length > this.dedupCapacity) throw new TypeError("scheduler dedup state exceeds configured capacity");

    const jobIds = new Set();
    const activeIdentities = new Map();
    const recordActive = (job) => {
      const wire = job.toWire();
      if (jobIds.has(wire.job_id) || activeIdentities.has(wire.idempotency_key)) {
        throw new TypeError("scheduler job is duplicated");
      }
      jobIds.add(wire.job_id);
      activeIdentities.set(wire.idempotency_key, wire.job_id);
    };
    const queue = value.queued.map((raw) => {
      if (!raw || typeof raw !== "object" || Object.keys(raw).sort().join("\0") !== "attempt\0job") throw new TypeError("queued scheduler record is invalid");
      if (!Number.isSafeInteger(raw.attempt) || raw.attempt < 1 || raw.attempt > this.maxAttempts) throw new TypeError("queued scheduler attempt is invalid");
      const job = new DistributedJob(raw.job);
      recordActive(job);
      return { job, attempt: raw.attempt };
    });
    const assignments = new Map();
    for (const raw of value.inflight) {
      const state = this.decodeAssignmentRecord(raw, false);
      const assignmentId = state.assignment.toWire().assignment_id;
      if (assignments.has(assignmentId)) throw new TypeError("scheduler assignment is duplicated");
      assignments.set(assignmentId, state);
      recordActive(state.job);
    }
    const interrupted = new Map();
    for (const raw of value.interrupted) {
      const state = this.decodeAssignmentRecord(raw, true);
      const assignmentId = state.assignment.toWire().assignment_id;
      if (assignments.has(assignmentId) || interrupted.has(assignmentId)) throw new TypeError("scheduler interrupted assignment is duplicated");
      interrupted.set(assignmentId, { ...state, reason: raw.reason });
      recordActive(state.job);
    }
    const seen = new Map();
    const seenJobIds = new Set();
    for (const raw of value.seen) {
      if (!raw || typeof raw !== "object" || Object.keys(raw).sort().join("\0") !== "idempotency_key\0job_id"
        || typeof raw.idempotency_key !== "string" || raw.idempotency_key.length === 0
        || typeof raw.job_id !== "string" || raw.job_id.length === 0
        || seen.has(raw.idempotency_key) || seenJobIds.has(raw.job_id)) {
        throw new TypeError("scheduler dedup record is invalid");
      }
      seen.set(raw.idempotency_key, raw.job_id);
      seenJobIds.add(raw.job_id);
    }
    for (const [key, jobId] of activeIdentities) {
      if (seen.get(key) !== jobId) throw new TypeError("scheduler active job is missing its dedup identity");
    }
    Object.assign(this, {
      queue,
      assignments,
      interrupted,
      seen,
      completed: value.completed,
      failed: value.failed,
      generation: value.generation,
    });
  }
  decodeAssignmentRecord(raw, interrupted) {
    const expected = interrupted ? "assignment\0job\0reason" : "assignment\0job";
    if (!raw || typeof raw !== "object" || Array.isArray(raw)
      || Object.keys(raw).sort().join("\0") !== expected) {
      throw new TypeError("scheduler assignment record is invalid");
    }
    if (interrupted && raw.reason !== "scheduler_restart") throw new TypeError("interrupted scheduler reason is invalid");
    const assignment = new JobAssignment(raw.assignment);
    const job = new DistributedJob(raw.job);
    if (assignment.toWire().job_id !== job.toWire().job_id) throw new TypeError("scheduler assignment job identity is inconsistent");
    return { assignment, job };
  }
}

export function heartbeatNow(workerId, { sequence, activeJobs, load, metadata = {} }) {
  return new WorkerHeartbeat({ worker_id: workerId, sequence, active_jobs: activeJobs, load, timestamp: new Date().toISOString(), metadata });
}
