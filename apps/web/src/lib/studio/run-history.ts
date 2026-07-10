/**
 * Local filesystem run history for Studio MAI panel.
 * Stored under apps/web/.data/mai-runs/ (gitignored).
 *
 * IMPORTANT — not database-backed yet.
 * This is a single-node bootstrap for demos and early traffic.
 * Multi-user / multi-instance / durable history → Postgres (or similar)
 * is tracked as P0 in ROADMAP.md before a public MAI benchmark.
 *
 * Export path for future scoring:
 *   GET /api/demos/mai-panel/runs?export=benchmark
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  ensureJudgeAnswer,
  type PanelRanking,
} from "./parse-rankings";

export type StoredMaiRun = {
  id: string;
  createdAt: string;
  demo: "mai-style-panel";
  schemaVersion: 1;
  /** Studio workspace scope (P1/P2) */
  workspaceId?: string;
  userId?: string;
  providerId: string;
  providerLabel: string;
  mode: string;
  casePreset?: string;
  task: string;
  taskHash: string;
  success: boolean;
  durationMs: number;
  models: {
    expertA: string;
    expertB: string;
    expertC: string;
    judge: string;
  };
  experts: Array<{
    name: string;
    model: string;
    success: boolean;
    outputChars: number;
  }>;
  handoffCount: number;
  finalAnswer: string;
  finalAnswerChars: number;
  rankings: PanelRanking[];
  redFlag?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    costUsd: number;
    currency: string;
    note: string;
  };
  /** True when we have top-3 rankings + final answer for future scoring */
  benchmarkReady: boolean;
};

export type RunHistorySummary = {
  id: string;
  createdAt: string;
  providerId: string;
  success: boolean;
  durationMs: number;
  judgeModel: string;
  taskPreview: string;
  rankingLabels: string[];
  costUsd?: number;
  benchmarkReady: boolean;
};

const DATA_DIR = join(process.cwd(), ".data", "mai-runs");

function ensureDir() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function hashTask(task: string): string {
  return createHash("sha256").update(task.trim()).digest("hex").slice(0, 16);
}

export function buildStoredRun(input: {
  result: {
    success: boolean;
    mode: string;
    providerId?: string;
    provider: string;
    task: string;
    experts: Array<{
      name: string;
      model: string;
      success: boolean;
      output: string;
    }>;
    judge: { name: string; model: string; output: string };
    finalAnswer: string;
    handoffs: unknown[];
    durationMs: number;
    usage?: StoredMaiRun["usage"];
  };
  casePreset?: string;
  runId?: string;
}): StoredMaiRun {
  const { result, casePreset, runId } = input;
  const ensured = ensureJudgeAnswer(result.finalAnswer || "");
  const experts = result.experts || [];
  const byName = (n: string) =>
    experts.find((e) => e.name === n)?.model || "";

  return {
    id: runId || `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toISOString(),
    demo: "mai-style-panel",
    schemaVersion: 1,
    providerId: result.providerId || result.mode || "unknown",
    providerLabel: result.provider,
    mode: result.mode,
    casePreset,
    task: result.task,
    taskHash: hashTask(result.task),
    success: result.success,
    durationMs: result.durationMs,
    models: {
      expertA: byName("Expert A"),
      expertB: byName("Expert B"),
      expertC: byName("Expert C"),
      judge: result.judge?.model || "",
    },
    experts: experts.map((e) => ({
      name: e.name,
      model: e.model,
      success: e.success,
      outputChars: (e.output || "").length,
    })),
    handoffCount: Array.isArray(result.handoffs) ? result.handoffs.length : 0,
    finalAnswer: ensured.text,
    finalAnswerChars: ensured.text.length,
    rankings: ensured.consensus.rankings,
    redFlag: ensured.consensus.redFlag,
    usage: result.usage,
    benchmarkReady:
      result.success &&
      ensured.consensus.rankings.length >= 2 &&
      ensured.text.length >= 80,
  };
}

export function saveStoredRun(run: StoredMaiRun): StoredMaiRun {
  ensureDir();
  const file = join(DATA_DIR, `${run.id}.json`);
  writeFileSync(file, JSON.stringify(run, null, 2), "utf8");
  return run;
}

/**
 * Persist a run with Studio workspace/auth context (P1/P2).
 * Ensures default workspace exists, stamps workspaceId/userId, then saves.
 */
export async function saveStoredRunWithStudio(
  run: StoredMaiRun
): Promise<StoredMaiRun> {
  const { studioDb } = await import("./db");
  await studioDb.ensureDefaultWorkspace();
  const session = await studioDb.auth.getSession();
  const stamped = session
    ? studioDb.attachRunMeta(run, session)
    : { ...run, workspaceId: "ws_local_default" };
  return saveStoredRun(stamped);
}

export function listStoredRuns(
  limit = 50,
  opts?: { workspaceId?: string }
): RunHistorySummary[] {
  ensureDir();
  const files = readdirSync(DATA_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse();

  const out: RunHistorySummary[] = [];
  for (const f of files) {
    if (out.length >= limit) break;
    try {
      const raw = readFileSync(join(DATA_DIR, f), "utf8");
      const run = JSON.parse(raw) as StoredMaiRun;
      if (opts?.workspaceId && run.workspaceId && run.workspaceId !== opts.workspaceId) {
        continue;
      }
      out.push({
        id: run.id,
        createdAt: run.createdAt,
        providerId: run.providerId,
        success: run.success,
        durationMs: run.durationMs,
        judgeModel: run.models.judge,
        taskPreview: run.task.slice(0, 120).replace(/\s+/g, " "),
        rankingLabels: (run.rankings || []).map(
          (r) => `${r.label} (${r.percent}%)`
        ),
        costUsd: run.usage?.costUsd,
        benchmarkReady: Boolean(run.benchmarkReady),
      });
    } catch {
      /* skip corrupt */
    }
  }
  // newest first by createdAt
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function getStoredRun(id: string): StoredMaiRun | null {
  ensureDir();
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, "");
  const file = join(DATA_DIR, `${safe}.json`);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as StoredMaiRun;
  } catch {
    return null;
  }
}

/** Compact export for future public benchmark aggregation */
export function exportBenchmarkCorpus(limit = 500): {
  exportedAt: string;
  count: number;
  readyCount: number;
  items: Array<{
    id: string;
    createdAt: string;
    taskHash: string;
    providerId: string;
    models: StoredMaiRun["models"];
    rankings: PanelRanking[];
    success: boolean;
    durationMs: number;
    usage?: StoredMaiRun["usage"];
  }>;
} {
  ensureDir();
  const files = readdirSync(DATA_DIR).filter((f) => f.endsWith(".json"));
  const items: Array<{
    id: string;
    createdAt: string;
    taskHash: string;
    providerId: string;
    models: StoredMaiRun["models"];
    rankings: PanelRanking[];
    success: boolean;
    durationMs: number;
    usage?: StoredMaiRun["usage"];
  }> = [];

  for (const f of files) {
    if (items.length >= limit) break;
    try {
      const run = JSON.parse(
        readFileSync(join(DATA_DIR, f), "utf8")
      ) as StoredMaiRun;
      if (!run.benchmarkReady) continue;
      items.push({
        id: run.id,
        createdAt: run.createdAt,
        taskHash: run.taskHash,
        providerId: run.providerId,
        models: run.models,
        rankings: run.rankings,
        success: run.success,
        durationMs: run.durationMs,
        usage: run.usage,
      });
    } catch {
      /* skip */
    }
  }

  return {
    exportedAt: new Date().toISOString(),
    count: items.length,
    readyCount: items.filter((i) => i.rankings.length >= 2).length,
    items,
  };
}
