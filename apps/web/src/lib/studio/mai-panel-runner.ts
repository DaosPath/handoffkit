/**
 * MAI-style expert panel runner for Handoff Kit Studio.
 * Uses @handoffkit/core Agent + HandoffProtocol + OpenAI-compatible providers
 * (NVIDIA NIM free endpoints or Groq).
 *
 * Emits progress events so the UI can animate the Expert Panel Flow live.
 */

import {
  Agent,
  EchoProvider,
  HandoffProtocol,
  OpenAIProvider,
  RunTrace,
  type HandoffState,
} from "@handoffkit/core";
import {
  DEFAULT_GROQ_MODEL,
  DEFAULT_GROQ_PANEL_MODELS,
  estimateGroqUsd,
  GROQ_BASE_URL,
} from "./groq-models";
import {
  DEFAULT_NVIDIA_MODEL as NIM_DEFAULT,
  DEFAULT_PANEL_MODELS as NIM_PANEL_DEFAULTS,
} from "./nvidia-models";
import { ensureJudgeAnswer } from "./parse-rankings";

export type StudioProviderId = "nvidia" | "groq";

export type MaiPanelRole = {
  name: string;
  role: string;
  model: string;
};

export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
};

export type MaiPanelRunInput = {
  task: string;
  /** nvidia (NIM free) or groq */
  providerId?: StudioProviderId;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  experts?: MaiPanelRole[];
  judgeModel?: string;
  offline?: boolean;
  temperature?: number;
  maxTokens?: number;
  onEvent?: (event: MaiPanelEvent) => void | Promise<void>;
};

export type MaiExpertResult = {
  name: string;
  model: string;
  role: string;
  output: string;
  success: boolean;
  usage?: TokenUsage;
};

export type MaiPanelRunResult = {
  success: boolean;
  mode: "nvidia" | "groq" | "offline-echo";
  providerId: StudioProviderId | "echo";
  task: string;
  provider: string;
  baseUrl: string;
  experts: MaiExpertResult[];
  judge: {
    name: string;
    model: string;
    output: string;
    usage?: TokenUsage;
  };
  finalAnswer: string;
  handoffs: ReturnType<HandoffState["toJSON"]>[];
  timeline: Array<{
    id: string;
    label: string;
    kind: string;
    detail: string;
    model?: string;
  }>;
  trace: Record<string, unknown>;
  safetyNote: string;
  durationMs: number;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    costUsd: number;
    currency: "USD";
    note: string;
  };
};

export type MaiPanelEvent =
  | {
      type: "run_start";
      mode: "nvidia" | "groq" | "offline-echo";
      task: string;
      provider: string;
      model: string;
      experts: Array<{ name: string; model: string }>;
    }
  | { type: "node_start"; nodeId: string; label: string }
  | {
      type: "expert_done";
      expert: MaiExpertResult;
      index: number;
      total: number;
    }
  | {
      type: "handoff";
      handoff: ReturnType<HandoffState["toJSON"]>;
    }
  | { type: "judge_start"; model: string }
  | {
      type: "judge_done";
      judge: MaiPanelRunResult["judge"];
      finalAnswer: string;
    }
  | { type: "run_complete"; result: MaiPanelRunResult }
  | { type: "error"; message: string };

const SAFETY_NOTE =
  "Research-only orchestration demo using Handoff Kit structured handoffs. Not medical advice, not a diagnosis, not for patient care.";

const DEFAULT_NVIDIA_BASE = "https://integrate.api.nvidia.com/v1";
const DEFAULT_NVIDIA_MODEL = NIM_DEFAULT;

function readUsage(
  provider: unknown,
  modelId: string,
  providerId: StudioProviderId | "echo"
): TokenUsage | undefined {
  const p = provider as {
    lastUsage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    } | null;
  };
  const u = p?.lastUsage;
  if (!u) return undefined;
  const promptTokens = Number(u.prompt_tokens || 0);
  const completionTokens = Number(u.completion_tokens || 0);
  const totalTokens = Number(
    u.total_tokens || promptTokens + completionTokens
  );
  const costUsd =
    providerId === "groq"
      ? estimateGroqUsd(modelId, promptTokens, completionTokens)
      : 0;
  return { promptTokens, completionTokens, totalTokens, costUsd };
}

const EXPERT_A_ROLE = `You are Expert A — Primary Analyst in a multi-agent research panel (MAI-style).

MISSION
Given ANY user case/vignette (medical, technical, business, legal research, or general reasoning), produce a primary analysis with calibrated top-3 weights. Adapt to the domain of the case; do not force a medical frame if the case is non-medical.

HARD RULES
- Research-only. Never give clinical orders, prescriptions, legal counsel-as-advice, or "you must do X" care instructions.
- Never claim certainty. Use calibrated language (plausible / possible / less likely).
- Ground ONLY in facts present in the case; mark missing data explicitly. Do not invent vitals, labs, or history.
- Hypothesis ontology: your top-3 labels MUST be comparable (same abstraction level). Prefer three competing etiology/syndrome candidates rather than mixing "disease X" with a vague non-competing mechanism unless you explicitly justify it as a competing primary explanation.
- Avoid mega-buckets that hide disagreement (e.g. do not dump influenza + COVID + rhinovirus into one label unless the case truly cannot separate them — then say "undifferentiated acute viral URI syndrome" and keep other candidates distinct).
- Percentages are research weights, not diagnoses.

REQUIRED OUTPUT STRUCTURE (use these headings)
## Primary framing
1 short paragraph: syndrome/problem class + most salient discriminating facts.

## Top 3 candidate explanations
Exactly 3 candidates. For each:
1. **Short label** (≤8 words)
2. Fit — 2 bullets tied to case facts
3. Against — 1–2 bullets (what weakens it given THIS case)
4. Weight — integer percent
5. Why not ±15 points — one sentence defending the weight (what would justify 15 points higher or lower)

The three weights MUST sum to 100.

## Key risks / failure modes
2–3 bullets: how this framing could be wrong.

## Single best missing datum
One missing data point that would most stabilize your ranking (research framing, not a care order).

## Confidence
low / medium / high + one sentence why.

Write in clear English. Target 280–450 words.`;

const EXPERT_B_ROLE = `You are Expert B — Challenger / Red-Team in a multi-agent research panel (MAI-style).

MISSION
Do NOT rubber-stamp the obvious first-order story. For ANY case, attack weak assumptions and force at least one serious alternate ranking.

HARD RULES
- Research-only. No clinical orders, no definitive diagnosis language, no "seek care" presented as medical advice.
- Challenge the most popular / first-order explanation with concrete contradictions from the case (or from missing data that is being treated as if known).
- Prefer alternate framings that are still the same ontology level as competing primary explanations (comparable labels).
- Non-medical cases: challenge incentives, confounders, selection bias, alternate root causes, and missing constraints.
- If you include environmental/mechanism hypotheses, state whether they are primary competing explanations or modifiers of an infectious/process story — do not silently mix levels.

REQUIRED OUTPUT STRUCTURE
## Assumption audit
3 assumptions a hasty analyst might make; why each may be false in THIS case.

## Alternate framing (must differ from the obvious #1)
- Mechanism / story
- Supporting case facts
- What would falsify it

## Ranking pressure
2–4 bullets: what moves the top explanation down and a lower one up.

## Your provisional top 3 (with %)
Exactly 3 short comparable labels + integer percents summing to 100.
For each: one-line why this weight (not a pretty default split).

## Red-flag re-rank trigger
One concrete finding that, if present, would reorder your top-3 (research counterfactual, not a care instruction).

## Confidence
low / medium / high + why.

Write in clear English. Target 280–450 words. Be pointed, not rude.`;

const EXPERT_C_ROLE = `You are Expert C — Evidence Steward / Uncertainty Analyst in a multi-agent research panel (MAI-style).

MISSION
Separate evidence quality from narrative. Protect the panel from overconfidence and from non-specific signals treated as strong differentiators.

HARD RULES
- Research-only. No clinical orders or definitive claims.
- Distinguish: observed facts vs inferences vs unknowns.
- Call out weak differentiators (signals that feel strong but are non-specific in this domain).
- Prefer measurable missing information over vague "need more data".
- Top-3 labels must be comparable (same abstraction level). Do not invent labs/imaging not in the case.
- If another expert overweights a low-evidence hypothesis (e.g. serious lower-tract disease without supporting signs), say so with evidence language.

REQUIRED OUTPUT STRUCTURE
## Fact inventory
- Known (only facts stated)
- Inferred (reasonable but not proven)
- Unknown / not provided

## Evidence quality notes
For 2–3 tempting explanations: which signals are strong, weak, or non-specific in THIS case.

## Uncertainty budget
Where uncertainty is largest (data gaps, base rates, measurement quality, wording ambiguity, selection bias).

## Non-action research questions
Exactly 3 research questions that would most reduce ranking uncertainty (not care orders).

## Your provisional top 3 (with %)
3 comparable labels + integer percents summing to 100, driven by evidence quality not storytelling.
Each line: label — XX% — one-line evidence basis.

## Confidence
low / medium / high + why.

Write in clear English. Target 280–450 words.`;

const JUDGE_ROLE = `You are the Judge / Consensus agent for a multi-agent research panel (MAI-style).

MISSION
Read the user case and all expert handoffs. Produce a calibrated final consensus with EXACTLY 3 ranked results and percentages. Domain-agnostic (medical vignette, technical incident, product failure, etc.).

HARD RULES
- Research-only. Not medical advice. Not a diagnosis. Not patient care. Not legal counsel.
- Exactly 3 results. Integer percents. They MUST sum to 100.
- Labels: short (≤10 words), concrete, and COMPARABLE (same abstraction level). Do not mix a disease/syndrome candidate with a non-competing "modifier" unless you explicitly treat it as a primary competing explanation.
- Avoid mega-buckets: do not collapse multiple distinct leading candidates into one vague super-label unless truly inseparable — if inseparable, label the syndrome clearly and keep other competitors distinct.
- Synthesize A/B/C: agreements, contradictions, and how you resolved overweight claims (especially if one expert overweighted a low-support hypothesis such as pneumonia without hypoxia/dyspnea).
- Defend weights: for each result, explain why this percent rather than ~15 points higher.
- Prefer calibrated uncertainty over false precision. If the case is sparse, say so and keep confidence lower.
- Do not invent facts not in the case or handoffs.
- CALIBRATION (respiratory viral vignettes): When the case states elevated community influenza activity AND classic ILI features (fever + myalgias/chills + dry cough), do NOT rank COVID-like above influenza-like solely because a COVID booster is old. Influenza-compatible ILI should usually lead or tie closely; COVID remains a strong #2/#3 rival without a positive contact/test. Cabin-air irritation is a modifier, not a top-3 primary etiology when systemic fever is present.
- ALWAYS end with RANKINGS_JSON (valid JSON). If you forget prose structure, still emit RANKINGS_JSON.

REQUIRED OUTPUT FORMAT (strict)

## Consensus summary
2–4 sentences: panel synthesis + main residual uncertainty.

## Top 3 results
1. **Label** — XX%
   Rationale (1–2 sentences tied to case facts).
   Why not higher: one sentence (what would justify +~15 points).
2. **Label** — XX%
   Rationale...
   Why not higher: ...
3. **Label** — XX%
   Rationale...
   Why not higher: ...

## Expert agreement & contradictions
Bullets on where A/B/C aligned or diverged, and how you adjudicated.

## Red-flag re-rank trigger
One concrete counterfactual finding that would reorder the top-3 (research framing only).

## Residual uncertainty
What remains unknown and why confidence is limited (include measurement quality if relevant).

## Research next questions
Exactly 3 non-action research questions (not clinical/legal orders). Prefer questions that would most move the percentage weights.

## Confidence
low / medium / high

Then end with this machine block EXACTLY (valid JSON, no trailing comments):

RANKINGS_JSON:
{"rankings":[{"label":"Short label 1","percent":48,"rationale":"one sentence on fit","why_not_higher":"one sentence"},{"label":"Short label 2","percent":32,"rationale":"one sentence","why_not_higher":"one sentence"},{"label":"Short label 3","percent":20,"rationale":"one sentence","why_not_higher":"one sentence"}],"red_flag":"One concrete counterfactual that would reorder top-3"}

The three percent values MUST be integers that sum to 100 and match the Top 3 section. Labels in JSON must match the Top 3 labels.`;

export function defaultMaiExperts(
  model: string,
  perExpert?: Partial<Record<"Expert A" | "Expert B" | "Expert C", string>>
): MaiPanelRole[] {
  return [
    {
      name: "Expert A",
      model: perExpert?.["Expert A"] || model,
      role: EXPERT_A_ROLE,
    },
    {
      name: "Expert B",
      model: perExpert?.["Expert B"] || model,
      role: EXPERT_B_ROLE,
    },
    {
      name: "Expert C",
      model: perExpert?.["Expert C"] || model,
      role: EXPERT_C_ROLE,
    },
  ];
}

function makeProvider(opts: {
  offline: boolean;
  apiKey: string;
  baseUrl: string;
  model: string;
}) {
  if (opts.offline || !opts.apiKey) {
    return new EchoProvider({ model: `echo-${opts.model}` });
  }
  return new OpenAIProvider({
    model: opts.model,
    apiKey: opts.apiKey,
    baseUrl: opts.baseUrl,
    timeout: 90_000,
  });
}

async function withRetry<T>(
  fn: () => Promise<T>,
  attempts = 2
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      // Retry transient provider errors once
      if (!/HTTP 429|HTTP 5\d\d|timed out|ECONNRESET|fetch failed/i.test(msg)) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw lastErr;
}

async function emit(
  onEvent: MaiPanelRunInput["onEvent"],
  event: MaiPanelEvent
) {
  if (!onEvent) return;
  await onEvent(event);
}

export async function runMaiStylePanel(
  input: MaiPanelRunInput
): Promise<MaiPanelRunResult> {
  const started = Date.now();
  const onEvent = input.onEvent;

  const task =
    input.task?.trim() ||
    "Research-only case: analyze the user vignette with a 3-expert panel. Return exactly 3 comparable hypotheses with integer percents summing to 100, weight defense, red-flag re-rank trigger, and non-action research questions. Not a diagnosis.";

  const providerId: StudioProviderId =
    input.providerId === "groq" ? "groq" : "nvidia";

  const apiKey =
    input.apiKey ||
    (providerId === "groq"
      ? process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY || ""
      : process.env.NVIDIA_API_KEY || process.env.OPENAI_API_KEY || "");

  const baseUrl = (
    input.baseUrl ||
    (providerId === "groq"
      ? process.env.GROQ_BASE_URL || GROQ_BASE_URL
      : process.env.NVIDIA_BASE_URL || DEFAULT_NVIDIA_BASE)
  ).replace(/\/+$/, "");

  const defaultModel =
    input.model ||
    (providerId === "groq"
      ? process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL
      : process.env.NVIDIA_MODEL || DEFAULT_NVIDIA_MODEL);

  const offline = Boolean(input.offline) || !apiKey;
  const temperature = input.temperature ?? 0.4;
  const maxTokens = input.maxTokens ?? 1200;
  const judgeMaxTokens = Math.max(maxTokens, 1600);

  const panelDefaults =
    providerId === "groq" ? DEFAULT_GROQ_PANEL_MODELS : NIM_PANEL_DEFAULTS;

  const experts = input.experts?.length
    ? input.experts
    : defaultMaiExperts(defaultModel, {
        "Expert A": panelDefaults["Expert A"],
        "Expert B": panelDefaults["Expert B"],
        "Expert C": panelDefaults["Expert C"],
      });
  const judgeModel =
    input.judgeModel || panelDefaults.Judge || defaultModel;
  const protocol = new HandoffProtocol({ mode: "hybrid_state" });
  const mode = offline
    ? ("offline-echo" as const)
    : providerId === "groq"
      ? ("groq" as const)
      : ("nvidia" as const);
  const providerLabel = offline
    ? "EchoProvider"
    : providerId === "groq"
      ? "Groq (OpenAI-compatible)"
      : "NVIDIA NIM (OpenAI-compatible)";

  await emit(onEvent, {
    type: "run_start",
    mode,
    task,
    provider: providerLabel,
    model: defaultModel,
    experts: experts.map((e) => ({
      name: e.name,
      model: e.model || defaultModel,
    })),
  });

  await emit(onEvent, {
    type: "node_start",
    nodeId: "user",
    label: "User Query",
  });

  const expertResults: MaiExpertResult[] = [];
  const handoffStates: HandoffState[] = [];
  const usageLines: TokenUsage[] = [];
  const timeline: MaiPanelRunResult["timeline"] = [
    {
      id: "user",
      label: "User",
      kind: "user",
      detail: "Task received for MAI-style panel",
    },
  ];

  const expertAgents = experts.map(
    (ex) =>
      new Agent({
        name: ex.name,
        role: ex.role,
        provider: makeProvider({
          offline,
          apiKey,
          baseUrl,
          model: ex.model || defaultModel,
        }),
        metadata: { panelRole: ex.name },
      })
  );

  // Mark all experts as running, then complete as each finishes (parallel).
  for (const ex of experts) {
    await emit(onEvent, {
      type: "node_start",
      nodeId: ex.name,
      label: ex.name,
    });
  }

  const expertRuns = await Promise.all(
    expertAgents.map(async (agent, idx) => {
      const ex = experts[idx];
      try {
        const result = await withRetry(() =>
          agent.arun(task, {
            context: `Safety: ${SAFETY_NOTE}\nFollow your role structure exactly. Be specific to THIS case (do not invent a different case). Aim for complete structured output.`,
            temperature,
            max_tokens: maxTokens,
          })
        );
        const usage = readUsage(
          agent.provider,
          ex.model || defaultModel,
          offline ? "echo" : providerId
        );
        if (usage) usageLines.push(usage);
        const packed = {
          name: ex.name,
          model: ex.model || defaultModel,
          role: ex.role,
          output: String(result.finalOutput || "").trim(),
          success: result.success !== false && !!String(result.finalOutput || "").trim(),
          usage,
          agent,
        };
        await emit(onEvent, {
          type: "expert_done",
          expert: {
            name: packed.name,
            model: packed.model,
            role: packed.role,
            output: packed.output,
            success: packed.success,
            usage: packed.usage,
          },
          index: idx,
          total: experts.length,
        });
        return packed;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const packed = {
          name: ex.name,
          model: ex.model || defaultModel,
          role: ex.role,
          output: `ERROR: ${message}`,
          success: false,
          usage: undefined as TokenUsage | undefined,
          agent,
        };
        await emit(onEvent, {
          type: "expert_done",
          expert: {
            name: packed.name,
            model: packed.model,
            role: packed.role,
            output: packed.output,
            success: false,
          },
          index: idx,
          total: experts.length,
        });
        return packed;
      }
    })
  );

  for (const run of expertRuns) {
    expertResults.push({
      name: run.name,
      model: run.model,
      role: run.role,
      output: run.output,
      success: run.success,
      usage: run.usage,
    });
    timeline.push({
      id: `expert-${run.name}`,
      label: run.name,
      kind: "expert",
      model: run.model,
      detail: run.success
        ? "Panel assessment complete"
        : "Expert step failed",
    });
  }

  const judgeAgent = new Agent({
    name: "Judge",
    role: JUDGE_ROLE,
    provider: makeProvider({
      offline,
      apiKey,
      baseUrl,
      model: judgeModel,
    }),
  });

  for (const run of expertRuns) {
    const handoff = protocol.transfer({
      fromAgent: run.name,
      toAgent: "Judge",
      task,
      summary: run.output.slice(0, 2000),
      decisions: [
        `${run.name} contributed a panel assessment.`,
        `model=${run.model}`,
      ],
      nextSteps: [
        "Judge synthesizes consensus from structured expert handoffs.",
      ],
      metadata: {
        expert: run.name,
        model: run.model,
        success: run.success,
      },
    });
    handoffStates.push(handoff);
    await emit(onEvent, { type: "handoff", handoff: handoff.toJSON() });
  }

  await emit(onEvent, {
    type: "node_start",
    nodeId: "judge",
    label: "Judge / Consensus",
  });
  await emit(onEvent, { type: "judge_start", model: judgeModel });

  const panelContext = expertResults
    .map((e) => `### ${e.name} (${e.model})\n${e.output}`)
    .join("\n\n");

  let judgeOutput = "";
  try {
    const provider = judgeAgent.provider as {
      agenerate?: (
        p: string,
        k?: Record<string, unknown>
      ) => Promise<string>;
      generate?: (p: string, k?: Record<string, unknown>) => string;
    };
    const prompt = `${judgeAgent.role}\n\n## User case\n${task}\n\n## Expert panel handoffs\n${panelContext}\n\n## Safety\n${SAFETY_NOTE}\n\nCRITICAL: End with RANKINGS_JSON (3 labels, integer percents sum to 100). Match Top 3 section.`;
    if (provider.agenerate) {
      judgeOutput = await withRetry(() =>
        provider.agenerate!(prompt, {
          temperature: Math.min(temperature, 0.3),
          max_tokens: judgeMaxTokens,
        })
      );
    } else if (provider.generate) {
      judgeOutput = provider.generate(prompt);
    }
  } catch (err) {
    judgeOutput = `ERROR: ${err instanceof Error ? err.message : String(err)}`;
  }

  // Normalize / inject RANKINGS_JSON so UI cards always work when possible
  const finalized = ensureJudgeAnswer(judgeOutput);
  judgeOutput = finalized.text;

  const judgeUsage = readUsage(
    judgeAgent.provider,
    judgeModel,
    offline ? "echo" : providerId
  );
  if (judgeUsage) usageLines.push(judgeUsage);

  const judge = {
    name: "Judge / Consensus",
    model: judgeModel,
    output: judgeOutput,
    usage: judgeUsage,
  };

  await emit(onEvent, {
    type: "judge_done",
    judge,
    finalAnswer: judgeOutput,
  });

  timeline.push({
    id: "judge",
    label: "Judge",
    kind: "judge",
    model: judgeModel,
    detail: "Consensus synthesis from expert handoffs",
  });
  timeline.push({
    id: "complete",
    label: "Complete",
    kind: "complete",
    detail: "MAI-style panel run finished",
  });

  await emit(onEvent, {
    type: "node_start",
    nodeId: "final",
    label: "Final Answer",
  });

  const stepResults = [
    ...expertResults.map((e) => ({
      agentName: e.name,
      task,
      finalOutput: e.output,
      success: e.success,
      provider: offline ? "EchoProvider" : providerLabel,
      model: e.model,
    })),
    {
      agentName: "Judge",
      task,
      finalOutput: judgeOutput,
      success: !judgeOutput.startsWith("ERROR:"),
      provider: offline ? "EchoProvider" : providerLabel,
      model: judgeModel,
    },
  ];

  const fakeTeamResult = {
    success: stepResults.every((s) => s.success),
    task,
    finalOutput: judgeOutput,
    stepResults: stepResults.map((s) => ({
      agentName: s.agentName,
      task: s.task,
      finalOutput: s.finalOutput,
      success: s.success,
      provider: s.provider,
      model: s.model,
      toJSON() {
        return {
          agent_name: s.agentName,
          task: s.task,
          final_output: s.finalOutput,
          success: s.success,
          provider: s.provider,
          model: s.model,
        };
      },
    })),
    handoffs: handoffStates,
    metadata: {
      demo: "mai-style-panel",
      mode,
    },
  };

  let traceJson: Record<string, unknown> = {};
  try {
    const trace = RunTrace.fromTeamResult(fakeTeamResult as never, {
      name: "mai-style-panel",
    });
    traceJson = trace.toJSON() as Record<string, unknown>;
  } catch {
    traceJson = {
      name: "mai-style-panel",
      task,
      final_output: judgeOutput,
      handoffs: handoffStates.map((h) => h.toJSON()),
    };
  }

  // Treat the run as successful when the Judge produced a real synthesis.
  // Partial expert failures still show in the report, but do not mark the
  // whole panel "incomplete" if consensus text is present.
  const judgeOk =
    !judgeOutput.startsWith("ERROR:") && judgeOutput.trim().length >= 80;
  const expertsOk = expertResults.filter((e) => e.success).length;
  const usageTotals = usageLines.reduce(
    (acc, u) => {
      acc.promptTokens += u.promptTokens;
      acc.completionTokens += u.completionTokens;
      acc.totalTokens += u.totalTokens;
      acc.costUsd += u.costUsd;
      return acc;
    },
    { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 }
  );

  const result: MaiPanelRunResult = {
    success: judgeOk && expertsOk >= 1,
    mode,
    providerId: offline ? "echo" : providerId,
    task,
    provider: providerLabel,
    baseUrl: offline ? "local-echo" : baseUrl,
    experts: expertResults,
    judge,
    finalAnswer: judgeOutput,
    handoffs: handoffStates.map((h) => h.toJSON()),
    timeline,
    trace: traceJson,
    safetyNote: SAFETY_NOTE,
    durationMs: Date.now() - started,
    usage: {
      ...usageTotals,
      currency: "USD",
      note:
        providerId === "groq" && !offline
          ? "Measured tokens from Groq usage; cost from public groq.com/pricing rates."
          : offline
            ? "Echo offline · no billable tokens."
            : "NVIDIA NIM free trial path · measured tokens when provided; cost $0 for trial endpoints.",
    },
  };

  await emit(onEvent, { type: "run_complete", result });
  return result;
}
