import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  DistributedJob,
  DistributedScheduler,
  JobAssignment,
  RuntimeMode,
  CspRuntime,
  WorkerCapabilities,
  WorkerHeartbeat,
  WorkerRegistry,
  WorkerStatus,
} from "../src/index.js";

const fixtures = join(import.meta.dirname, "..", "..", "..", "contracts", "fixtures");

for (const [name, Contract] of [
  ["worker_heartbeat.json", WorkerHeartbeat],
  ["distributed_job.json", DistributedJob],
  ["job_assignment.json", JobAssignment],
]) {
  test(`${name} distributed fixture round-trips`, async () => {
    const value = JSON.parse(await readFile(join(fixtures, name), "utf8"));
    assert.deepEqual(new Contract(value).toWire(), value);
  });
}

function capabilities(workerId = "worker-js-1") {
  return new WorkerCapabilities({
    worker_id: workerId,
    runtime: "javascript",
    os: "test",
    architecture: "x86_64",
    cpu_cores: 4,
    memory_bytes: 1024,
    cuda: false,
    cuda_devices: [],
    profiles: [],
    operations: ["evaluate"],
    metadata: {},
  });
}

test("distributed runtime, heartbeat expiry, and deterministic routing", () => {
  const session = new CspRuntime({ mode: RuntimeMode.DISTRIBUTED }).createSession();
  assert.equal(session.config.runtimeMode, RuntimeMode.DISTRIBUTED);
  assert.equal(session.diagnostics().channel_count, 0);

  let now = 0;
  const registry = new WorkerRegistry({ suspectAfterMs: 5, offlineAfterMs: 10, clock: () => now });
  registry.register(capabilities());
  assert.equal(registry.reserve(["evaluate"]).activeJobs, 1);
  registry.release("worker-js-1");
  assert.equal(registry.heartbeat(new WorkerHeartbeat({ worker_id: "worker-js-1", sequence: 1, active_jobs: 0, load: 0.25, timestamp: "2026-01-01T00:00:00Z", metadata: {} })), true);
  assert.equal(registry.heartbeat(new WorkerHeartbeat({ worker_id: "worker-js-1", sequence: 1, active_jobs: 0, load: 0.5, timestamp: "2026-01-01T00:00:01Z", metadata: {} })), false);
  now = 6;
  registry.expire();
  assert.equal(registry.get("worker-js-1").status, WorkerStatus.SUSPECT);
  now = 11;
  registry.expire();
  assert.equal(registry.get("worker-js-1").status, WorkerStatus.OFFLINE);
});

test("scheduler retries, leases, and deduplicates jobs", () => {
  const registry = new WorkerRegistry();
  registry.register(capabilities());
  const scheduler = new DistributedScheduler(registry, { maxAttempts: 2, leaseMs: 1 });
  const job = new DistributedJob({ job_id: "job-1", operation: "evaluate", payload: { input: 1 }, requested_capabilities: ["evaluate"], idempotency_key: "key-1", deadline: null, metadata: {} });
  assert.equal(scheduler.submit(job), true);
  assert.equal(scheduler.submit(job), false);
  const first = scheduler.schedule();
  assert.equal(first.toWire().attempt, 1);
  assert.equal(scheduler.fail(first.toWire().assignment_id), true);
  const second = scheduler.schedule();
  assert.equal(second.toWire().attempt, 2);
  assert.equal(scheduler.recoverExpired({ now: Number.MAX_SAFE_INTEGER }), 1);
  assert.equal(scheduler.snapshot().failed, 1);
});

test("scheduler retry never exceeds queue capacity", () => {
  const registry = new WorkerRegistry();
  registry.register(capabilities());
  const scheduler = new DistributedScheduler(registry, { queueCapacity: 1 });
  const first = new DistributedJob({ job_id: "job-1", operation: "evaluate", payload: {}, requested_capabilities: ["evaluate"], idempotency_key: "key-1", deadline: null, metadata: {} });
  const second = new DistributedJob({ job_id: "job-2", operation: "evaluate", payload: {}, requested_capabilities: ["evaluate"], idempotency_key: "key-2", deadline: null, metadata: {} });
  scheduler.submit(first);
  const assignment = scheduler.schedule();
  scheduler.submit(second);
  scheduler.fail(assignment.toWire().assignment_id);
  assert.deepEqual(scheduler.snapshot(), { queued: 1, assigned: 0, completed: 0, failed: 1, seen_jobs: 2 });
});
