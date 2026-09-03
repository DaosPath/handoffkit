#!/usr/bin/env node
/**
 * Browser Real local benchmark. This archives measurements only; it is not a
 * performance guarantee and does not replace the hosted soak gate.
 */
import { createServer } from "node:http";
import { performance } from "node:perf_hooks";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BrowserRealService } from "../../js/packages/browser-real/src/index.js";

const navigationCount = Number.parseInt(process.env.HANDOFFKIT_BROWSER_REAL_BENCH_NAVIGATIONS || "20", 10);
const coldRuns = Number.parseInt(process.env.HANDOFFKIT_BROWSER_REAL_BENCH_COLD_RUNS || "3", 10);
if (!Number.isInteger(navigationCount) || navigationCount < 5) {
  throw new Error("HANDOFFKIT_BROWSER_REAL_BENCH_NAVIGATIONS must be an integer >= 5");
}
if (!Number.isInteger(coldRuns) || coldRuns < 1) {
  throw new Error("HANDOFFKIT_BROWSER_REAL_BENCH_COLD_RUNS must be a positive integer");
}

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
  return Number(sorted[index].toFixed(3));
}

function summary(values) {
  return {
    count: values.length,
    min_ms: Number(Math.min(...values).toFixed(3)),
    p50_ms: percentile(values, 0.50),
    p95_ms: percentile(values, 0.95),
    p99_ms: percentile(values, 0.99),
    max_ms: Number(Math.max(...values).toFixed(3)),
  };
}

async function listen() {
  const server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><title>HandoffKit Browser Real benchmark</title><main><h1>${request.url}</h1><p>local benchmark</p></main>`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, port: server.address().port };
}

async function runCycle(port, sessionId, count) {
  const service = new BrowserRealService({
    policy: { network: { allow_loopback: true }, filesystem: { allow_write: true } },
  });
  const start = performance.now();
  await service.dispatch({
    command_id: `${sessionId}-start`,
    session_id: sessionId,
    name: "session.start",
    payload: {
      product: "real",
      session_id: sessionId,
      policy: { network: { allow_loopback: true }, filesystem: { allow_write: true } },
    },
  });
  const startupMs = performance.now() - start;
  const navigationMs = [];
  try {
    for (let index = 0; index < count; index += 1) {
      const began = performance.now();
      const result = await service.dispatch({
        command_id: `${sessionId}-navigate-${index}`,
        session_id: sessionId,
        name: "navigate",
        payload: { url: `http://127.0.0.1:${port}/page-${index}` },
      });
      if (result.name !== "navigated") throw new Error(`unexpected navigation result: ${result.name}`);
      navigationMs.push(performance.now() - began);
    }
  } finally {
    await service.dispatch({
      command_id: `${sessionId}-close`,
      session_id: sessionId,
      name: "session.close",
      payload: {},
    }).catch(() => {});
    await service.supervisor.closeOwned();
  }
  return { startupMs, navigationMs, orphans: service.supervisor.ownedPids.size };
}

const { server, port } = await listen();
const startedAt = new Date().toISOString();
try {
  const cold = [];
  let hot;
  let orphans = 0;
  for (let run = 0; run < coldRuns; run += 1) {
    const cycle = await runCycle(port, `bench-${run}`, navigationCount);
    cold.push(cycle.startupMs);
    hot = cycle.navigationMs;
    orphans += cycle.orphans;
  }
  const report = {
    format: "handoffkit.browser.real.benchmark",
    format_version: 1,
    generated_at: new Date().toISOString(),
    started_at: startedAt,
    product: "browser-real",
    notice: "Environmental local measurement only; not a performance guarantee. Hosted 4h/1000 soak and cross-architecture results are separate gates.",
    environment: {
      platform: process.platform,
      architecture: process.arch,
      node: process.version,
      loopback: true,
    },
    cold_startup: summary(cold),
    hot_navigation: summary(hot),
    requested_navigation_count: navigationCount,
    cold_runs: coldRuns,
    orphan_processes_observed: orphans,
    status: "pass",
  };
  const output = process.env.HANDOFFKIT_BROWSER_REAL_BENCH_OUTPUT
    || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "reports", "BROWSER_1.20_REAL_BENCH.json");
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
} finally {
  server.closeAllConnections?.();
  server.close();
}
