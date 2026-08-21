/**
 * Model Fusion-style multi-model panel demo (offline by default).
 *
 * Mirrors packages/python/examples/fusion_style_demo.py and the Python
 * recipes.fusion module, but implemented entirely with JS/Node primitives
 * so the benchmark runs without a Python interpreter.
 *
 * Real provider calls are not wired here; every step uses EchoProvider to
 * remain deterministic and dependency-free.
 */

import fs from "node:fs";
import { join } from "node:path";

import {
  Agent,
  EchoProvider,
  HandoffState,
  HandoffQualityEvaluator,
  Team,
  RunTrace,
} from "@handoffkit/core";
import { writeReportFiles } from "@handoffkit/node";

/** Default task posed to all panel models. */
export const DEFAULT_FUSION_TASK =
  "Summarize the key architectural trade-offs of a multi-agent handoff protocol.";

/** Model ids used in offline simulation. */
export const DEFAULT_FUSION_MODELS = [
  "openai/gpt-4o",
  "anthropic/claude-3-5-sonnet",
  "google/gemini-2.5-pro",
];

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build a single-agent team that "responds" to the task using EchoProvider.
 * In real mode you would swap EchoProvider for an OpenRouter/real provider.
 *
 * @param {string} model  Model id string (used as agent name & metadata).
 * @param {string} task   Task description forwarded to the provider.
 * @returns {{ model: string, response: string, latencyMs: number }}
 */
function runPanelModel(model, task) {
  const start = Date.now();

  const agent = new Agent({
    name: model,
    role: `Provide a concise expert answer for: ${task}`,
    provider: new EchoProvider({ model }),
  });

  // EchoProvider echoes the task back; in real mode this would be an LLM call.
  const team = new Team({ agents: [agent], metadata: { fusion: true, model } });
  const result = team.run(task);

  return {
    model,
    response: result.finalOutput,
    latencyMs: Date.now() - start,
  };
}

/**
 * Judge step: synthesise the panel responses into a final verdict.
 *
 * @param {Array<{ model: string, response: string }>} panelResults
 * @param {string} task
 * @returns {{ verdict: string, confidence: number }}
 */
function runJudge(panelResults, task) {
  const summary = panelResults
    .map((r) => `[${r.model}]: ${r.response.slice(0, 120)}`)
    .join("\n");

  return {
    verdict: `Fusion verdict for "${task}":\n${summary}\n\nAll panel models agree on the core trade-offs. Consensus confidence: high.`,
    confidence: 0.88,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run the full fusion demo (panel + judge) and write report files.
 *
 * @param {object}   opts
 * @param {string}   [opts.task]        Task sent to every panel model.
 * @param {string[]} [opts.models]      List of model id strings.
 * @param {string}   [opts.outputName]  Base name for report files.
 * @param {string}   [opts.reportsDir]  Directory that receives JSON/MD reports.
 * @returns {Promise<{ report: object, jsonPath: string, markdownPath: string }>}
 */
export async function runFusionDemo({
  task = DEFAULT_FUSION_TASK,
  models = DEFAULT_FUSION_MODELS,
  outputName = "fusion_style_demo",
  reportsDir = "reports",
} = {}) {
  fs.mkdirSync(reportsDir, { recursive: true });

  // --- Panel step: run every model concurrently (synchronous here because
  //     EchoProvider is sync, but the API is kept async for real-mode compat)
  const panelResults = models.map((model) => runPanelModel(model, task));

  // --- Judge step
  const judgeResult = runJudge(panelResults, task);

  // --- HandoffState captures the cross-agent context
  const handoff = new HandoffState({
    task,
    fromAgent: "FusionPanel",
    toAgent: "FusionJudge",
    summary: judgeResult.verdict,
    decisions: [
      "Each panel model receives the same task independently.",
      "Judge synthesises all responses before producing the verdict.",
      "Offline demo: EchoProvider used instead of real LLMs.",
    ],
    importantFiles: [],
    nextSteps: [
      "Swap EchoProvider for a real OpenRouter provider.",
      "Add per-model confidence scores.",
      "Persist panel responses to a vector store for retrieval.",
    ],
    contextRefs: [`fusion-demo:${outputName}`],
    metadata: {
      mode: "offline",
      models: models.join(","),
      judge_confidence: judgeResult.confidence,
    },
  });

  // --- Quality evaluation
  const quality = new HandoffQualityEvaluator().evaluate(handoff);

  // --- Build a trace across panel agents
  const traceTeam = new Team({
    agents: models.map(
      (m) =>
        new Agent({
          name: m,
          role: "Panel participant",
          provider: new EchoProvider({ model: m }),
        }),
    ),
    metadata: { fusion: true },
  });
  const traceResult = traceTeam.run(task);
  const trace = RunTrace.fromTeamResult(traceResult, { name: outputName });

  // --- Compose a report object with toJSON / toMarkdown
  const report = {
    success: quality.success,
    mode: "offline",
    task,
    panel: panelResults,
    verdict: judgeResult.verdict,
    judge_confidence: judgeResult.confidence,
    quality: quality.toJSON(),
    handoff: handoff.toJSON ? handoff.toJSON() : handoff,
    trace: trace.toJSON(),

    toJSON() {
      return {
        kind: "handoffkit-js-fusion-demo",
        success: this.success,
        mode: this.mode,
        task: this.task,
        panel: this.panel,
        verdict: this.verdict,
        judge_confidence: this.judge_confidence,
        quality: this.quality,
        handoff: this.handoff,
      };
    },

    toMarkdown() {
      const modelList = panelResults
        .map((r) => `- **${r.model}** (${r.latencyMs} ms): ${r.response.slice(0, 120)}`)
        .join("\n");

      return [
        "# Fusion-Style Multi-Model Panel Demo",
        "",
        `**Task**: ${task}`,
        `**Mode**: ${this.mode}`,
        `**Success**: ${this.success}`,
        "",
        "## Panel Responses",
        "",
        modelList,
        "",
        "## Judge Verdict",
        "",
        this.verdict,
        "",
        `**Confidence**: ${this.judge_confidence}`,
        "",
        "## Quality",
        "",
        `Grade: ${this.quality.grade ?? "-"}  Score: ${this.quality.score ?? "-"}`,
        "",
        "> Offline demo only — no real LLM calls were made.",
      ].join("\n");
    },
  };

  const files = await writeReportFiles(report, outputName, reportsDir);

  return {
    report,
    jsonPath: files.jsonPath,
    markdownPath: files.markdownPath,
  };
}
