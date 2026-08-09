import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  DistributedJob,
  DistributedScheduler,
  SecurityError,
  WorkerCapabilities,
  WorkerRegistry,
} from "@handoffkit/csp";
import { FileSchedulerStateStore } from "../src/index.js";

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "handoffkit-node-scheduler-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function capabilities(workerId) {
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

function job() {
  return new DistributedJob({
    job_id: "job-durable",
    operation: "evaluate",
    payload: { input: 1 },
    requested_capabilities: ["evaluate"],
    idempotency_key: "key-durable",
    deadline: null,
    metadata: {},
  });
}

test("Node durable scheduler requires explicit retry after process restart", (t) => {
  const statePath = path.join(workspace(t), "scheduler-state.json");
  const firstRegistry = new WorkerRegistry();
  firstRegistry.register(capabilities("worker-first"));
  const first = new DistributedScheduler(firstRegistry, {
    maxAttempts: 3,
    stateStore: new FileSchedulerStateStore(statePath),
  });
  assert.equal(first.submit(job()), true);
  const initial = first.schedule();
  assert.equal(initial.toWire().attempt, 1);

  const secondRegistry = new WorkerRegistry();
  secondRegistry.register(capabilities("worker-second"));
  const second = new DistributedScheduler(secondRegistry, {
    maxAttempts: 3,
    stateStore: new FileSchedulerStateStore(statePath),
  });
  assert.deepEqual(second.snapshot(), {
    queued: 0,
    assigned: 0,
    interrupted: 1,
    completed: 0,
    failed: 0,
    seen_jobs: 1,
  });
  assert.equal(second.submit(job()), false);
  assert.deepEqual(
    second.listInterrupted().map((item) => item.toWire().assignment_id),
    [initial.toWire().assignment_id],
  );
  assert.equal(second.retryInterrupted(initial.toWire().assignment_id), true);
  const retry = second.schedule();
  assert.equal(retry.toWire().attempt, 2);
  assert.equal(second.complete(retry.toWire().assignment_id), true);

  const third = new DistributedScheduler(new WorkerRegistry(), {
    maxAttempts: 3,
    stateStore: new FileSchedulerStateStore(statePath),
  });
  assert.equal(third.snapshot().completed, 1);
  assert.equal(third.snapshot().interrupted, 0);
  assert.equal(third.snapshot().seen_jobs, 1);
});

test("Node durable scheduler opt-in auto-resume is at-least-once", (t) => {
  const statePath = path.join(workspace(t), "scheduler-state.json");
  const firstRegistry = new WorkerRegistry();
  firstRegistry.register(capabilities("worker-first"));
  const first = new DistributedScheduler(firstRegistry, {
    maxAttempts: 3,
    stateStore: new FileSchedulerStateStore(statePath),
  });
  assert.equal(first.submit(job()), true);
  assert.ok(first.schedule());

  const secondRegistry = new WorkerRegistry();
  secondRegistry.register(capabilities("worker-second"));
  const resumed = new DistributedScheduler(secondRegistry, {
    maxAttempts: 3,
    stateStore: new FileSchedulerStateStore(statePath),
    autoResume: true,
  });
  assert.equal(resumed.snapshot().interrupted, 0);
  assert.equal(resumed.snapshot().queued, 1);
  assert.equal(resumed.schedule().toWire().attempt, 2);
});

test("Node durable scheduler migrates the supported v0 envelope", (t) => {
  const statePath = path.join(workspace(t), "scheduler-state.json");
  const firstRegistry = new WorkerRegistry();
  firstRegistry.register(capabilities("worker-first"));
  const firstStore = new FileSchedulerStateStore(statePath);
  const first = new DistributedScheduler(firstRegistry, { stateStore: firstStore });
  assert.equal(first.submit(job()), true);
  assert.ok(first.schedule());
  const legacy = firstStore.load();
  delete legacy.interrupted;
  legacy.format_version = 0;
  firstStore.commit(legacy);

  const migrated = new DistributedScheduler(new WorkerRegistry(), {
    stateStore: new FileSchedulerStateStore(statePath),
  });
  assert.equal(migrated.snapshot().interrupted, 1);
  assert.equal(new FileSchedulerStateStore(statePath).load().format_version, 1);
});

test("Node durable scheduler quarantines checksum tamper", (t) => {
  const root = workspace(t);
  const statePath = path.join(root, "scheduler-state.json");
  const scheduler = new DistributedScheduler(new WorkerRegistry(), {
    stateStore: new FileSchedulerStateStore(statePath),
  });
  assert.equal(scheduler.submit(job()), true);
  const value = JSON.parse(fs.readFileSync(statePath, "utf8"));
  value.completed = 99;
  fs.writeFileSync(statePath, JSON.stringify(value), { encoding: "utf8", mode: 0o600 });

  assert.throws(
    () => new DistributedScheduler(new WorkerRegistry(), {
      stateStore: new FileSchedulerStateStore(statePath),
    }),
    (error) => error instanceof SecurityError && error.code === "security_state_corrupt",
  );
  assert.equal(
    fs.readdirSync(root).some((name) => name.startsWith("scheduler-state.json.corrupt-")),
    true,
  );
});

test("Node loads the shared durable scheduler fixture", (t) => {
  const root = workspace(t);
  const statePath = path.join(root, "scheduler-state.json");
  const fixture = path.join(
    import.meta.dirname,
    "..",
    "..",
    "..",
    "contracts",
    "test-fixtures",
    "runtime",
    "durable-scheduler-v1.json",
  );
  fs.copyFileSync(fixture, statePath);
  fs.chmodSync(statePath, 0o600);
  const scheduler = new DistributedScheduler(new WorkerRegistry(), {
    maxAttempts: 3,
    queueCapacity: 16,
    dedupCapacity: 32,
    stateStore: new FileSchedulerStateStore(statePath),
  });
  assert.deepEqual(scheduler.snapshot(), {
    queued: 1,
    assigned: 0,
    interrupted: 1,
    completed: 2,
    failed: 1,
    seen_jobs: 3,
  });
  assert.equal(scheduler.stateGeneration, 7);
  assert.deepEqual(
    scheduler.listInterrupted().map((item) => item.toWire().assignment_id),
    ["assignment-scheduler-interrupted"],
  );
});

test("Node scheduler state backup and restore preserve validated state", (t) => {
  const root = workspace(t);
  const statePath = path.join(root, "scheduler-state.json");
  const backupPath = path.join(root, "backups", "scheduler-state.json");
  const store = new FileSchedulerStateStore(statePath);
  const scheduler = new DistributedScheduler(new WorkerRegistry(), { stateStore: store });
  assert.equal(scheduler.submit(job()), true);

  store.backup(backupPath);
  assert.equal(fs.existsSync(backupPath), true);
  fs.unlinkSync(statePath);
  store.restore(backupPath);

  const restored = new DistributedScheduler(new WorkerRegistry(), {
    stateStore: new FileSchedulerStateStore(statePath),
  });
  assert.equal(restored.snapshot().queued, 1);
  assert.equal(restored.snapshot().seen_jobs, 1);
});
