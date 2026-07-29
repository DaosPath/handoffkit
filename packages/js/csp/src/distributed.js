import {
  DistributedJob,
  JobAssignment,
  WorkerCapabilities,
  WorkerHeartbeat,
} from "./contracts.js";

export const WorkerStatus = Object.freeze({ ONLINE: "online", SUSPECT: "suspect", OFFLINE: "offline" });

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
  constructor(registry, { maxAttempts = 3, leaseMs = 30_000, queueCapacity = 4096, dedupCapacity = 100_000 } = {}) {
    if (!(registry instanceof WorkerRegistry)) throw new TypeError("registry must be a WorkerRegistry");
    if (maxAttempts < 1 || leaseMs < 1 || queueCapacity < 1 || dedupCapacity < 1) throw new TypeError("scheduler limits must be positive");
    Object.assign(this, { registry, maxAttempts, leaseMs, queueCapacity, dedupCapacity });
    this.queue = [];
    this.assignments = new Map();
    this.attempts = new Map();
    this.seen = new Map();
    this.completed = 0;
    this.failed = 0;
  }
  submit(value) {
    const job = value instanceof DistributedJob ? value : new DistributedJob(value);
    const wire = job.toWire();
    if (this.seen.has(wire.idempotency_key)) return false;
    if (this.queue.length >= this.queueCapacity) throw new Error("distributed scheduler queue is at capacity");
    this.seen.set(wire.idempotency_key, wire.job_id);
    while (this.seen.size > this.dedupCapacity) this.seen.delete(this.seen.keys().next().value);
    this.attempts.set(wire.job_id, this.attempts.get(wire.job_id) ?? 0);
    this.queue.push(job);
    return true;
  }
  schedule() {
    const queued = this.queue.length;
    for (let index = 0; index < queued; index += 1) {
      const job = this.queue.shift();
      const wire = job.toWire();
      const worker = this.registry.reserve(wire.requested_capabilities);
      if (!worker) { this.queue.push(job); continue; }
      const attempt = (this.attempts.get(wire.job_id) ?? 0) + 1;
      this.attempts.set(wire.job_id, attempt);
      const assigned = Date.now();
      const assignment = new JobAssignment({
        assignment_id: identifier("assignment"),
        job_id: wire.job_id,
        worker_id: worker.workerId,
        attempt,
        assigned_at: new Date(assigned).toISOString(),
        lease_deadline: new Date(assigned + this.leaseMs).toISOString(),
        payload: wire.payload,
        metadata: { ...wire.metadata, operation: wire.operation, idempotency_key: wire.idempotency_key },
      });
      this.assignments.set(assignment.toWire().assignment_id, { assignment, job });
      return assignment;
    }
    return null;
  }
  complete(assignmentId) {
    const state = this.assignments.get(assignmentId);
    if (!state) return false;
    this.assignments.delete(assignmentId);
    this.registry.release(state.assignment.toWire().worker_id);
    this.completed += 1;
    return true;
  }
  fail(assignmentId, { retryable = true } = {}) {
    const state = this.assignments.get(assignmentId);
    if (!state) return false;
    this.assignments.delete(assignmentId);
    const assignment = state.assignment.toWire();
    this.registry.release(assignment.worker_id);
    if (retryable && assignment.attempt < this.maxAttempts && this.queue.length < this.queueCapacity) this.queue.unshift(state.job);
    else this.failed += 1;
    return true;
  }
  recoverWorker(workerId) {
    const identifiers = [...this.assignments].filter(([, state]) => state.assignment.toWire().worker_id === workerId).map(([assignmentId]) => assignmentId);
    for (const assignmentId of identifiers) this.fail(assignmentId);
    return identifiers.length;
  }
  recoverExpired({ now = Date.now() } = {}) {
    const identifiers = [...this.assignments].filter(([, state]) => Date.parse(state.assignment.toWire().lease_deadline) <= now).map(([assignmentId]) => assignmentId);
    for (const assignmentId of identifiers) this.fail(assignmentId);
    return identifiers.length;
  }
  snapshot() { return { queued: this.queue.length, assigned: this.assignments.size, completed: this.completed, failed: this.failed, seen_jobs: this.seen.size }; }
}

export function heartbeatNow(workerId, { sequence, activeJobs, load, metadata = {} }) {
  return new WorkerHeartbeat({ worker_id: workerId, sequence, active_jobs: activeJobs, load, timestamp: new Date().toISOString(), metadata });
}
