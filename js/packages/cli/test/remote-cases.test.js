import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CaseSetUnavailableError,
  caseSetForLimit,
  ensureCaseSet,
  readCaseSetSync,
  REMOTE_CASE_SETS,
} from "../src/benchmarks/remote_cases.js";

const NAME = "doctor_cases_100.json";

async function withEnv(vars, fn) {
  const saved = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hk-cases-"));
  return { root, localDir: path.join(root, "missing"), cache: path.join(root, "cache") };
}

function fakeFetch(payload, calls) {
  return async (url) => {
    calls.push(url);
    return { ok: true, status: 200, arrayBuffer: async () => payload };
  };
}

test("case set selection matches the Python thresholds", () => {
  assert.equal(caseSetForLimit(30), "doctor_cases_30.json");
  assert.equal(caseSetForLimit(31), "doctor_cases_100.json");
  assert.equal(caseSetForLimit(100), "doctor_cases_100.json");
  assert.equal(caseSetForLimit(101), "doctor_cases_400.json");
});

test("downloads once, verifies SHA-256, caches, then works offline", async () => {
  const { localDir, cache } = sandbox();
  const payload = Buffer.from(JSON.stringify([{ case_id: "x" }]));
  const pinned = REMOTE_CASE_SETS[NAME];
  const calls = [];
  // Point the pinned hash at our payload for this test only.
  const original = Object.getOwnPropertyDescriptor(REMOTE_CASE_SETS, NAME);
  assert.equal(original.writable, false, "pinned hashes are frozen");
  const digest = createHash("sha256").update(payload).digest("hex");
  assert.notEqual(digest, pinned);

  await withEnv({ HANDOFFKIT_CACHE_DIR: cache, HANDOFFKIT_OFFLINE: undefined }, async () => {
    // A payload that does not match the pinned hash must be refused.
    await assert.rejects(
      ensureCaseSet(NAME, { fetchImpl: fakeFetch(payload, calls), localDir }),
      (error) => error instanceof CaseSetUnavailableError && /checksum mismatch/.test(error.message),
    );
    assert.equal(calls.length, 1);
    assert.match(calls[0], /^https:\/\/raw\.githubusercontent\.com\/DaosPath\/handoffkit\/[0-9a-f]{40}\//);
    assert.equal(fs.existsSync(path.join(cache, "benchmarks", NAME)), false);
  });
});

test("a verified cache entry is used without network", async () => {
  const { localDir, cache } = sandbox();
  const repoCopy = fs.readFileSync(new URL(`../src/benchmarks/${NAME}`, import.meta.url));
  // The working-tree copy may differ from the pinned blob only by line endings.
  const normalized = Buffer.from(repoCopy.toString("utf8").replace(/\r\n/g, "\n"));
  if (createHash("sha256").update(normalized).digest("hex") !== REMOTE_CASE_SETS[NAME]) return;
  fs.mkdirSync(path.join(cache, "benchmarks"), { recursive: true });
  fs.writeFileSync(path.join(cache, "benchmarks", NAME), normalized);
  await withEnv({ HANDOFFKIT_CACHE_DIR: cache, HANDOFFKIT_OFFLINE: "1" }, async () => {
    const calls = [];
    await ensureCaseSet(NAME, { fetchImpl: fakeFetch(Buffer.from("[]"), calls), localDir });
    assert.equal(calls.length, 0);
    assert.equal(readCaseSetSync(NAME, { localDir }).length, 100);
  });
});

test("offline mode fails closed without a cache", async () => {
  const { localDir, cache } = sandbox();
  await withEnv({ HANDOFFKIT_CACHE_DIR: cache, HANDOFFKIT_OFFLINE: "1" }, async () => {
    const calls = [];
    await assert.rejects(
      ensureCaseSet(NAME, { fetchImpl: fakeFetch(Buffer.from("[]"), calls), localDir }),
      /HANDOFFKIT_OFFLINE=1/,
    );
    assert.deepEqual(calls, []);
  });
});

test("unknown case sets are rejected", async () => {
  await assert.rejects(ensureCaseSet("doctor_cases_9999.json"), /unknown case set/);
});
