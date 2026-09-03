import {
  Agent,
  HandoffProtocol,
  HandoffState,
} from "@handoffkit/core";

function jsonValue(value) {
  return value?.toJSON?.() ?? value;
}

function agentToJSON(agent) {
  if (!agent) return null;
  return {
    name: agent.name,
    role: agent.role ?? "",
    provider: agent.provider?.constructor?.name ?? "",
    model: agent.provider?.model ?? "",
  };
}

export class RecipeStep {
  constructor({
    name,
    task,
    agent = null,
    useContext = false,
    metadata = {},
  } = {}) {
    if (!name) throw new TypeError("RecipeStep name is required.");
    if (!task) throw new TypeError("RecipeStep task is required.");
    this.name = String(name);
    this.task = String(task);
    this.agent = agent;
    this.useContext = Boolean(useContext);
    this.metadata = metadata ? { ...metadata } : {};
  }

  toJSON() {
    return {
      name: this.name,
      task: this.task,
      agent: agentToJSON(this.agent),
      use_context: this.useContext,
      metadata: { ...this.metadata },
    };
  }
}

export class Recipe {
  constructor({ name, description = "", steps = [], metadata = {} } = {}) {
    this.name = String(name || "");
    this.description = String(description || "");
    this.steps = (Array.isArray(steps) ? steps : []).map((step) =>
      step instanceof RecipeStep ? step : new RecipeStep(step),
    );
    this.metadata = metadata ? { ...metadata } : {};
  }

  validate() {
    const problems = [];
    if (!this.name.trim()) problems.push("name must be a non-empty string");
    if (this.steps.length === 0) problems.push("steps must not be empty");
    const seen = new Set();
    const duplicates = new Set();
    for (const step of this.steps) {
      if (!step.name.trim()) problems.push("step name must be a non-empty string");
      if (!step.task.trim()) problems.push(`step ${step.name} task must be a non-empty string`);
      if (seen.has(step.name)) duplicates.add(step.name);
      seen.add(step.name);
    }
    if (duplicates.size) {
      problems.push(`step names must be unique: ${[...duplicates].sort().join(", ")}`);
    }
    if (problems.length) throw new TypeError(problems.join("; "));
    return this;
  }

  toJSON() {
    return {
      name: this.name,
      description: this.description,
      steps: this.steps.map((step) => step.toJSON()),
      metadata: { ...this.metadata },
    };
  }

  toJSONString(space = 2) {
    return JSON.stringify(this.toJSON(), null, space);
  }

  toMarkdown() {
    const steps = this.steps
      .map((step) => `- \`${step.name}\`: ${step.task} (agent=${step.agent?.name ?? "none"})`)
      .join("\n") || "- none";
    return [
      `# Recipe: ${this.name}`,
      "",
      "## Description",
      "",
      this.description || "-",
      "",
      "## Steps",
      "",
      steps,
    ].join("\n");
  }
}

export class RecipeRunResult {
  constructor({
    recipeName,
    success = true,
    finalOutput = "",
    stepResults = [],
    handoffStates = [],
    metadata = {},
  } = {}) {
    this.recipeName = recipeName || "";
    this.success = Boolean(success);
    this.finalOutput = finalOutput || "";
    this.stepResults = Array.isArray(stepResults) ? [...stepResults] : [];
    this.handoffStates = Array.isArray(handoffStates) ? [...handoffStates] : [];
    this.metadata = metadata ? { ...metadata } : {};
  }

  toJSON() {
    return {
      recipe_name: this.recipeName,
      success: this.success,
      final_output: this.finalOutput,
      step_results: this.stepResults.map(jsonValue),
      handoff_states: this.handoffStates.map(jsonValue),
      metadata: { ...this.metadata },
    };
  }

  toJSONString(space = 2) {
    return JSON.stringify(this.toJSON(), null, space);
  }

  toMarkdown() {
    const steps = this.stepResults
      .map((step) => `- \`${step.step_name}\` success=${step.success} agent=${step.agent_name}`)
      .join("\n") || "- none";
    const handoffs = this.handoffStates
      .map((state) => `- \`${state.fromAgent}\` -> \`${state.toAgent}\`: ${state.task}`)
      .join("\n") || "- none";
    return [
      `# Recipe Run: ${this.recipeName}`,
      "",
      `Success: ${this.success}`,
      "",
      "## Final Output",
      "",
      this.finalOutput || "-",
      "",
      "## Step Results",
      "",
      steps,
      "",
      "## Handoffs",
      "",
      handoffs,
    ].join("\n");
  }
}

export class RecipeRunner {
  constructor(recipe, { protocol = new HandoffProtocol({ mode: "hybrid_state" }), runtimeMode = "classic", runtime = null } = {}) {
    this.recipe = (recipe instanceof Recipe ? recipe : new Recipe(recipe)).validate();
    this.protocol = protocol;
    this.runtimeMode = runtimeMode;
    this.runtime = runtime;
  }

  run(initialTask = "") {
    if (this.runtimeMode !== "classic") {
      throw new Error("RecipeRunner.run() only supports classic mode in JavaScript; use arun() for CSP modes.");
    }
    const stepResults = [];
    const handoffStates = [];
    let previousOutput = "";
    let success = true;

    for (let index = 0; index < this.recipe.steps.length; index += 1) {
      const step = this.recipe.steps[index];
      const agent = step.agent || new Agent({ name: step.name, role: `Execute ${step.name}.` });
      const task = buildStepTask(step, initialTask, previousOutput, index);
      let result;
      try {
        result = agent.run(task, { context: step.useContext ? previousOutput : null });
      } catch (error) {
        result = {
          agentName: agent.name,
          task,
          finalOutput: error instanceof Error ? error.message : String(error),
          success: false,
          toJSON() {
            return {
              agent_name: this.agentName,
              task: this.task,
              final_output: this.finalOutput,
              success: this.success,
            };
          },
        };
      }

      success = success && result.success;
      stepResults.push({
        step_name: step.name,
        agent_name: agent.name,
        task,
        output: result.finalOutput,
        success: result.success,
        metadata: { ...step.metadata },
      });

      const nextStep = this.recipe.steps[index + 1];
      if (nextStep) {
        const nextAgent = nextStep.agent || new Agent({ name: nextStep.name });
        handoffStates.push(this.protocol.transfer({
          fromAgent: agent,
          toAgent: nextAgent,
          task: nextStep.task,
          summary: result.finalOutput,
          decisions: [`Step ${step.name} completed with success=${result.success}.`],
          nextSteps: [nextStep.task],
          metadata: {
            recipe: this.recipe.name,
            fromStep: step.name,
            toStep: nextStep.name,
          },
        }));
      }

      previousOutput = result.finalOutput;
    }

    return new RecipeRunResult({
      recipeName: this.recipe.name,
      success,
      finalOutput: stepResults.at(-1)?.output ?? "",
      stepResults,
      handoffStates,
      metadata: { step_count: this.recipe.steps.length },
    });
  }

  async arun(initialTask = "") {
    const stepResults = [];
    const handoffStates = [];
    let previousOutput = "";
    let success = true;
    let session = null;
    if (this.runtimeMode !== "classic") {
      if (!this.runtime?.createSession || !this.runtime?.makeEnvelope) {
        throw new TypeError("CSP mode requires a CspRuntime from @handoffkit/csp.");
      }
      session = this.runtime.createSession();
      session.channel("recipe-handoffs");
    }

    for (let index = 0; index < this.recipe.steps.length; index += 1) {
      const step = this.recipe.steps[index];
      const agent = step.agent || new Agent({ name: step.name, role: `Execute ${step.name}.` });
      const task = buildStepTask(step, initialTask, previousOutput, index);
      let result;
      try {
        result = await agent.arun(task, { context: step.useContext ? previousOutput : null });
      } catch (error) {
        result = {
          agentName: agent.name,
          task,
          finalOutput: error instanceof Error ? error.message : String(error),
          success: false,
          toJSON() {
            return {
              agent_name: this.agentName,
              task: this.task,
              final_output: this.finalOutput,
              success: this.success,
            };
          },
        };
      }

      success = success && result.success;
      stepResults.push({
        step_name: step.name,
        agent_name: agent.name,
        task,
        output: result.finalOutput,
        success: result.success,
        metadata: { ...step.metadata },
      });

      const nextStep = this.recipe.steps[index + 1];
      if (nextStep) {
        const nextAgent = nextStep.agent || new Agent({ name: nextStep.name });
        const handoff = this.protocol.transfer({
          fromAgent: agent,
          toAgent: nextAgent,
          task: nextStep.task,
          summary: result.finalOutput,
          decisions: [`Step ${step.name} completed with success=${result.success}.`],
          nextSteps: [nextStep.task],
          metadata: {
            recipe: this.recipe.name,
            fromStep: step.name,
            toStep: nextStep.name,
          },
        });
        handoffStates.push(handoff);
        if (session) {
          const envelope = this.runtime.makeEnvelope({
            sessionId: session.sessionId,
            channel: "recipe-handoffs",
            source: agent.name,
            target: nextAgent.name,
            sequence: index,
            payloadType: "handoff_state",
            payload: handoff.toJSON(),
            idempotencyKey: `${session.sessionId}:recipe:${index}`,
          });
          await session.send("recipe-handoffs", envelope);
          const received = await session.receive("recipe-handoffs");
          session.ack(received, { step: nextStep.name });
          previousOutput = received.payload.summary ?? result.finalOutput;
        }
      }

      if (!session || !nextStep) previousOutput = result.finalOutput;
    }

    if (session) await session.close();

    return new RecipeRunResult({
      recipeName: this.recipe.name,
      success,
      finalOutput: stepResults.at(-1)?.output ?? "",
      stepResults,
      handoffStates,
      metadata: { step_count: this.recipe.steps.length, runtime_mode: this.runtimeMode },
    });
  }
}

export class WorkflowTemplate {
  static sequential({ name, agents, task, description = "Sequential multi-agent workflow." } = {}) {
    const list = Array.isArray(agents) ? agents : [];
    return new Recipe({
      name,
      description,
      steps: list.map((agent, index) => new RecipeStep({
        name: agent.name.toLowerCase().replace(/\s+/g, "-"),
        agent,
        task: index === 0 ? task : `Continue workflow for: ${task}`,
        useContext: index > 0,
      })),
    });
  }

  static planExecuteReview({ name, task, planner, executor, reviewer } = {}) {
    return new Recipe({
      name,
      description: "Plan, execute, and review a task.",
      steps: [
        new RecipeStep({ name: "plan", agent: planner, task: `Create a plan for: ${task}` }),
        new RecipeStep({ name: "execute", agent: executor, task: `Execute the plan for: ${task}`, useContext: true }),
        new RecipeStep({ name: "review", agent: reviewer, task: `Review the result for: ${task}`, useContext: true }),
      ],
    });
  }
}

export function planExecuteReviewRecipe(task = "Prepare a local release checklist.") {
  return WorkflowTemplate.planExecuteReview({
    name: "plan-execute-review",
    task,
    planner: new Agent({ name: "Planner", role: "Create concise implementation plans." }),
    executor: new Agent({ name: "Executor", role: "Carry out the plan using structured state." }),
    reviewer: new Agent({ name: "Reviewer", role: "Review output and list next steps." }),
  });
}

function buildStepTask(step, initialTask, previousOutput, index) {
  const parts = [];
  if (index === 0 && initialTask) parts.push(`Initial task: ${initialTask}`);
  if (previousOutput) parts.push(`Previous output: ${previousOutput}`);
  parts.push(`Step task: ${step.task}`);
  return parts.join("\n\n");
}

// ==========================================
// Model Fusion
// ==========================================

export const SAFETY_NOTE = "Research-only orchestration demo. Not medical advice, not clinical validation, and not for patient care.";
export const DEFAULT_FUSION_TASK = "Design a next-pass strategy for a research-only clinical benchmark that scored 233/400 with MiMo. Improve reliability without using gold labels or making clinical claims.";
export const DEFAULT_FUSION_MODELS = "mimo-v2.5,deepseek-v4-pro,glm-5.2,qwen3.7-max";

export class PanelResponse {
  constructor({ model, role, answer, strengths = [], risks = [], confidence = "medium" } = {}) {
    this.model = model;
    this.role = role;
    this.answer = answer;
    this.strengths = Array.isArray(strengths) ? strengths : [];
    this.risks = Array.isArray(risks) ? risks : [];
    this.confidence = confidence;
  }

  toDict() {
    return {
      model: this.model,
      role: this.role,
      answer: this.answer,
      strengths: this.strengths,
      risks: this.risks,
      confidence: this.confidence,
    };
  }

  toJSON() {
    return this.toDict();
  }
}

export class FusionReport {
  constructor({ success, task, mode, panel, consensus, contradictions, coverageGaps, uniqueInsights, blindSpots, finalAnswer, safetyNote = SAFETY_NOTE } = {}) {
    this.success = Boolean(success);
    this.task = task;
    this.mode = mode;
    this.panel = (Array.isArray(panel) ? panel : []).map(item => item instanceof PanelResponse ? item : new PanelResponse(item));
    this.consensus = Array.isArray(consensus) ? [...consensus] : [];
    this.contradictions = Array.isArray(contradictions) ? [...contradictions] : [];
    this.coverageGaps = Array.isArray(coverageGaps) ? [...coverageGaps] : [];
    this.uniqueInsights = Array.isArray(uniqueInsights) ? [...uniqueInsights] : [];
    this.blindSpots = Array.isArray(blindSpots) ? [...blindSpots] : [];
    this.finalAnswer = finalAnswer;
    this.safetyNote = safetyNote;
  }

  toDict() {
    return {
      success: this.success,
      task: this.task,
      mode: this.mode,
      safety_note: this.safetyNote,
      panel: this.panel.map(item => item.toDict()),
      analysis: {
        consensus: this.consensus,
        contradictions: this.contradictions,
        coverage_gaps: this.coverageGaps,
        unique_insights: this.uniqueInsights,
        blind_spots: this.blindSpots,
      },
      final_answer: this.finalAnswer,
    };
  }

  toJSON() {
    return this.toDict();
  }

  toMarkdown() {
    const rows = this.panel
      .map(item => `| ${item.model} | ${item.role} | ${item.confidence} | ${item.answer} |`)
      .join("\n");
    return [
      "# Fusion-style Panel Demo",
      "",
      `> ${this.safetyNote}`,
      "",
      "## Task",
      "",
      this.task,
      "",
      "## Panel",
      "",
      "| Model | Role | Confidence | Answer |",
      "|---|---|---|---|",
      rows,
      "",
      "## Judge Analysis",
      "",
      "### Consensus",
      this._bulletList(this.consensus),
      "",
      "### Contradictions",
      this._bulletList(this.contradictions),
      "",
      "### Coverage Gaps",
      this._bulletList(this.coverageGaps),
      "",
      "### Unique Insights",
      this._bulletList(this.uniqueInsights),
      "",
      "### Blind Spots",
      this._bulletList(this.blindSpots),
      "",
      "## Final Answer",
      "",
      this.finalAnswer,
    ].join("\n") + "\n";
  }

  _bulletList(items) {
    if (!items || !items.length) return "- none";
    return items.map(item => `- ${item}`).join("\n");
  }
}

export function splitModels(value) {
  if (!value) return [];
  return value.split(",").map(item => item.trim()).filter(Boolean);
}

export function offlineFusionPanel(task = DEFAULT_FUSION_TASK) {
  return [
    new PanelResponse({
      model: "mimo-v2.5/offline",
      role: "broad diagnostician",
      answer: "Use a domain router before expensive reasoning: pathology, infection, endocrine/electrolyte, neuro, drug reaction, and rare syndrome.",
      strengths: ["broad recall", "cheap first pass", "good label variety"],
      risks: ["may overfit to plausible broad diagnoses"],
      confidence: "medium",
    }),
    new PanelResponse({
      model: "deepseek-v4-pro/offline",
      role: "mechanism checker",
      answer: "Require every final label to cite case evidence and a competing diagnosis it ruled out. Penalize answers without mechanism.",
      strengths: ["mechanistic reasoning", "contradiction spotting"],
      risks: ["can be slow or verbose"],
      confidence: "medium-high",
    }),
    new PanelResponse({
      model: "glm-5.2/offline",
      role: "adversarial reviewer",
      answer: "Run rescue only on low-confidence or disagreement cases. Generic reruns waste budget and did not move the score enough.",
      strengths: ["skeptical review", "cost control"],
      risks: ["may reject useful rare-disease guesses"],
      confidence: "high",
    }),
    new PanelResponse({
      model: "qwen3.7-max/offline",
      role: "retrieval planner",
      answer: "Generate 3-5 retrieval queries per case, then build a compact evidence packet before the panel votes.",
      strengths: ["query planning", "structured extraction"],
      risks: ["retrieval quality can dominate outcome"],
      confidence: "medium-high",
    }),
  ];
}

export function judgeFusionPanel(task, panel, { mode } = {}) {
  const successful = panel.filter(item => item.confidence !== "failed");
  const consensus = [
    "Use multiple specialist perspectives instead of one generic rerun.",
    "Run retrieval before final voting, not only inside the final prompt.",
    "Reserve rescue for failed, low-confidence, or disagreement cases.",
  ];
  const contradictions = [
    "Breadth-first diagnosis can increase recall but also broad false positives.",
    "Mechanism-heavy review improves precision but may miss rare presentations.",
  ];
  const coverageGaps = [
    "Need per-domain error taxonomy before claiming improvement.",
    "Need clean infra metrics separated from clinical misses.",
  ];
  const uniqueInsights = successful.slice(0, 4).map(item => `${item.model}: ${item.answer.substring(0, 160)}`);
  const blindSpots = [
    "No benchmark score should be marketed as clinical capability.",
    "Fusion can improve consistency, but it can also amplify shared false assumptions.",
  ];
  const finalAnswer = "Build HandoffKit Fusion as a research orchestrator: evidence planner -> parallel model panel -> contradiction judge -> targeted rescue -> final label normalizer. Track accuracy, clean accuracy, rescue gain, harmful rescue rate, and infra failures separately. Start offline/deterministic; enable real providers only with --real and cached shards.";
  
  return new FusionReport({
    success: successful.length > 0,
    task,
    mode,
    panel,
    consensus,
    contradictions,
    coverageGaps,
    uniqueInsights,
    blindSpots,
    finalAnswer,
  });
}

export async function runModelFusionPanel({
  task = DEFAULT_FUSION_TASK,
  provider = "opencode-go",
  models = DEFAULT_FUSION_MODELS,
  real = false,
  timeout = 300,
  fetchImpl = undefined,
  signal = undefined,
  maxParallel = 4,
} = {}) {
  const panel = real
    ? await realFusionPanel(provider, splitModels(models), task, { timeout, fetchImpl, signal, maxParallel })
    : offlineFusionPanel(task);
  const mode = real ? "real-provider-panel" : "offline-deterministic-panel";
  return judgeFusionPanel(task, panel, { mode });
}

export async function realFusionPanel(
  provider,
  models,
  task = DEFAULT_FUSION_TASK,
  { timeout = 300, fetchImpl = undefined, signal = undefined, maxParallel = 4 } = {},
) {
  let providersModule;
  try {
    providersModule = await import("@handoffkit/providers");
  } catch (cause) {
    throw new Error("The '@handoffkit/providers' package is required to run a real fusion panel. Install it first.", { cause });
  }
  const { createProvider } = providersModule;
  if (typeof createProvider !== "function") {
    throw new TypeError("@handoffkit/providers does not expose createProvider().");
  }

  const modelList = (Array.isArray(models) ? models : splitModels(models))
    .map(String)
    .map((item) => item.trim())
    .filter(Boolean);
  if (modelList.length === 0) throw new TypeError("realFusionPanel requires at least one model.");
  const providerId = normalizeFusionProviderId(provider);
  const timeoutValue = Number(timeout);
  const timeoutMs = Number.isFinite(timeoutValue) && timeoutValue > 0
    ? (timeoutValue <= 1000 ? timeoutValue * 1000 : timeoutValue)
    : 300000;
  const roles = [
    "broad diagnostician",
    "mechanism checker",
    "adversarial reviewer",
    "retrieval planner",
  ];

  return mapWithConcurrency(modelList, maxParallel, async (model, index) => {
    const role = roles[index % roles.length];
    try {
      const providerInstance = createProvider(providerId, { model, timeoutMs, fetchImpl });
      const response = await providerInstance.agenerate(_panelPrompt(task, role), {
        temperature: 0,
        signal,
      });
      return new PanelResponse({
        model: `${provider}/${model}`,
        role,
        answer: String(response || "").trim().replace(/\s+/g, " ").slice(0, 800),
        strengths: ["real provider response"],
        risks: ["cost, latency, and provider availability"],
        confidence: "model-reported",
      });
    } catch (error) {
      return new PanelResponse({
        model: `${provider}/${model}`,
        role,
        answer: `Provider failed safely: ${String(error?.message || error).replace(/\s+/g, " ").slice(0, 240)}`,
        strengths: [],
        risks: ["provider call failed"],
        confidence: "failed",
      });
    }
  });
}

function normalizeFusionProviderId(provider) {
  const value = String(provider || "").trim().toLowerCase();
  if (value === "opencode-go" || value === "opencode_go") return "opencode";
  return value || "opencode";
}

async function mapWithConcurrency(items, maxParallel, worker) {
  const limit = Math.max(1, Math.min(items.length, Math.floor(Number(maxParallel) || 1)));
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: limit }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

function _panelPrompt(task, role) {
  return [
    "You are one model in a Fusion-style HandoffKit panel.",
    `Role: ${role}`,
    "",
    "Task:",
    task,
    "",
    "Return a concise answer with:",
    "- recommended move",
    "- evidence required",
    "- risk or blind spot",
    "",
    "Safety: this is research-only. Do not provide patient-care advice.",
  ].join("\n");
}

// ==========================================
// Media Localization
// ==========================================

export class MediaAsset {
  constructor({ path, mediaType, language = "", durationSeconds = null, metadata = {} } = {}) {
    this.path = path;
    this.mediaType = mediaType;
    this.language = language;
    this.durationSeconds = durationSeconds;
    this.metadata = metadata || {};
  }

  toDict() {
    return {
      path: this.path,
      media_type: this.mediaType,
      language: this.language,
      duration_seconds: this.durationSeconds,
      metadata: this.metadata,
    };
  }

  static fromDict(data = {}) {
    return new MediaAsset({
      path: data.path || "",
      mediaType: data.media_type || data.mediaType || "",
      language: data.language || "",
      durationSeconds: data.duration_seconds || data.durationSeconds || null,
      metadata: data.metadata || {},
    });
  }
}

export class TranscriptSegment {
  constructor({ index, start, end, text, speaker = "", language = "", metadata = {} } = {}) {
    this.index = Number(index || 0);
    this.start = Number(start || 0);
    this.end = Number(end || 0);
    this.text = String(text || "");
    this.speaker = String(speaker || "");
    this.language = String(language || "");
    this.metadata = metadata || {};
  }

  toDict() {
    return {
      index: this.index,
      start: this.start,
      end: this.end,
      text: this.text,
      speaker: this.speaker,
      language: this.language,
      metadata: this.metadata,
    };
  }

  static fromDict(data = {}) {
    return new TranscriptSegment({
      index: data.index,
      start: data.start,
      end: data.end,
      text: data.text,
      speaker: data.speaker,
      language: data.language,
      metadata: data.metadata,
    });
  }
}

export class SpeakerProfile {
  constructor({ speakerId, label = "", voice = "", language = "", notes = [], metadata = {} } = {}) {
    this.speakerId = speakerId;
    this.label = label;
    this.voice = voice;
    this.language = language;
    this.notes = Array.isArray(notes) ? notes : [];
    this.metadata = metadata || {};
  }

  toDict() {
    return {
      speaker_id: this.speakerId,
      label: this.label,
      voice: this.voice,
      language: this.language,
      notes: this.notes,
      metadata: this.metadata,
    };
  }

  static fromDict(data = {}) {
    return new SpeakerProfile({
      speakerId: data.speaker_id || data.speakerId || "",
      label: data.label || "",
      voice: data.voice || "",
      language: data.language || "",
      notes: data.notes || [],
      metadata: data.metadata || {},
    });
  }
}

export class DubbingSegment {
  constructor({ index, start, end, speaker, sourceText, targetText, voice = "", audioPath = "", notes = [], metadata = {} } = {}) {
    this.index = Number(index || 0);
    this.start = Number(start || 0);
    this.end = Number(end || 0);
    this.speaker = speaker;
    this.sourceText = sourceText;
    this.targetText = targetText;
    this.voice = voice;
    this.audioPath = audioPath;
    this.notes = Array.isArray(notes) ? notes : [];
    this.metadata = metadata || {};
  }

  toDict() {
    return {
      index: this.index,
      start: this.start,
      end: this.end,
      speaker: this.speaker,
      source_text: this.sourceText,
      target_text: this.targetText,
      voice: this.voice,
      audio_path: this.audioPath,
      notes: this.notes,
      metadata: this.metadata,
    };
  }

  static fromDict(data = {}) {
    return new DubbingSegment({
      index: data.index,
      start: data.start,
      end: data.end,
      speaker: data.speaker,
      sourceText: data.source_text || data.sourceText || "",
      targetText: data.target_text || data.targetText || "",
      voice: data.voice || "",
      audioPath: data.audio_path || data.audioPath || "",
      notes: data.notes || [],
      metadata: data.metadata || {},
    });
  }
}

export class MediaWorkflowReport {
  constructor({ success, source, targetLanguage, transcriptSegments = [], speakers = [], dubbingSegments = [], outputFiles = [], warnings = [], metadata = {} } = {}) {
    this.success = Boolean(success);
    this.source = source instanceof MediaAsset ? source : MediaAsset.fromDict(source || {});
    this.targetLanguage = targetLanguage;
    this.transcriptSegments = (Array.isArray(transcriptSegments) ? transcriptSegments : []).map(item => item instanceof TranscriptSegment ? item : TranscriptSegment.fromDict(item));
    this.speakers = (Array.isArray(speakers) ? speakers : []).map(item => item instanceof SpeakerProfile ? item : SpeakerProfile.fromDict(item));
    this.dubbingSegments = (Array.isArray(dubbingSegments) ? dubbingSegments : []).map(item => item instanceof DubbingSegment ? item : DubbingSegment.fromDict(item));
    this.outputFiles = Array.isArray(outputFiles) ? outputFiles : [];
    this.warnings = Array.isArray(warnings) ? warnings : [];
    this.metadata = metadata || {};
  }

  toDict() {
    return {
      success: this.success,
      source: this.source.toDict(),
      target_language: this.targetLanguage,
      transcript_segments: this.transcriptSegments.map(item => item.toDict()),
      speakers: this.speakers.map(item => item.toDict()),
      dubbing_segments: this.dubbingSegments.map(item => item.toDict()),
      output_files: this.outputFiles,
      warnings: this.warnings,
      metadata: this.metadata,
    };
  }

  toJSON() {
    return this.toDict();
  }

  toMarkdown() {
    const lines = [
      "# Media Workflow Report",
      "",
      `- Success: \`${this.success}\``,
      `- Source: \`${this.source.path}\``,
      `- Target language: \`${this.targetLanguage}\``,
      `- Transcript segments: \`${this.transcriptSegments.length}\``,
      `- Speakers: \`${this.speakers.length}\``,
      `- Dubbing segments: \`${this.dubbingSegments.length}\``,
    ];
    if (this.outputFiles.length > 0) {
      lines.push("", "## Output Files", "");
      lines.push(...this.outputFiles.map(item => `- \`${item}\``));
    }
    if (this.speakers.length > 0) {
      lines.push("", "## Speakers", "");
      for (const speaker of this.speakers) {
        const label = speaker.label || speaker.speakerId;
        lines.push(`- \`${speaker.speakerId}\`: ${label} -> \`${speaker.voice}\``);
      }
    }
    if (this.dubbingSegments.length > 0) {
      lines.push("", "## Dubbing Plan", "");
      lines.push("| # | Time | Speaker | Target text |");
      lines.push("| ---: | --- | --- | --- |");
      for (const segment of this.dubbingSegments) {
        lines.push(
          `| ${segment.index} | ${_formatTimeRange(segment.start, segment.end)} | ` +
          `${segment.speaker} | ${segment.targetText} |`
        );
      }
    }
    if (this.warnings.length > 0) {
      lines.push("", "## Warnings", "");
      lines.push(...this.warnings.map(item => `- ${item}`));
    }
    return lines.join("\n") + "\n";
  }
}

export function buildDubbingPlan(segments, translations = {}, speakers = []) {
  const voiceBySpeaker = {};
  for (const item of speakers) {
    voiceBySpeaker[item.speakerId] = item.voice;
  }
  const dubbingSegments = [];
  for (const segment of segments) {
    const targetText = translations[segment.index] || segment.text;
    dubbingSegments.push(
      new DubbingSegment({
        index: segment.index,
        start: segment.start,
        end: segment.end,
        speaker: segment.speaker,
        sourceText: segment.text,
        targetText,
        voice: voiceBySpeaker[segment.speaker] || "",
        notes: ["preserve timing", "review lip-sync manually"],
      })
    );
  }
  return dubbingSegments;
}

function _cueDict(item) {
  if (item instanceof TranscriptSegment) {
    const md = item.metadata || {};
    return {
      index: item.index,
      start: item.start,
      end: item.end,
      text: item.text,
      text_ocr: String(md.text_ocr || ""),
      text_asr: String(md.text_asr || ""),
      speaker: item.speaker,
      language: item.language,
    };
  }
  const data = item || {};
  return {
    index: Number(data.index || 0),
    start: Number(data.start || 0),
    end: Number(data.end || 0),
    text: String(data.text || ""),
    text_ocr: String(data.text_ocr || data.textOcr || ""),
    text_asr: String(data.text_asr || data.textAsr || ""),
    speaker: String(data.speaker || ""),
    language: String(data.language || ""),
  };
}

function _overlap(a0, a1, b0, b1) {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

function _normZh(text) {
  return String(text || "").replace(/\s+/g, "");
}

function _covers(ocr, asr) {
  const o = _normZh(ocr);
  const a = _normZh(asr);
  if (!a) return true;
  if (!o) return false;
  if (a.includes(o) || o.includes(a)) return true;
  const sa = new Set(a);
  const so = new Set(o);
  let inter = 0;
  for (const ch of sa) if (so.has(ch)) inter += 1;
  return inter / Math.max(sa.size, 1) >= 0.55;
}

export function mergeOcrAsrSegments(ocrCues = [], asrSegments = [], { language = "zh" } = {}) {
  const ocr = ocrCues.map(_cueDict);
  const asr = asrSegments.map(_cueDict);
  const used = new Set();
  const merged = [];

  for (const cue of ocr) {
    const c0 = Number(cue.start);
    const c1 = Number(cue.end);
    const hits = [];
    for (const seg of asr) {
      const idx = Number(seg.index || 0);
      const s0 = Number(seg.start);
      const s1 = Number(seg.end);
      const ov = _overlap(c0, c1, s0, s1);
      const dur = Math.max(s1 - s0, 0.01);
      if (ov / dur >= 0.35 || ov / Math.max(c1 - c0, 0.01) >= 0.35) {
        hits.push(seg);
        used.add(idx);
      }
    }
    const asrText = hits.map(h => String(h.text || "")).join("").trim();
    const ocrText = String(cue.text || "").trim();
    let text;
    let source;
    if (ocrText && asrText && !_covers(ocrText, asrText)) {
      text = ocrText;
      const extra = _normZh(asrText);
      const core = _normZh(ocrText);
      if (extra && !core.includes(extra) && !extra.includes(core)) {
        text = `${ocrText} ${asrText}`;
      }
      source = "ocr+asr";
    } else if (ocrText) {
      text = ocrText;
      source = asrText ? "ocr+asr" : "ocr";
    } else {
      text = asrText;
      source = "asr";
    }
    merged.push({
      start: c0,
      end: c1,
      text,
      text_ocr: ocrText,
      text_asr: asrText,
      source,
      speaker: cue.speaker || "NARR",
    });
  }

  for (const seg of asr) {
    const idx = Number(seg.index || 0);
    if (used.has(idx)) continue;
    const text = String(seg.text || "").trim();
    if (!text) continue;
    const s0 = Number(seg.start);
    const s1 = Number(seg.end);
    const covered = ocr.some(
      c => _overlap(s0, s1, Number(c.start), Number(c.end)) / Math.max(s1 - s0, 0.01) >= 0.5
    );
    if (covered) continue;
    merged.push({
      start: s0,
      end: s1,
      text,
      text_ocr: "",
      text_asr: text,
      source: "asr",
      speaker: seg.speaker || "NARR",
    });
  }

  merged.sort((a, b) => a.start - b.start || a.end - b.end);
  const collapsed = [];
  for (const row of merged) {
    const prev = collapsed[collapsed.length - 1];
    if (prev && prev.text === row.text && row.start - prev.end <= 0.45) {
      prev.end = row.end;
      continue;
    }
    collapsed.push(row);
  }
  return collapsed.map((row, i) => new TranscriptSegment({
    index: i + 1,
    start: Math.round(row.start * 1000) / 1000,
    end: Math.round(row.end * 1000) / 1000,
    text: row.text,
    speaker: row.speaker || "NARR",
    language,
    metadata: {
      source: row.source,
      text_ocr: row.text_ocr || "",
      text_asr: row.text_asr || "",
    },
  }));
}

export const SCREEN_NARRATION_SYSTEM = `You are the producer agent for a screen dub.
You receive the FULL episode in one prompt (use the entire context):
1) OCR: burned-in on-screen source text (canonical plot; explains jump cuts).
2) ASR: spoken audio (may miss silent titles, merge speakers, or mishear names).
3) CONSENSUS: the timed cue list you must fill. Same count, index, start, and end.

Return ONE JSON array covering the whole video. Each item:
{"index": n, "start": seconds, "end": seconds, "text_zh": "...", "text_es": "..."}

Rules:
- Prefer OCR when it explains a cut the audio skips.
- Keep spoken-only ASR lines that have no on-screen text.
- You may correct OCR typos using ASR and episode context.
- text_es is spoken LATAM Spanish narration: natural, no prefixes, no stage directions.
- Emit every CONSENSUS row in order. Do not drop, merge, or truncate rows.
- Use the full episode so names and plot stay consistent.
- JSON array only. No markdown.
`;

function _formatCueLines(cues = []) {
  return cues.map((item, i) => {
    const cue = _cueDict(item);
    return `${i + 1}. [${cue.start.toFixed(2)}-${cue.end.toFixed(2)}] ${cue.text}`;
  });
}

export function buildScreenNarrationPrompt(
  ocrCues = [],
  asrSegments = [],
  { targetLanguage = "es", title = "", consensusCues = null, glossary = null } = {},
) {
  const skeleton = consensusCues != null
    ? consensusCues
    : mergeOcrAsrSegments(ocrCues, asrSegments, { language: "zh" });
  const ocrLines = _formatCueLines(ocrCues);
  const asrLines = _formatCueLines(asrSegments);
  const consensusLines = _formatCueLines(skeleton);
  const header = title ? `Title: ${title}\n` : "";
  let glossaryBlock = "";
  if (glossary && typeof glossary === "object") {
    const mapped = Object.entries(glossary)
      .filter(([src]) => src)
      .map(([src, dst]) => `- ${src} → ${dst}`)
      .join("\n");
    if (mapped) glossaryBlock = `Glossary (keep these mappings):\n${mapped}\n\n`;
  }
  const user = `${header}Target spoken language: ${targetLanguage}\n\n${glossaryBlock}OCR (on-screen, canonical, full episode):\n${ocrLines.join("\n") || "(none)"}\n\nASR (spoken, full episode):\n${asrLines.join("\n") || "(none)"}\n\nCONSENSUS (emit one JSON object per row, same index/start/end):\n${consensusLines.join("\n") || "(none)"}\n\nEmit the full JSON array for the whole video now. Do not truncate.`;
  return { system: SCREEN_NARRATION_SYSTEM, user };
}

export function parseScreenNarrationJson(raw) {
  let text = String(raw || "").trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  }
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) {
    throw new Error("screen narration response is not a JSON array");
  }
  const data = JSON.parse(text.slice(start, end + 1));
  if (!Array.isArray(data)) {
    throw new Error("screen narration JSON must be an array");
  }
  return data.map((item, i) => {
    const row = item || {};
    return {
      index: Number(row.index || i + 1),
      start: Number(row.start || 0),
      end: Number(row.end || 0),
      text_zh: String(row.text_zh || row.text || "").trim(),
      text_es: String(row.text_es || row.target_text || "").trim(),
    };
  });
}

export const SCREEN_SPOKEN_FIT_SYSTEM = `You are the localizer agent for a screen dub.
You receive the FULL translated episode with slot timings (use the entire context).
Rewrite text_es so each line can be spoken in its video slot at a natural LATAM pace.

Assume about 15.5 Spanish characters per second at TTS rate +0%.
Later we may speed audio up to 1.35x — prefer a shorter spoken line over rushing.
Keep names, plot, and oral Spanish. No prefixes, no stage directions, no duration notes.

Return ONE JSON array covering every row:
{"index": n, "start": seconds, "end": seconds, "text_es": "...", "rate": "+0%"}

rate is an Edge TTS rate such as +0% or +8%. Use a small positive rate only when
cutting words would hurt the plot. Same count, index, start, and end. JSON only.
`;

export function buildSpokenFitPrompt(
  segments = [],
  { charsPerSecond = 15.5, maxSpeed = 1.35, title = "" } = {},
) {
  const lines = segments.map((item, i) => {
    const cue = _cueDict(item);
    const data = item && typeof item.toDict === "function" ? item.toDict() : (item || {});
    const start = Number(cue.start);
    const end = Number(cue.end);
    const slot = Math.max(0.2, end - start);
    const textEs = String(data.text_es || data.target_text || data.targetText || "").trim();
    const textZh = String(data.text_zh || cue.text || "").trim();
    const budget = Math.max(8, Math.floor(slot * charsPerSecond * maxSpeed));
    const index = Number(data.index || i + 1);
    return `${index}. [${start.toFixed(2)}-${end.toFixed(2)}] slot=${slot.toFixed(2)}s budget≈${budget}ch zh=${textZh} es=${textEs}`;
  });
  const header = title ? `Title: ${title}\n` : "";
  const user = `${header}Chars/sec at +0%: ${charsPerSecond}. Max later speed: ${maxSpeed}x.\n\nEPISODE (fit every row):\n${lines.join("\n") || "(none)"}\n\nEmit the full JSON array now. Do not truncate.`;
  return { system: SCREEN_SPOKEN_FIT_SYSTEM, user };
}

export function parseSpokenFitJson(raw) {
  const rows = parseScreenNarrationJson(raw);
  let text = String(raw || "").trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  }
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  let extra = [];
  if (start >= 0 && end > start) {
    try {
      const loaded = JSON.parse(text.slice(start, end + 1));
      extra = Array.isArray(loaded) ? loaded : [];
    } catch {
      extra = [];
    }
  }
  return rows.map((row, i) => {
    let rate = "+0%";
    if (extra[i] && typeof extra[i] === "object") {
      rate = String(extra[i].rate || "+0%").trim() || "+0%";
    }
    if (rate && /^\d/.test(rate)) rate = `+${rate}`;
    if (!rate.startsWith("+") && !rate.startsWith("-")) rate = "+0%";
    if (!rate.endsWith("%")) rate = `${rate}%`;
    return { ...row, rate };
  });
}

export function screenDubbingAgentRecipe({
  task = "Dub on-screen + spoken source into LATAM Spanish narration.",
  targetLanguage = "es",
  model = "deepseek-v4-flash",
} = {}) {
  const inspector = new Agent({ name: "Inspector", role: "Probe source video and burned-in subtitle band.", metadata: { model } });
  const transcriber = new Agent({ name: "Transcriber", role: "Capture OCR on-screen text and ASR speech.", metadata: { model } });
  const editor = new Agent({ name: "Editor", role: "Merge OCR+ASR into one consensus narration script.", metadata: { model } });
  const translator = new Agent({ name: "Translator", role: "Long-context ZH→ES narration using the full episode.", metadata: { model } });
  const localizer = new Agent({ name: "Localizer", role: "Keep LATAM Spanish spoken and timed to picture.", metadata: { model } });
  const generator = new Agent({ name: "Generator", role: "Synthesize TTS clips for each consensus line.", metadata: { model } });
  const composer = new Agent({ name: "Composer", role: "Mux dubbed audio onto the source video.", metadata: { model } });
  const validator = new Agent({ name: "Validator", role: "QA timing, empty lines, and plot holes.", metadata: { model } });
  const publisher = new Agent({ name: "Publisher", role: "Package dubbed video, SRT, and media report.", metadata: { model } });
  return new Recipe({
    name: "screen-dubbing",
    description: "Agent-run screen dub: OCR + ASR consensus, then one long-context translation pass, TTS, mux, and publication.",
    steps: [
      new RecipeStep({ name: "inspect", task: "Inspect source video and subtitle band.", agent: inspector }),
      new RecipeStep({ name: "transcribe", task: "OCR burned-in titles and ASR speech.", agent: transcriber, useContext: true }),
      new RecipeStep({ name: "consensus", task: "Merge OCR+ASR into one narration script.", agent: editor, useContext: true }),
      new RecipeStep({ name: "translate", task: `Long-context translate the full consensus into ${targetLanguage}. ${task}`, agent: translator, useContext: true }),
      new RecipeStep({ name: "localize", task: "Fit spoken LATAM copy to slot timing.", agent: localizer, useContext: true }),
      new RecipeStep({ name: "generate", task: "TTS each consensus line.", agent: generator, useContext: true }),
      new RecipeStep({ name: "compose", task: "Mux dubbed audio onto picture.", agent: composer, useContext: true }),
      new RecipeStep({ name: "validate", task: "Check empty lines, speed caps, plot holes.", agent: validator, useContext: true }),
      new RecipeStep({ name: "publish", task: "Write dubbed file, SRT, and MediaWorkflowReport.", agent: publisher, useContext: true }),
    ],
    metadata: {
      pipeline: "screen_dubbing",
      target_language: targetLanguage,
      model,
      long_context: true,
    },
  }).validate();
}

export function formatSRTTimestamp(seconds) {
  const milliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(milliseconds / 3600000);
  const remainder1 = milliseconds % 3600000;
  const minutes = Math.floor(remainder1 / 60000);
  const remainder2 = remainder1 % 60000;
  const secs = Math.floor(remainder2 / 1000);
  const millis = remainder2 % 1000;
  
  const pad = (val, len) => String(val).padStart(len, "0");
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(secs, 2)},${pad(millis, 3)}`;
}

export function formatSRT(segments, { translated = false } = {}) {
  const blocks = [];
  for (let displayIndex = 1; displayIndex <= segments.length; displayIndex++) {
    const segment = segments[displayIndex - 1];
    const text = segment instanceof DubbingSegment
      ? (translated ? segment.targetText : segment.sourceText)
      : segment.text;
    blocks.push(
      [
        String(displayIndex),
        `${formatSRTTimestamp(segment.start)} --> ${formatSRTTimestamp(segment.end)}`,
        text,
      ].join("\n")
    );
  }
  return blocks.join("\n\n") + "\n";
}

async function atomicWriteText(filePath, content) {
  const { mkdir, rename, rm, writeFile } = await import("node:fs/promises");
  const { randomUUID } = await import("node:crypto");
  const { basename, dirname, resolve } = await import("node:path");
  const destination = resolve(filePath);
  const directory = dirname(destination);
  await mkdir(directory, { recursive: true });
  const temporary = resolve(directory, `.${basename(destination)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}

// Async Node.js filesystem integrations with dynamic imports
export async function writeTranscriptJSON(segments, filePath) {
  const payload = { segments: (Array.isArray(segments) ? segments : []).map((segment) => segment.toDict()) };
  await atomicWriteText(filePath, JSON.stringify(payload, null, 2));
  return filePath;
}

export async function readTranscriptJSON(filePath) {
  const { readFile } = await import("node:fs/promises");
  const raw = await readFile(filePath, "utf8");
  const data = JSON.parse(raw);
  let items = [];
  if (Array.isArray(data)) {
    items = data;
  } else if (data && typeof data === "object") {
    items = data.segments || [];
  } else {
    throw new Error("transcript JSON must be a list or object with segments");
  }
  return items.map(item => TranscriptSegment.fromDict(item));
}

export async function writeSRT(segments, filePath, { translated = false } = {}) {
  await atomicWriteText(filePath, formatSRT(segments, { translated }));
  return filePath;
}

export async function ffmpegAvailable(ffmpeg = "ffmpeg") {
  const executable = String(ffmpeg || "").trim();
  if (!executable || executable.includes("\r") || executable.includes("\n") || executable.includes("\0")) return false;
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync(executable, ["-version"], {
    shell: false,
    stdio: "ignore",
    windowsHide: true,
    timeout: 5000,
  });
  return !result.error && result.status === 0;
}

export async function extractAudio(videoPath, audioPath, { ffmpeg = "ffmpeg", overwrite = false } = {}) {
  const { mkdir } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  await mkdir(dirname(audioPath), { recursive: true });
  // No shell=True: argv list only
  await runArgv([
    ffmpeg,
    overwrite ? "-y" : "-n",
    "-i",
    videoPath,
    "-vn",
    "-acodec",
    "pcm_s16le",
    audioPath,
  ]);
  return new MediaAsset({
    path: audioPath,
    mediaType: "audio",
    metadata: { source: videoPath },
  });
}

export async function muxAudio(videoPath, audioPath, outputPath, { ffmpeg = "ffmpeg", overwrite = false } = {}) {
  const { mkdir } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  await mkdir(dirname(outputPath), { recursive: true });
  await runArgv([
    ffmpeg,
    overwrite ? "-y" : "-n",
    "-i",
    videoPath,
    "-i",
    audioPath,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    outputPath,
  ]);
  return new MediaAsset({
    path: outputPath,
    mediaType: "video",
    metadata: { audio: audioPath },
  });
}

function _formatTimeRange(start, end) {
  return `${formatSRTTimestamp(start)} -> ${formatSRTTimestamp(end)}`;
}

// ==========================================
// 1.13 — Media operations (-ion) + context handoffs
// Parity with python/packages/handoffkit/handoffkit/recipes/media.py
// Wire format stays snake_case in toDict() for Python/JS interchange.
// ==========================================

/** @type {readonly string[]} */
export const MEDIA_OPERATIONS = Object.freeze([
  "creation",
  "generation",
  "edition",
  "transcription",
  "translation",
  "localization",
  "adaptation",
  "composition",
  "inspection",
  "validation",
  "publication",
  "production",
]);

export class MediaOperationSpec {
  constructor({ name, description, inputs = [], outputs = [], agentRole = "", notes = [] } = {}) {
    this.name = String(name || "");
    this.description = String(description || "");
    this.inputs = Array.isArray(inputs) ? inputs.map(String) : [];
    this.outputs = Array.isArray(outputs) ? outputs.map(String) : [];
    this.agentRole = String(agentRole || "");
    this.notes = Array.isArray(notes) ? notes.map(String) : [];
  }

  toDict() {
    return {
      name: this.name,
      description: this.description,
      inputs: [...this.inputs],
      outputs: [...this.outputs],
      agent_role: this.agentRole,
      notes: [...this.notes],
    };
  }

  static fromDict(data = {}) {
    return new MediaOperationSpec({
      name: data.name || "",
      description: data.description || "",
      inputs: data.inputs || [],
      outputs: data.outputs || [],
      agentRole: data.agent_role || data.agentRole || "",
      notes: data.notes || [],
    });
  }
}

export function mediaOperationCatalog() {
  return [
    new MediaOperationSpec({
      name: "creation",
      description: "Define media brief, format, audience, and source constraints.",
      inputs: ["brief", "constraints"],
      outputs: ["brief", "source_plan"],
      agentRole: "media-creator",
    }),
    new MediaOperationSpec({
      name: "generation",
      description: "Generate audio, video, image, or script assets from a brief.",
      inputs: ["brief", "prompts", "voice"],
      outputs: ["assets", "generation_prompts"],
      agentRole: "media-generator",
    }),
    new MediaOperationSpec({
      name: "edition",
      description: "Edit timing, copy, cuts, and merge OCR+ASR into one consensus script.",
      inputs: ["assets", "transcript", "ocr_cues", "edition_ops"],
      outputs: ["assets", "transcript", "edition_ops"],
      agentRole: "media-editor",
    }),
    new MediaOperationSpec({
      name: "transcription",
      description: "Speech-to-text plus burned-in on-screen OCR into timestamped cues.",
      inputs: ["audio", "video"],
      outputs: ["transcript_segments", "ocr_cues"],
      agentRole: "transcriber",
      notes: ["ASR hears speech only; OCR captures silent titles the plot depends on."],
    }),
    new MediaOperationSpec({
      name: "translation",
      description: "Long-context translate the consensus script into spoken target-language narration.",
      inputs: ["transcript_segments", "target_language"],
      outputs: ["dubbing_segments", "translations"],
      agentRole: "translator",
      notes: ["Prefer one full-episode pass so names and plot stay consistent."],
    }),
    new MediaOperationSpec({
      name: "localization",
      description: "Adapt voices, culture notes, and delivery for a locale.",
      inputs: ["dubbing_segments", "speakers", "locale"],
      outputs: ["dubbing_segments", "speakers"],
      agentRole: "localizer",
    }),
    new MediaOperationSpec({
      name: "adaptation",
      description: "Adapt length, tone, or format (clip, reel, audiobook chapter).",
      inputs: ["assets", "transcript", "format"],
      outputs: ["assets", "transcript"],
      agentRole: "adapter",
    }),
    new MediaOperationSpec({
      name: "composition",
      description: "Compose tracks: mux audio, layout multi-clip, mix stems.",
      inputs: ["video", "audio", "assets"],
      outputs: ["composed_asset"],
      agentRole: "composer",
    }),
    new MediaOperationSpec({
      name: "inspection",
      description: "Inspect source media and existing transcripts without mutation.",
      inputs: ["source"],
      outputs: ["inspection_notes", "assets"],
      agentRole: "inspector",
    }),
    new MediaOperationSpec({
      name: "validation",
      description: "Validate timing, language coverage, rights, and quality gates.",
      inputs: ["assets", "transcript", "dubbing"],
      outputs: ["warnings", "validation_report"],
      agentRole: "validator",
    }),
    new MediaOperationSpec({
      name: "publication",
      description: "Package deliverables, reports, and publish metadata.",
      inputs: ["assets", "report"],
      outputs: ["output_files", "publish_manifest"],
      agentRole: "publisher",
    }),
    new MediaOperationSpec({
      name: "production",
      description: "End-to-end production orchestration across prior -ion stages.",
      inputs: ["pipeline", "brief"],
      outputs: ["report", "output_files"],
      agentRole: "producer",
    }),
  ];
}

export function getMediaOperation(name) {
  const key = String(name || "").trim().toLowerCase();
  for (const item of mediaOperationCatalog()) {
    if (item.name === key) return item;
  }
  throw new Error(`unknown media operation '${name}'. Known: ${MEDIA_OPERATIONS.join(", ")}`);
}

/** @type {Record<string, readonly string[]>} */
export const MEDIA_PIPELINES = Object.freeze({
  from_scratch: Object.freeze(["creation", "generation", "edition", "validation", "publication"]),
  video_dubbing: Object.freeze([
    "inspection",
    "transcription",
    "translation",
    "localization",
    "generation",
    "composition",
    "validation",
    "publication",
  ]),
  screen_dubbing: Object.freeze([
    "inspection",
    "transcription",
    "edition",
    "translation",
    "localization",
    "generation",
    "composition",
    "validation",
    "publication",
  ]),
  audiobook: Object.freeze([
    "creation",
    "generation",
    "edition",
    "composition",
    "validation",
    "publication",
  ]),
  subtitle_localization: Object.freeze([
    "transcription",
    "translation",
    "edition",
    "validation",
    "publication",
  ]),
  edit_existing: Object.freeze([
    "inspection",
    "edition",
    "adaptation",
    "validation",
    "publication",
  ]),
});

export class MediaEditionOp {
  constructor({ opType = "", target = "", payload = {}, notes = [] } = {}) {
    this.opType = String(opType || "");
    this.target = String(target || "");
    this.payload = payload && typeof payload === "object" ? { ...payload } : {};
    this.notes = Array.isArray(notes) ? notes.map(String) : [];
  }

  toDict() {
    return {
      op_type: this.opType,
      target: this.target,
      payload: { ...this.payload },
      notes: [...this.notes],
    };
  }

  static fromDict(data = {}) {
    return new MediaEditionOp({
      opType: data.op_type || data.opType || "",
      target: data.target || "",
      payload: data.payload || {},
      notes: data.notes || [],
    });
  }
}

export class MediaContext {
  constructor({
    operation,
    brief = "",
    targetLanguage = "",
    source = null,
    assets = [],
    transcriptSegments = [],
    speakers = [],
    dubbingSegments = [],
    generationPrompts = [],
    editionOps = [],
    constraints = [],
    history = [],
    nextOperations = [],
    warnings = [],
    outputFiles = [],
    metadata = {},
  } = {}) {
    this.operation = String(operation || "").trim().toLowerCase();
    this.brief = String(brief || "");
    this.targetLanguage = String(targetLanguage || "");
    this.source = source
      ? source instanceof MediaAsset
        ? source
        : MediaAsset.fromDict(source)
      : null;
    this.assets = (assets || []).map((a) => (a instanceof MediaAsset ? a : MediaAsset.fromDict(a)));
    this.transcriptSegments = (transcriptSegments || []).map((s) =>
      s instanceof TranscriptSegment ? s : TranscriptSegment.fromDict(s)
    );
    this.speakers = (speakers || []).map((s) =>
      s instanceof SpeakerProfile ? s : SpeakerProfile.fromDict(s)
    );
    this.dubbingSegments = (dubbingSegments || []).map((s) =>
      s instanceof DubbingSegment ? s : DubbingSegment.fromDict(s)
    );
    this.generationPrompts = (generationPrompts || []).map(String);
    this.editionOps = (editionOps || []).map((e) =>
      e instanceof MediaEditionOp ? e : MediaEditionOp.fromDict(e)
    );
    this.constraints = (constraints || []).map(String);
    this.history = (history || []).map(String);
    this.nextOperations = (nextOperations || []).map(String);
    this.warnings = (warnings || []).map(String);
    this.outputFiles = (outputFiles || []).map(String);
    this.metadata = metadata && typeof metadata === "object" ? { ...metadata } : {};

    if (this.operation && !MEDIA_OPERATIONS.includes(this.operation)) {
      if (!this.metadata.custom_operation) {
        this.warnings = [
          ...this.warnings,
          `operation '${this.operation}' is not in the built-in -ion catalog`,
        ];
      }
    }
  }

  toDict() {
    return {
      operation: this.operation,
      brief: this.brief,
      target_language: this.targetLanguage,
      source: this.source ? this.source.toDict() : null,
      assets: this.assets.map((a) => a.toDict()),
      transcript_segments: this.transcriptSegments.map((s) => s.toDict()),
      speakers: this.speakers.map((s) => s.toDict()),
      dubbing_segments: this.dubbingSegments.map((s) => s.toDict()),
      generation_prompts: [...this.generationPrompts],
      edition_ops: this.editionOps.map((e) => e.toDict()),
      constraints: [...this.constraints],
      history: [...this.history],
      next_operations: [...this.nextOperations],
      warnings: [...this.warnings],
      output_files: [...this.outputFiles],
      metadata: { ...this.metadata },
    };
  }

  static fromDict(data = {}) {
    return new MediaContext({
      operation: data.operation || "",
      brief: data.brief || "",
      targetLanguage: data.target_language || data.targetLanguage || "",
      source: data.source || null,
      assets: data.assets || [],
      transcriptSegments: data.transcript_segments || data.transcriptSegments || [],
      speakers: data.speakers || [],
      dubbingSegments: data.dubbing_segments || data.dubbingSegments || [],
      generationPrompts: data.generation_prompts || data.generationPrompts || [],
      editionOps: data.edition_ops || data.editionOps || [],
      constraints: data.constraints || [],
      history: data.history || [],
      nextOperations: data.next_operations || data.nextOperations || [],
      warnings: data.warnings || [],
      outputFiles: data.output_files || data.outputFiles || [],
      metadata: data.metadata || {},
    });
  }

  toJSON(indent = 2) {
    return JSON.stringify(this.toDict(), null, indent);
  }

  static fromJSON(value) {
    const data = typeof value === "string" ? JSON.parse(value) : value;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("media context JSON must be an object");
    }
    return MediaContext.fromDict(data);
  }

  operationSpec() {
    try {
      return getMediaOperation(this.operation);
    } catch {
      return null;
    }
  }

  /**
   * Project into core HandoffState. Wire metadata.media_context matches Python.
   */
  toHandoffState({ fromAgent, toAgent, task = null } = {}) {
    const spec = this.operationSpec();
    const role = (spec && spec.agentRole) || this.operation || "media-agent";
    const defaultTask = task || `media ${this.operation}: ${this.brief || this.operation}`;
    const files = [...this.outputFiles];
    if (this.source && this.source.path) files.push(this.source.path);
    for (const a of this.assets) {
      if (a.path) files.push(a.path);
    }
    const nextSteps =
      this.nextOperations.length > 0
        ? [...this.nextOperations]
        : spec
          ? [...spec.outputs]
          : [];
    return new HandoffState({
      task: defaultTask,
      fromAgent: fromAgent || role,
      toAgent: toAgent,
      summary:
        `Media ${this.operation} context` +
        (this.targetLanguage ? ` → ${this.targetLanguage}` : "") +
        (this.brief ? `: ${this.brief.slice(0, 160)}` : ""),
      decisions: [
        `operation=${this.operation}`,
        ...(this.targetLanguage ? [`target_language=${this.targetLanguage}`] : []),
      ],
      importantFiles: files,
      errors: [],
      nextSteps,
      contextRefs: [`media_operation:${this.operation}`, ...this.history],
      metadata: {
        media_context: this.toDict(),
        kind: "media_context",
      },
    });
  }

  static fromHandoffState(state) {
    let data = {};
    if (state && typeof state.toWire === "function") {
      data = state.toWire();
    } else if (state && typeof state.toDict === "function") {
      data = state.toDict();
    } else if (state && typeof state.toJSON === "function") {
      data = state.toJSON();
    } else if (state && typeof state === "object") {
      data = state;
    }
    const meta = data.metadata || {};
    const raw = meta.media_context || meta.mediaContext;
    if (raw && typeof raw === "object") {
      return MediaContext.fromDict(raw);
    }
    return new MediaContext({
      operation: meta.operation || "inspection",
      brief: data.summary || data.task || "",
      constraints: data.decisions || [],
      outputFiles: data.important_files || data.importantFiles || [],
      nextOperations: data.next_steps || data.nextSteps || [],
      metadata: meta,
    });
  }

  withOperation(operation) {
    const data = this.toDict();
    const history = [...this.history];
    if (this.operation) history.push(this.operation);
    data.operation = String(operation || "").trim().toLowerCase();
    data.history = history;
    return MediaContext.fromDict(data);
  }
}

export function buildMediaContext(
  operation,
  {
    brief = "",
    targetLanguage = "",
    source = null,
    pipeline = null,
    constraints = null,
    generationPrompts = null,
    metadata = null,
  } = {}
) {
  const op = String(operation || "").trim().toLowerCase();
  let nextOps = [];
  if (pipeline) {
    const stages = [...mediaPipelineStages(pipeline)];
    if (stages.includes(op)) {
      const idx = stages.indexOf(op);
      nextOps = stages.slice(idx + 1);
    } else {
      nextOps = stages;
    }
  }
  return new MediaContext({
    operation: op,
    brief,
    targetLanguage,
    source,
    constraints: constraints || [],
    generationPrompts: generationPrompts || [],
    nextOperations: nextOps,
    metadata: {
      ...(metadata || {}),
      ...(pipeline ? { pipeline } : {}),
    },
  });
}

export function handoffMediaContext(
  context,
  nextOperation,
  { fromAgent = "", toAgent = "" } = {}
) {
  const nxt = String(nextOperation || "").trim().toLowerCase();
  const advanced = context.withOperation(nxt);
  const pipeline = String((advanced.metadata || {}).pipeline || "");
  if (pipeline) {
    const stages = [...mediaPipelineStages(pipeline)];
    if (stages.includes(nxt)) {
      const i = stages.indexOf(nxt);
      advanced.nextOperations = stages.slice(i + 1);
    }
  } else {
    advanced.nextOperations = context.nextOperations.filter((x) => x !== nxt);
  }
  if (fromAgent || toAgent) {
    advanced.metadata = {
      ...advanced.metadata,
      last_handoff: {
        from_agent: fromAgent,
        to_agent: toAgent,
        from_operation: context.operation,
        to_operation: nxt,
      },
    };
  }
  return advanced;
}

export function mediaPipelineStages(name) {
  const key = String(name || "").trim().toLowerCase();
  if (!(key in MEDIA_PIPELINES)) {
    throw new Error(
      `unknown media pipeline '${name}'. Known: ${Object.keys(MEDIA_PIPELINES).sort().join(", ")}`
    );
  }
  return MEDIA_PIPELINES[key];
}

export function listMediaPipelines() {
  /** @type {Record<string, string[]>} */
  const out = {};
  for (const [name, stages] of Object.entries(MEDIA_PIPELINES)) {
    out[name] = [...stages];
  }
  return out;
}

export function planMediaPipeline(
  pipeline,
  { brief = "", targetLanguage = "", source = null, constraints = null } = {}
) {
  const stages = mediaPipelineStages(pipeline);
  const planned = [];
  const history = [];
  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i];
    planned.push(
      new MediaContext({
        operation: stage,
        brief,
        targetLanguage,
        source,
        constraints: constraints || [],
        history: [...history],
        nextOperations: stages.slice(i + 1),
        metadata: { pipeline, stage_index: i },
      })
    );
    history.push(stage);
  }
  return planned;
}

export function applyTranscriptEditions(segments, rewrites) {
  const map = rewrites instanceof Map ? Object.fromEntries(rewrites) : rewrites || {};
  return segments.map((seg) => {
    const s = seg instanceof TranscriptSegment ? seg : TranscriptSegment.fromDict(seg);
    const text = map[s.index] !== undefined ? map[s.index] : s.text;
    const metadata = { ...s.metadata };
    if (map[s.index] !== undefined) metadata.edition = "rewrite";
    return new TranscriptSegment({
      index: s.index,
      start: s.start,
      end: s.end,
      text,
      speaker: s.speaker,
      language: s.language,
      metadata,
    });
  });
}

export function buildGenerationContext(
  brief,
  { prompts = null, targetLanguage = "", mediaType = "audio", constraints = null } = {}
) {
  return buildMediaContext("generation", {
    brief,
    targetLanguage,
    pipeline: "from_scratch",
    constraints: constraints || [
      "keep deterministic offline demos free of paid APIs",
      `primary media_type=${mediaType}`,
    ],
    generationPrompts: prompts || [brief],
    metadata: { media_type: mediaType, phase: "generation" },
  });
}

export function buildCreationContext(
  brief,
  { targetLanguage = "", pipeline = "from_scratch", constraints = null } = {}
) {
  return buildMediaContext("creation", {
    brief,
    targetLanguage,
    pipeline,
    constraints: constraints || [
      "define audience, length, format, and rights",
      "prefer explicit handoffs over free-text summaries",
    ],
    metadata: { phase: "creation" },
  });
}

export function buildEditionContext({
  brief = "",
  transcriptSegments = null,
  editionOps = null,
  source = null,
  targetLanguage = "",
} = {}) {
  const ctx = buildMediaContext("edition", {
    brief: brief || "Edit media / transcript",
    targetLanguage,
    source,
    pipeline: "edit_existing",
    metadata: { phase: "edition" },
  });
  if (transcriptSegments) ctx.transcriptSegments = [...transcriptSegments];
  if (editionOps) ctx.editionOps = [...editionOps];
  return ctx;
}

export function mediaContextToWorkflowReport(context, { success = true } = {}) {
  const source = context.source || new MediaAsset({ path: "(none)", mediaType: "unknown" });
  return new MediaWorkflowReport({
    success,
    source,
    targetLanguage: context.targetLanguage,
    transcriptSegments: [...context.transcriptSegments],
    speakers: [...context.speakers],
    dubbingSegments: [...context.dubbingSegments],
    outputFiles: [...context.outputFiles],
    warnings: [...context.warnings],
    metadata: {
      operation: context.operation,
      history: [...context.history],
      next_operations: [...context.nextOperations],
      brief: context.brief,
      media_context: context.toDict(),
    },
  });
}

function webProviderText(provider, prompt, options = {}) {
  if (!provider) return Promise.resolve("");
  const providerId = String(provider.id ?? provider.provider ?? provider.name ?? "").toLowerCase();
  const providerOptions = providerId.includes("ollama") ? { think: false } : {};
  if (typeof provider.agenerate === "function") {
    return Promise.resolve(provider.agenerate(prompt, { ...providerOptions, ...options })).then((value) => String(value ?? "").trim());
  }
  if (typeof provider.generate === "function") {
    return Promise.resolve(provider.generate(prompt, { ...providerOptions, ...options })).then((value) => String(value ?? "").trim());
  }
  throw new TypeError("web grounded provider must expose generate() or agenerate().");
}

function stripJsonFence(value) {
  let text = String(value ?? "").trim();
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  return first >= 0 && last > first ? text.slice(first, last + 1) : text;
}

function parseWebJson(value) {
  try {
    return { value: JSON.parse(stripJsonFence(value)), error: "" };
  } catch (error) {
    return { value: null, error: String(error?.message ?? error) };
  }
}

function candidateMarkdownForWebAnswer(query, candidates, fetchedAt = new Date().toISOString()) {
  const lines = ["# Resultados de búsqueda actuales", "", `Consulta: ${query}`, `Obtenidos: ${fetchedAt}`, ""];
  for (const candidate of candidates) {
    lines.push(`## ${candidate.rank}. ${candidate.title || "Untitled"}`, "", `URL exacta: ${candidate.url}`, "");
    if (candidate.source_queries?.length) lines.push(`Consultas relacionadas: ${candidate.source_queries.join(" | ")}`, "");
  }
  return lines.join("\n");
}

function isFetchableWebCandidate(url) {
  try {
    const parsed = new URL(String(url ?? ""));
    const path = parsed.pathname.toLowerCase();
    return !/\.(?:pdf|zip|gz|tar|tgz|7z|docx?|xlsx?|pptx?)(?:$|\/)/i.test(path)
      && !/(?:^|\/)download(?:\/|$)/i.test(path)
      && !/(?:^|\/)pdf(?:\/|$)/i.test(path);
  } catch {
    return false;
  }
}

function selectWebAnswerUrls(planner, candidates, maxPages) {
  const selected = [];
  const byUrl = new Map(candidates.map((candidate) => [candidate.url, candidate]));
  const addUrl = (raw) => {
    const url = typeof raw === "string" ? raw.trim() : "";
    if (byUrl.has(url) && !selected.includes(url)) selected.push(url);
  };
  const addRank = (raw) => {
    const rank = Number(raw);
    if (Number.isInteger(rank)) addUrl(candidates.find((candidate) => candidate.rank === rank)?.url);
  };
  const urls = planner?.selected_urls ?? planner?.selectedUrls;
  if (Array.isArray(urls)) {
    for (const item of urls) addUrl(typeof item === "string" ? item : item?.url);
  }
  const ranks = planner?.selected_ranks ?? planner?.selectedRanks;
  if (Array.isArray(ranks)) {
    for (const item of ranks) {
      if (typeof item === "string" || typeof item === "number") addRank(item);
      else if (item && typeof item === "object") {
        addRank(item.rank ?? item.result_rank);
        addUrl(item.url);
      }
    }
  }
  return selected.slice(0, Math.max(1, Number(maxPages) || 1));
}

// Explicit subqueries are coverage requirements, not just hints. Reserve
// one candidate per query when available, then fill remaining slots from
// the provider selection. This prevents silent single-topic selection.
function ensureWebQueryCoverage(selectedUrls, candidates, searchQueryList, maxPages) {
  const limit = Math.max(1, Number(maxPages) || 1);
  const byUrl = new Map(candidates.map((candidate) => [candidate.url, candidate]));
  const out = [];
  const add = (url) => {
    if (byUrl.has(url) && !out.includes(url)) out.push(url);
  };
  for (const query of searchQueryList ?? []) {
    const candidate = candidates.find((item) => (item.source_queries ?? []).includes(query));
    if (candidate) add(candidate.url);
  }
  for (const url of selectedUrls ?? []) add(url);
  return out.slice(0, limit);
}

function fallbackWebQueryCoverage(candidates, selectedUrls, fetchedUrls, searchQueryList, maxPages) {
  const limit = Math.max(1, Number(maxPages) || 1);
  const selected = new Set(selectedUrls ?? []);
  const fetched = new Set(fetchedUrls ?? []);
  const out = [];
  const add = (url) => {
    if (url && !out.includes(url)) out.push(url);
  };
  // Keep successful selected pages, then replace failed pages with a
  // candidate from every uncovered query before using arbitrary fallbacks.
  for (const url of selectedUrls ?? []) if (fetched.has(url)) add(url);
  for (const query of searchQueryList ?? []) {
    const covered = out.some((url) => (candidates.find((item) => item.url === url)?.source_queries ?? []).includes(query));
    if (covered) continue;
    const candidate = candidates.find((item) => !selected.has(item.url) && (item.source_queries ?? []).includes(query));
    if (candidate) add(candidate.url);
  }
  for (const candidate of candidates) if (!selected.has(candidate.url)) add(candidate.url);
  for (const url of selectedUrls ?? []) add(url);
  return out.slice(0, limit);
}

function pageEvidenceMarkdown(pack) {
  const pages = (pack?.pages ?? []).map((page, index) => {
    const item = page?.toDict ? page.toDict() : page;
    const content = String(item?.markdown || item?.text || item?.excerpt || "");
    const bounded = content.length > 2000 ? `${content.slice(0, 2000)}\n...[page evidence truncated]` : content;
    const factLines = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /parameters?|context|architecture|on-device|tool|calling|quick start|transformers|llama\.cpp|vllm|sglang|phone|laptop|edge/i.test(line))
      .slice(0, 24);
    return [
      `## Evidence page ${index + 1}: ${item?.title || "Untitled page"}`,
      "",
      factLines.length ? `### Extracted facts\n\n${factLines.join("\n")}` : "",
      "",
      bounded,
    ].join("\n");
  });
  return pages.join("\n\n---\n\n");
}

function normalizeEvidenceSections(value) {
  if (!Array.isArray(value)) return [];
  const sections = [];
  const seen = new Set();
  for (const [index, raw] of value.entries()) {
    if (!raw || typeof raw !== "object") continue;
    const id = String(raw.id || `section_${index + 1}`).trim().replace(/[^a-z0-9_-]+/gi, "_").toLowerCase();
    if (!id || seen.has(id)) continue;
    const requirements = (Array.isArray(raw.requirements) ? raw.requirements : [])
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .slice(0, 24);
    if (!requirements.length) continue;
    seen.add(id);
    sections.push({
      id,
      title: String(raw.title || raw.label || id).trim(),
      render: ["bullets", "paragraph", "table"].includes(String(raw.render || "").toLowerCase())
        ? String(raw.render).toLowerCase() : "bullets",
      columns: (Array.isArray(raw.columns) ? raw.columns : []).map((item) => String(item || "").trim()).filter(Boolean).slice(0, 8),
      query: String(raw.query || "").trim(),
      sourceQueries: (Array.isArray(raw.sourceQueries) ? raw.sourceQueries : [])
        .map((item) => String(item || "").trim()).filter(Boolean),
      requirements,
      deterministicEvidence: (Array.isArray(raw.deterministicEvidence) ? raw.deterministicEvidence : [])
        .filter((item) => item && typeof item === "object")
        .map((item) => ({
          requirement: String(item.requirement || "").trim(),
          statement: String(item.statement || "").trim(),
          quote: String(item.quote || "").trim(),
        }))
        .filter((item) => item.requirement && item.statement && item.quote),
      deterministicFindings: (Array.isArray(raw.deterministicFindings) ? raw.deterministicFindings : [])
        .filter((item) => item && typeof item === "object")
        .map((item) => ({
          requirement: String(item.requirement || "").trim(),
          statement: String(item.statement || "").trim(),
          evidenceClaims: (Array.isArray(item.evidenceClaims) ? item.evidenceClaims : item.evidence_claims ?? [])
            .map((claim) => String(claim || "").trim()).filter(Boolean),
          cells: (Array.isArray(item.cells) ? item.cells : []).map((cell) => String(cell || "").trim()),
        }))
        .filter((item) => item.requirement && item.statement && item.evidenceClaims.length),
      required: raw.required !== false,
      maxPages: Math.max(1, Math.min(Number(raw.maxPages) || 3, 8)),
    });
    if (sections.length >= 12) break;
  }
  return sections;
}

function evidencePageRecord(rawPage, index, candidates = []) {
  const page = rawPage?.toDict ? rawPage.toDict() : rawPage ?? {};
  const url = String(page.url || page.final_url || page.finalUrl || "").trim();
  const candidate = candidates.find((item) => item.url === url);
  return {
    number: index + 1,
    title: String(page.title || "Untitled page").trim(),
    url,
    content: String(page.markdown || page.text || page.excerpt || ""),
    sourceQueries: candidate?.source_queries ?? [],
  };
}

function evidenceSectionPages(section, pages, candidates) {
  const records = pages.map((page, index) => evidencePageRecord(page, index, candidates));
  const exactQueries = new Set(section.sourceQueries.map((item) => item.toLowerCase()));
  const terms = `${section.title} ${section.query} ${section.requirements.join(" ")}`
    .toLowerCase().match(/[a-z0-9][a-z0-9._-]{3,}/g) ?? [];
  const scored = records.map((page) => {
    const exact = page.sourceQueries.some((query) => exactQueries.has(String(query).toLowerCase()));
    const haystack = `${page.title} ${page.sourceQueries.join(" ")} ${page.content.slice(0, 5000)}`.toLowerCase();
    const lexical = [...new Set(terms)].reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
    return { page, score: (exact ? 1000 : 0) + lexical };
  }).sort((a, b) => b.score - a.score || a.page.number - b.page.number);
  const selected = scored.filter((item) => item.score > 0).slice(0, section.maxPages).map((item) => item.page);
  return selected.length ? selected : records.slice(0, section.maxPages);
}

function relevantEvidenceText(content, terms, maxChars) {
  const source = String(content || "");
  const chunks = source.split(/\n{2,}|(?<=\.)\s+(?=[A-Z])/).map((text, index) => ({ text: text.trim(), index })).filter((item) => item.text);
  const uniqueTerms = [...new Set(terms.map((term) => String(term).toLowerCase()).filter((term) => term.length >= 4))];
  const ranked = chunks.map((chunk) => {
    const lower = chunk.text.toLowerCase();
    return { ...chunk, score: uniqueTerms.reduce((score, term) => score + (lower.includes(term) ? 1 : 0), 0) };
  }).sort((a, b) => b.score - a.score || a.index - b.index);
  const selected = [];
  let used = 0;
  for (const chunk of ranked) {
    if (used >= maxChars) break;
    if (chunk.score === 0 && selected.length) break;
    const text = chunk.text.slice(0, Math.max(0, maxChars - used));
    if (text) selected.push({ ...chunk, text });
    used += text.length;
  }
  if (!selected.length) return source.slice(0, maxChars);
  return selected.sort((a, b) => a.index - b.index).map((item) => item.text).join("\n\n");
}

function evidencePagesMarkdown(pages, maxChars = 12000, terms = []) {
  let remaining = Math.max(2000, Number(maxChars) || 12000);
  const blocks = [];
  for (const page of pages) {
    if (remaining <= 0) break;
    const content = relevantEvidenceText(page.content, terms, Math.min(remaining, 6000));
    blocks.push(`[P${page.number}] ${page.title}\n${content}`);
    remaining -= content.length;
  }
  return blocks.join("\n\n---\n\n");
}

function evidenceMatchTokens(value) {
  return String(value || "")
    .normalize("NFKD").toLowerCase()
    .replace(/\\(?:ell|beta|hat|sum|sigma|equiv|bar|tilde)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/)
    .filter((token) => token.length > 1 && ![
      "ell", "beta", "hat", "sigma", "the", "and", "for", "with", "from", "that", "this",
      "only", "using", "use", "when", "where", "state", "describe", "report", "retrieved",
    ].includes(token))
    .map((token) => token.length > 6 && token.endsWith("ing") ? token.slice(0, -3)
      : token.length > 5 && token.endsWith("ed") ? token.slice(0, -2)
        : token.length > 4 && token.endsWith("s") ? token.slice(0, -1) : token);
}

function quoteMatchesEvidence(quote, content) {
  const quoteTokens = evidenceMatchTokens(quote);
  const pageTokens = evidenceMatchTokens(content);
  if (quoteTokens.length < 4 || pageTokens.length < 4) return false;
  const pageText = ` ${pageTokens.join(" ")} `;
  for (let index = 0; index <= quoteTokens.length - 4; index += 1) {
    if (pageText.includes(` ${quoteTokens.slice(index, index + 4).join(" ")} `)) return true;
  }
  return false;
}

function parseEvidenceSection(value, section, allowedPages) {
  const parsed = parseWebJson(value);
  if (parsed.error || !parsed.value || typeof parsed.value !== "object") {
    return { valid: false, error: parsed.error || "evidence section is not an object", raw: String(value || "") };
  }
  let rawFindings = Array.isArray(parsed.value.findings) ? parsed.value.findings : [];
  if (!rawFindings.length || (section.requirements.length > 1 && rawFindings.length !== section.requirements.length)) {
    return { valid: false, error: `expected ${section.requirements.length} findings, got ${rawFindings.length}`, raw: String(value || "") };
  }
  const normalizedPageText = new Map(allowedPages.map((page) => [
    page.number,
    String(page.content || ""),
  ]));
  if (section.requirements.length === 1 && rawFindings.length > 1) {
    const requirementTerms = new Set(evidenceMatchTokens(section.requirements[0]));
    const rankedFindings = rawFindings.map((finding) => {
      const statementTerms = new Set(evidenceMatchTokens(finding?.statement));
      const overlap = [...requirementTerms].filter((term) => statementTerms.has(term)).length;
      const quote = String(finding?.quote || "");
      const grounded = allowedPages.some((page) => quoteMatchesEvidence(quote, normalizedPageText.get(page.number)));
      return { finding, grounded, overlap, score: (grounded ? 100 : 0) + overlap };
    }).sort((a, b) => b.score - a.score);
    const best = rankedFindings[0];
    rawFindings = [best?.grounded && best.overlap >= 2 ? best.finding : { status: "not_found" }];
  }
  const findings = section.requirements.map((requirement, index) => {
    const raw = rawFindings[index] && typeof rawFindings[index] === "object" ? rawFindings[index] : {};
    const status = String(raw.status || "").toLowerCase() === "supported" ? "supported" : "not_found";
    const statement = String(raw.statement || "").trim();
    const quote = String(raw.quote || "").replace(/\s+/g, " ").trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, "");
    // Page numbers are model output and may be mistyped. The quote is the
    // authority: locate it across the bounded pages and derive page numbers
    // locally. A claim cannot become supported by merely naming a page.
    const matchedPages = quote.length >= 12
      ? allowedPages.filter((page) => quoteMatchesEvidence(quote, normalizedPageText.get(page.number))).map((page) => page.number)
      : [];
    const requirementTerms = new Set(evidenceMatchTokens(requirement));
    const statementTerms = new Set(evidenceMatchTokens(statement));
    const quoteTerms = new Set(evidenceMatchTokens(quote));
    const statementOverlap = [...requirementTerms].filter((term) => statementTerms.has(term)).length;
    const quoteOverlap = [...requirementTerms].filter((term) => quoteTerms.has(term)).length;
    const minimumOverlap = requirementTerms.size <= 4 ? 1 : 2;
    const supported = status === "supported" && statement && matchedPages.length > 0
      && statementOverlap >= minimumOverlap && quoteOverlap >= minimumOverlap;
    return {
      requirement,
      status: supported ? "supported" : "not_found",
      statement: supported ? statement : "",
      quote: supported ? quote : "",
      evidence_pages: supported ? matchedPages : [],
      verification: {
        quote_matched: matchedPages.length > 0,
        statement_overlap: statementOverlap,
        quote_overlap: quoteOverlap,
        minimum_overlap: minimumOverlap,
      },
    };
  });
  if (rawFindings.some((finding) => String(finding?.status || "").toLowerCase() === "supported")
      && findings.some((finding) => finding.status !== "supported")) {
    return { valid: false, error: "supported finding lacks a grounded, requirement-relevant quote", raw: String(value || "") };
  }
  return {
    valid: true,
    id: section.id,
    title: section.title,
    required: section.required,
    findings,
    pages: allowedPages.map((page) => ({ number: page.number, title: page.title, url: page.url })),
    raw: String(value || ""),
    error: "",
  };
}

async function buildEvidenceDossier({
  sections,
  pages,
  candidates,
  provider,
  question,
  maxTokens,
  numCtx,
  retries,
  concurrency,
  contextMaxChars,
}) {
  if (!sections.length) return { enabled: false, valid: true, sections: [], errors: [] };
  const extracted = await mapWithConcurrency(sections, Math.max(1, Math.min(Number(concurrency) || 1, 4)), async (section) => {
    const selectedPages = evidenceSectionPages(section, pages, candidates);
    const attempts = Math.max(1, Math.min(Number(retries) + 1 || 1, 3));
    const findings = [];
    const rawOutputs = [];
    const warnings = [];
    let sectionAttempts = 0;
    for (const requirement of section.requirements) {
      const singleSection = { ...section, requirements: [requirement] };
      const deterministic = section.deterministicEvidence.find((item) => item.requirement === requirement);
      if (deterministic) {
        const matchedPages = selectedPages
          .filter((page) => {
            if (!quoteMatchesEvidence(deterministic.quote, page.content)) return false;
            const requirementTerms = new Set(evidenceMatchTokens(requirement));
            const statementTerms = new Set(evidenceMatchTokens(deterministic.statement));
            const quoteTerms = new Set(evidenceMatchTokens(deterministic.quote));
            const minimum = requirementTerms.size <= 4 ? 1 : 2;
            return [...requirementTerms].filter((term) => statementTerms.has(term)).length >= minimum
              && [...requirementTerms].filter((term) => quoteTerms.has(term)).length >= minimum;
          })
          .map((page) => page.number);
        if (matchedPages.length) {
          findings.push({
            requirement,
            status: "supported",
            statement: deterministic.statement,
            quote: deterministic.quote,
            evidence_pages: matchedPages,
            verification: { quote_matched: true, deterministic: true },
          });
        } else {
          warnings.push(`${requirement}: deterministic evidence quote missing or irrelevant`);
          findings.push({ requirement, status: "not_found", statement: "", quote: "", evidence_pages: [] });
        }
        continue;
      }
      const evidenceTerms = `${section.title} ${section.query} ${requirement}`
        .toLowerCase().match(/[a-z0-9][a-z0-9._-]{3,}/g) ?? [];
      const evidence = evidencePagesMarkdown(selectedPages, contextMaxChars, evidenceTerms);
      const basePrompt = [
        "Extract evidence for exactly ONE requirement. Do not write the final answer. Do not use memory.",
        `Section: ${section.title}`,
        section.query ? `Focus: ${section.query}` : "",
        `Requirement: ${requirement}`,
        'Return exactly one finding. status is "supported" only when supplied pages explicitly support the statement; otherwise use "not_found".',
        "For supported findings, quote must be one short verbatim fragment copied from the indicated page. A non-verbatim quote is rejected.",
        "evidence_pages may contain only supplied P numbers. Do not infer adoption, popularity, ranking, dates, software, or causal mechanisms.",
        'Return ONLY JSON: {"section_id":"...","findings":[{"status":"supported|not_found","statement":"...","quote":"verbatim page fragment","evidence_pages":[1]}]}',
        "",
        `Research question: ${question}`,
        "",
        "Evidence:",
        evidence,
      ].filter(Boolean).join("\n");
      let raw = "";
      let verdict = { valid: false, error: "not attempted", raw: "" };
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        sectionAttempts += 1;
        const prompt = attempt === 1 ? basePrompt : [
          "Repair JSON. Return exactly one finding for the one requirement.",
          `Previous error: ${verdict.error}`,
          basePrompt,
          `Previous output: ${raw}`,
        ].join("\n\n");
        try {
          raw = await webProviderText(provider, prompt, {
            temperature: 0,
            max_tokens: maxTokens,
            num_ctx: numCtx,
            response_format: { type: "json_object" },
          });
          verdict = parseEvidenceSection(raw, singleSection, selectedPages);
        } catch (error) {
          verdict = { valid: false, error: String(error?.message ?? error), raw };
        }
        if (verdict.valid) break;
      }
      rawOutputs.push(raw);
      if (!verdict.valid) {
        warnings.push(`${requirement}: ${verdict.error}`);
        findings.push({ requirement, status: "not_found", statement: "", quote: "", evidence_pages: [] });
        continue;
      }
      findings.push(verdict.findings[0]);
    }
    return {
      valid: findings.length === section.requirements.length,
      degraded: warnings.length > 0,
      id: section.id,
      title: section.title,
      required: section.required,
      findings,
      pages: selectedPages.map((page) => ({ number: page.number, title: page.title, url: page.url })),
      raw: rawOutputs.join("\n---\n"),
      attempts: sectionAttempts,
      error: "",
      warnings,
      render: section.render,
      columns: section.columns,
    };
  });
  const errors = extracted.filter((section) => !section.valid && section.required)
    .map((section) => `${section.id}: ${section.error}`);
  const warnings = extracted.flatMap((section) => (section.warnings ?? []).map((warning) => `${section.id}: ${warning}`));
  return { enabled: true, valid: errors.length === 0, degraded: warnings.length > 0, sections: extracted, errors, warnings };
}

async function buildSynthesisDossier({ sections, evidenceDossier, provider, question, maxTokens, numCtx, retries }) {
  if (!sections.length) return { sections: [], warnings: [] };
  const claims = [];
  for (const section of evidenceDossier.sections) {
    for (const [index, finding] of (section.findings ?? []).entries()) {
      claims.push({
        id: `${section.id}:${index}`,
        section: section.title,
        status: finding.status,
        text: finding.status === "supported" ? finding.statement : finding.requirement,
      });
    }
  }
  const allowedClaims = new Set(claims.map((claim) => claim.id));
  const claimMarkdown = claims.map((claim) => `- [${claim.id}] ${claim.status.toUpperCase()}: ${claim.text}`).join("\n");
  const warnings = [];
  const out = [];
  for (const section of sections) {
    const findings = [];
    for (const requirement of section.requirements) {
      const deterministic = section.deterministicFindings.find((item) => item.requirement === requirement);
      if (deterministic) {
        const refs = [...new Set(deterministic.evidenceClaims.filter((ref) => allowedClaims.has(ref)))];
        const statuses = refs.map((ref) => claims.find((claim) => claim.id === ref)?.status);
        const limitation = /\b(?:cannot|can't|no|not|insufficient|unavailable|lack|missing|no permite|insuficiente|falta)\b/i.test(deterministic.statement);
        const positiveValid = refs.length >= 2 && statuses.every((status) => status === "supported");
        const limitationValid = refs.length >= 1 && statuses.some((status) => status === "not_found") && limitation;
        if (refs.length !== deterministic.evidenceClaims.length || (!positiveValid && !limitationValid)) {
          warnings.push(`${section.id}: ${requirement}: deterministic inference references invalid or incompatible claims`);
          findings.push({ requirement, status: "not_found", statement: "", evidence_claims: refs, evidence_pages: [], quote: "" });
        } else {
          findings.push({ requirement, status: "derived", statement: deterministic.statement, evidence_claims: refs, evidence_pages: [], quote: "", cells: deterministic.cells });
        }
        continue;
      }
      const prompt = [
        "Derive exactly ONE transparent research inference from the supplied claim ledger. Do not use memory.",
        `Section: ${section.title}`,
        `Requirement: ${requirement}`,
        "Use status derived only when at least two SUPPORTED ledger claims logically support a positive inference. One or more NOT_FOUND ledger claims may support only an explicit limitation, never a positive factual claim.",
        "Copy evidence_claims exactly from the bracketed IDs below. Do not invent or shorten IDs.",
        'Return ONLY JSON: {"finding":{"status":"derived|not_found","statement":"...","evidence_claims":["section:0","section:1"]}}',
        "",
        `Research question: ${question}`,
        "",
        "Claim ledger:",
        claimMarkdown,
      ].join("\n");
      let raw = "";
      let normalized = null;
      let error = "not attempted";
      const attempts = Math.max(1, Math.min(Number(retries) + 1 || 1, 3));
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        const currentPrompt = attempt === 1 ? prompt : `${prompt}\n\nRepair: ${error}\nPrevious output: ${raw}`;
        try {
          raw = await webProviderText(provider, currentPrompt, {
            temperature: 0,
            max_tokens: maxTokens,
            num_ctx: numCtx,
            response_format: { type: "json_object" },
          });
          const parsed = parseWebJson(raw);
          const finding = parsed.value?.finding;
          const refs = [...new Set((Array.isArray(finding?.evidence_claims) ? finding.evidence_claims : [])
            .map((ref) => String(ref)).filter((ref) => allowedClaims.has(ref)))];
          const statement = String(finding?.statement || "").trim();
          const statuses = refs.map((ref) => claims.find((claim) => claim.id === ref)?.status);
          const limitation = /\b(?:cannot|can't|no|not|insufficient|unavailable|lack|missing|no permite|insuficiente|falta)\b/i.test(statement);
          const positiveValid = refs.length >= 2 && statuses.every((status) => status === "supported");
          const limitationValid = refs.length >= 1 && statuses.some((status) => status === "not_found") && limitation;
          if (String(finding?.status).toLowerCase() === "derived" && statement && (positiveValid || limitationValid)) {
            normalized = { requirement, status: "derived", statement, evidence_claims: refs, evidence_pages: [], quote: "" };
            break;
          }
          if (String(finding?.status).toLowerCase() === "not_found") {
            normalized = { requirement, status: "not_found", statement: "", evidence_claims: refs, evidence_pages: [], quote: "" };
            break;
          }
          error = parsed.error || "derived finding has invalid claim references or unsupported polarity";
        } catch (cause) {
          error = String(cause?.message ?? cause);
        }
      }
      if (!normalized) {
        warnings.push(`${section.id}: ${requirement}: ${error}`);
        normalized = { requirement, status: "not_found", statement: "", evidence_claims: [], evidence_pages: [], quote: "" };
      }
      findings.push(normalized);
    }
    out.push({ id: section.id, title: section.title, required: section.required, valid: true, derived: true, findings, warnings: [], raw: "", render: section.render, columns: section.columns });
  }
  return { sections: out, warnings };
}

function evidenceDossierMarkdown(dossier) {
  if (!dossier?.enabled) return "";
  return dossier.sections.map((section) => {
    const lines = [`## ${section.title}`];
    for (const finding of section.findings ?? []) {
      if (finding.status === "supported") {
        lines.push(`- SUPPORTED [${finding.evidence_pages.map((number) => `P${number}`).join(", ")}]: ${finding.statement}`);
      } else if (finding.status === "derived") {
        lines.push(`- DERIVED [${finding.evidence_claims.join(", ")}]: ${finding.statement}`);
      } else {
        lines.push(`- NOT FOUND: ${finding.requirement}`);
      }
    }
    return lines.join("\n");
  }).join("\n\n");
}

function cleanResearchText(value) {
  return String(value || "")
    .replaceAll("â€™", "'").replaceAll("â€˜", "'")
    .replaceAll("â€œ", '"').replaceAll("â€", '"')
    .replaceAll("â€“", "–").replaceAll("â€”", "—");
}

function renderEvidenceDossierAnswer(dossier) {
  return dossier.sections.map((section) => {
    const supported = (section.findings ?? []).filter((finding) => finding.status === "supported" || finding.status === "derived");
    const missing = (section.findings ?? []).filter((finding) => finding.status !== "supported" && finding.status !== "derived");
    const lines = [`## ${section.title}`];
    if (section.render === "table" && section.columns?.length) {
      const escapeCell = (value) => cleanResearchText(value).replaceAll("|", "\\|").replace(/\s+/g, " ").trim();
      lines.push(`| ${section.columns.map(escapeCell).join(" | ")} |`);
      lines.push(`| ${section.columns.map(() => "---").join(" | ")} |`);
      for (const finding of supported) {
        if (Array.isArray(finding.cells) && finding.cells.length === section.columns.length) {
          lines.push(`| ${finding.cells.map(escapeCell).join(" | ")} |`);
        }
      }
    } else if (section.render === "paragraph") {
      const direct = supported.filter((finding) => finding.status === "supported").map((finding) => cleanResearchText(finding.statement));
      const inferred = supported.filter((finding) => finding.status === "derived").map((finding) => cleanResearchText(finding.statement));
      if (direct.length) lines.push(`Direct evidence: ${direct.join(" ")}`);
      if (inferred.length) lines.push(`Inference: ${inferred.join(" ")}`);
    } else {
      for (const finding of supported) lines.push(`- ${finding.status === "derived" ? "Inference: " : "Direct evidence: "}${cleanResearchText(finding.statement)}`);
    }
    for (const finding of missing) lines.push(`- Evidence not found: ${cleanResearchText(finding.requirement)}`);
    return lines.join("\n");
  }).join("\n\n");
}

function pageLabelCoverage(answer, pages = []) {
  const text = String(answer ?? "").toLowerCase();
  const stop = new Set(["the", "and", "for", "with", "from", "page", "docs", "blog", "home", "about"]);
  const missing = [];
  for (const rawPage of pages) {
    const page = rawPage?.toDict ? rawPage.toDict() : rawPage ?? {};
    const title = String(page.title ?? "").toLowerCase();
    const tokens = title.match(/[a-z0-9][a-z0-9._-]{2,}/g)?.filter((token) => !stop.has(token)) ?? [];
    if (tokens.length && !tokens.some((token) => text.includes(token))) missing.push(title);
  }
  return { valid: missing.length === 0, missing };
}

function extractExplicitRuntimes(pages = []) {
  const allowed = new Set();
  for (const rawPage of pages) {
    const page = rawPage?.toDict ? rawPage.toDict() : rawPage ?? {};
    const text = String(page.markdown || page.text || "");
    let inQuickStart = false;
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (/^#{1,4}\s+.*quick start/i.test(line)) {
        inQuickStart = true;
        continue;
      }
      if (inQuickStart && /^#{1,4}\s+/.test(line)) inQuickStart = false;
      if (!inQuickStart || !/^[-*]\s+/.test(line)) continue;
      const label = line.replace(/^[-*]\s+/, "").replace(/\s+[-–—:].*$/, "").trim();
      if (label) allowed.add(label.toLowerCase());
    }
  }
  return allowed;
}

function sanitizeGroundedAnswer(value, allowedRuntimes = new Set()) {
  let inRuntimeList = false;
  return String(value ?? "")
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      if (/\b(?:quick start|runtimes?)\b/i.test(trimmed)) inRuntimeList = true;
      else if (/^#{1,4}\s+/.test(trimmed)) inRuntimeList = false;
      if (!inRuntimeList || !/^\s*[-*]\s+/.test(line) || !allowedRuntimes.size) {
        return !/^\s*[-*]\s*\[[^\]]+\]\(https?:\/\/[^)]+\)/i.test(line);
      }
      const label = trimmed.replace(/^[-*]\s+/, "").replace(/\s+\(.*$/, "").trim().toLowerCase();
      return allowedRuntimes.has(label);
    })
    .join("\n")
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/gi, "$1")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseGroundedAnswer(value, pageCount, pages = []) {
  const parsed = parseWebJson(value);
  if (!parsed.error && parsed.value && typeof parsed.value === "object") {
    const answer = sanitizeGroundedAnswer(parsed.value.answer ?? parsed.value.response ?? "", extractExplicitRuntimes(pages));
    const evidenceMarker = parsed.value.evidence_pages ?? parsed.value.evidencePages ?? parsed.value.page_numbers ?? parsed.value.pageNumbers;
    const pageNumbers = Array.isArray(evidenceMarker)
      ? evidenceMarker.map(Number).filter(Number.isInteger)
      : [];
    const allEvidence = typeof evidenceMarker === "string" && /^(?:all|todos?|todas?)$/i.test(evidenceMarker.trim());
    // `evidence_pages: "all"` is the machine-readable grounding contract.
    // Requiring every page title to be repeated in prose polluted long
    // research answers with a title catalogue and encouraged models to spend
    // their budget on navigation text.  Keep title coverage as a fallback for
    // legacy numeric markers, but let an explicit `all` marker stand on its
    // own because the route already controls the fetched page set.
    const labels = pageLabelCoverage(answer, pages);
    const explicitCoverage = allEvidence || (pageNumbers.length >= pageCount && pageNumbers.every((n) => n >= 1 && n <= pageCount));
    const groundedCoverage = allEvidence ? true : labels.valid && explicitCoverage;
    const markerMissing = evidenceMarker === undefined || evidenceMarker === null;
    return {
      answer,
      pageNumbers: [...new Set(pageNumbers)].sort((a, b) => a - b),
      structured: true,
      raw: String(value ?? ""),
      error: /^(?:answer|page_numbers|evidence_pages|selected_urls)\s*[:=\[]?/i.test(answer)
        ? "answer contains protocol fields instead of content"
        : "",
      coverage: groundedCoverage || (markerMissing && labels.valid),
    };
  }
  return {
    answer: sanitizeGroundedAnswer(value, extractExplicitRuntimes(pages)),
    pageNumbers: [],
    structured: false,
    raw: String(value ?? ""),
    error: parsed.error,
    coverage: false,
  };
}

/**
 * Grounded Q&A with an explicit live-search contract:
 * search → Markdown index → provider URL selection → HandoffKit fetch/Markdown
 * → provider answer. Selection and answer are fail-closed when the provider
 * returns malformed JSON or does not acknowledge every evidence page.
 */
export async function runWebGroundedAnswer({
  query,
  question = "",
  maxPages = 3,
  maxResults = 8,
  maxSubQueries = 3,
  searchQueries = null,
  seedResults = [],
  allowHosts = [],
  denyHosts = [],
  providers = undefined,
  userBrowser = null,
  defaultBrowser = null,
  provider = null,
  selectionProvider = undefined,
  model = "",
  transport = null,
  format = "markdown",
  strictGrounding = true,
  answerRetries = 1,
  searchConcurrency = 1,
  searchDelayMs = 350,
  contextMaxChars = 12000,
  selectionMaxTokens = 500,
  answerMaxTokens = 1600,
  selectionTemperature = 0,
  answerTemperature = 0.1,
  selectionNumCtx = 8192,
  answerNumCtx = 32768,
  evidenceSections = null,
  evidenceMaxTokens = 1200,
  evidenceNumCtx = 8192,
  evidenceRetries = 1,
  evidenceConcurrency = 1,
  evidenceContextMaxChars = 12000,
  synthesisSections = null,
  synthesisMaxTokens = 1200,
  synthesisNumCtx = 8192,
  synthesisRetries = 1,
  dossierComposeMode = "model",
  dossierFallback = false,
  answerValidator = null,
} = {}) {
  let browser;
  try {
    browser = await import("@handoffkit/browser");
  } catch (cause) {
    throw new Error("Install @handoffkit/browser to use runWebGroundedAnswer().", { cause });
  }
  const q = String(query || question || "").trim();
  if (!q) throw new TypeError("runWebGroundedAnswer requires query.");
  const limit = Math.max(1, Math.min(Number(maxPages) || 3, 8));
  const resultsLimit = Math.max(limit, Math.min(Number(maxResults) || 8, 32));
  const rawSearchQueries = Array.isArray(searchQueries) ? searchQueries : [q];
  const searchQueryList = [];
  const seenSearchQueries = new Set();
  for (const rawSearchQuery of rawSearchQueries) {
    const searchQuery = String(rawSearchQuery ?? "").trim();
    const key = searchQuery.toLowerCase();
    if (!searchQuery || seenSearchQueries.has(key)) continue;
    seenSearchQueries.add(key);
    searchQueryList.push(searchQuery);
    if (searchQueryList.length >= Math.max(1, Math.min(Number(maxSubQueries) || 3, 8))) break;
  }
  if (!searchQueryList.length) searchQueryList.push(q);
  const searchResults = await mapWithConcurrency(searchQueryList, Math.max(1, Math.min(Number(searchConcurrency) || 1, 4)), async (searchQuery, queryIndex) => {
    const delay = Math.max(0, Math.min(Number(searchDelayMs) || 0, 10000));
    if (delay > 0 && queryIndex > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    return browser.webSearch(searchQuery, {
      transport,
      maxResults: resultsLimit,
      timeoutMs: 30000,
      allowHosts,
      denyHosts,
      providers,
      userBrowser: userBrowser ?? defaultBrowser,
    });
  });
  const mergedSearchHits = new Map();
  const searchErrors = [];
  const searchProviderCodes = new Set();
  const searchProvidersUsed = new Set();
  const searchEngines = new Set();
  for (const [queryIndex, searchResult] of searchResults.entries()) {
    for (const providerName of searchResult.providers_used ?? []) searchProvidersUsed.add(providerName);
    for (const providerCode of searchResult.provider_codes ?? []) searchProviderCodes.add(providerCode);
    if (searchResult.engine) searchEngines.add(searchResult.engine);
    for (const error of searchResult.errors ?? []) searchErrors.push(`${searchQueryList[queryIndex]}: ${error}`);
    for (const [hitIndex, hit] of (searchResult.results ?? []).entries()) {
      const url = String(hit.url ?? "").trim();
      if (!url) continue;
      const existing = mergedSearchHits.get(url);
      if (existing) {
        existing.query_matches += 1;
        existing.score = Math.max(existing.score, Number(hit.score ?? 0)) + 5;
        if (!existing.query_indexes.includes(queryIndex)) existing.query_indexes.push(queryIndex);
        continue;
      }
      mergedSearchHits.set(url, {
        title: hit.title || url,
        url,
        score: Number(hit.score ?? 0) + (resultsLimit - hitIndex),
        query_matches: 1,
        query_indexes: [queryIndex],
      });
    }
  }
  for (const [seedIndex, rawSeed] of (Array.isArray(seedResults) ? seedResults : []).entries()) {
    if (!rawSeed || typeof rawSeed !== "object") continue;
    const url = String(rawSeed.url || "").trim();
    if (!url) continue;
    const rawSourceQueries = Array.isArray(rawSeed.sourceQueries)
      ? rawSeed.sourceQueries
      : Array.isArray(rawSeed.source_queries) ? rawSeed.source_queries : [];
    const queryIndexes = rawSourceQueries
      .map((sourceQuery) => searchQueryList.findIndex((query) => query.toLowerCase() === String(sourceQuery).trim().toLowerCase()))
      .filter((index) => index >= 0);
    const existing = mergedSearchHits.get(url);
    if (existing) {
      existing.score = 100000 - seedIndex;
      existing.seeded = true;
      for (const queryIndex of queryIndexes) if (!existing.query_indexes.includes(queryIndex)) existing.query_indexes.push(queryIndex);
      existing.query_matches = Math.max(existing.query_matches, existing.query_indexes.length, 1);
      continue;
    }
    mergedSearchHits.set(url, {
      title: String(rawSeed.title || url),
      url,
      score: 100000 - seedIndex,
      query_matches: Math.max(1, queryIndexes.length),
      query_indexes: queryIndexes,
      seeded: true,
    });
  }
  const rankedMergedHits = [...mergedSearchHits.values()]
    .sort((a, b) => b.score - a.score || b.query_matches - a.query_matches || a.url.localeCompare(b.url))
  const diversifiedHits = [];
  const diversifiedUrls = new Set();
  for (let queryIndex = 0; queryIndex < searchQueryList.length && diversifiedHits.length < resultsLimit; queryIndex += 1) {
    const candidate = rankedMergedHits.find((hit) => hit.query_indexes.includes(queryIndex) && !diversifiedUrls.has(hit.url));
    if (!candidate) continue;
    diversifiedHits.push(candidate);
    diversifiedUrls.add(candidate.url);
  }
  for (const candidate of rankedMergedHits) {
    if (diversifiedHits.length >= resultsLimit) break;
    if (diversifiedUrls.has(candidate.url)) continue;
    diversifiedHits.push(candidate);
    diversifiedUrls.add(candidate.url);
  }
  const mergedResults = diversifiedHits.map(({ query_matches: _queryMatches, query_indexes: sourceQueryIndexes, ...hit }) => ({
    ...hit,
    source_queries: sourceQueryIndexes.map((index) => searchQueryList[index]).filter(Boolean),
  }));
  const search = {
    success: mergedResults.length > 0,
    query: q,
    queries: searchQueryList,
    keywords: searchQueryList.join(" "),
    results: mergedResults,
    count: mergedResults.length,
    providers_requested: searchResults[0]?.providers_requested ?? (Array.isArray(providers) ? providers.map((item) => String(item)) : []),
    providers_used: [...searchProvidersUsed],
    errors: searchErrors,
    provider_codes: [...searchProviderCodes],
    engine: [...searchEngines].join("+"),
    error_code: mergedResults.length ? "" : [...searchProviderCodes][0] || "no_results",
    error: mergedResults.length ? "" : "no search results",
  };
  const excludedUrls = [];
  const candidates = (search.results ?? []).map((item, index) => ({
    rank: index + 1,
    title: item.title || "",
    url: item.url || "",
    source_queries: Array.isArray(item.source_queries) ? [...item.source_queries] : [],
  })).filter((candidate) => {
    const allowed = isFetchableWebCandidate(candidate.url);
    if (!allowed && candidate.url) excludedUrls.push(candidate.url);
    return allowed;
  });
  const searchMarkdown = candidateMarkdownForWebAnswer(q, candidates);
  const selection = {
    mode: provider ? "provider" : "ranked_fallback",
    raw: "",
    repair_raw: "",
    error: "",
    repair_error: "",
    selected_urls: [],
    valid: false,
    search_error_code: search.error_code,
  };
  const planner = selectionProvider ?? provider;
  if (planner && candidates.length) {
    const plannerPrompt = [
      "Selecciona las páginas actuales que el agente debe leer.",
      "Usa exclusivamente el índice Markdown. Copia URLs literalmente; no inventes URLs.",
      `Elige como máximo ${limit} páginas y cubre la consulta completa.`,
      'Responde SOLO JSON válido: {"selected_urls":["URL exacta"]}.',
      "No uses objetos ni explicaciones.",
      searchQueryList.length > 1
        ? `Prioriza cobertura de consultas distintas cuando sea posible. Consultas: ${searchQueryList.join(" | ")}`
        : "",
      "",
      `Consulta: ${q}`,
      "",
      searchMarkdown,
    ].join("\n");
    selection.raw = await webProviderText(planner, plannerPrompt, {
      temperature: selectionTemperature,
      max_tokens: selectionMaxTokens,
      num_ctx: selectionNumCtx,
      response_format: { type: "json_object" },
    });
    let parsed = parseWebJson(selection.raw);
    selection.selected_urls = ensureWebQueryCoverage(
      selectWebAnswerUrls(parsed.value, candidates, limit),
      candidates,
      searchQueryList,
      limit,
    );
    if (!selection.selected_urls.length && Number(answerRetries) > 0) {
      const repairPrompt = [
        "La salida anterior no cumplió el contrato.",
        'Devuelve SOLO JSON válido con esta forma exacta: {"selected_urls":["URL exacta"]}.',
        `Elige hasta ${limit} URLs copiadas literalmente del índice; no incluyas explicación.`,
        "",
        searchMarkdown,
      ].join("\n");
      selection.repair_raw = await webProviderText(planner, repairPrompt, {
        temperature: selectionTemperature,
        max_tokens: selectionMaxTokens,
        num_ctx: selectionNumCtx,
        response_format: { type: "json_object" },
      });
      parsed = parseWebJson(selection.repair_raw);
      selection.repair_error = parsed.error;
      selection.selected_urls = ensureWebQueryCoverage(
        selectWebAnswerUrls(parsed.value, candidates, limit),
        candidates,
        searchQueryList,
        limit,
      );
    }
    selection.error = parsed.error;
  } else {
    selection.selected_urls = ensureWebQueryCoverage(
      candidates.slice(0, limit).map((candidate) => candidate.url),
      candidates,
      searchQueryList,
      limit,
    );
  }
  selection.valid = Boolean(search.success && searchMarkdown && selection.selected_urls.length);

  let pack = null;
  if (selection.valid) {
    pack = await browser.gatherWebResearch({
      query: q,
      seedOnly: true,
      autoSearch: false,
      seedUrls: selection.selected_urls,
      maxPages: limit,
      maxSubQueries,
      allowHosts,
      denyHosts,
      providers,
      userBrowser: userBrowser ?? defaultBrowser,
      transport,
      format,
      contextMaxChars,
    });
    const expectedPages = selection.selected_urls.length;
    const fallbackUrls = candidates
      .map((candidate) => candidate.url)
      .filter((url) => url && !selection.selected_urls.includes(url));
    if (pack.pages_ok < expectedPages && fallbackUrls.length) {
      const fetchedUrls = new Set((pack.pages ?? [])
        .map((page) => page?.url || page?.final_url || page?.finalUrl || "")
        .filter(Boolean));
      const retryUrls = fallbackWebQueryCoverage(
        candidates,
        selection.selected_urls,
        [...fetchedUrls],
        searchQueryList,
        limit,
      );
      const retryPack = await browser.gatherWebResearch({
        query: q,
        seedOnly: true,
        autoSearch: false,
        seedUrls: retryUrls,
        maxPages: limit,
        maxSubQueries,
        allowHosts,
        denyHosts,
        providers,
        userBrowser: userBrowser ?? defaultBrowser,
        transport,
        format,
        contextMaxChars,
      });
      if (retryPack.pages_ok > pack.pages_ok) pack = retryPack;
      selection.fallback_urls = fallbackUrls;
      selection.selected_urls = retryUrls;
      selection.fallback_used = true;
    }
    selection.expected_pages = selection.selected_urls.length;
    selection.fetched_pages = pack.pages_ok;
    selection.fetch_complete = pack.pages_ok >= selection.selected_urls.length;
  } else {
    pack = new browser.ResearchPack({
      enabled: true,
      used: false,
      error: search.success ? "no valid URLs selected" : search.error || "search failed",
      mode: "search_then_select_then_fetch",
      transport: transport?.name?.() ?? "",
      metadata: { selection_failed: true },
    });
  }
  pack.metadata = {
    ...(pack.metadata ?? {}),
    answer_flow: "live_search_markdown_select_explore_markdown_answer",
    search_queries: [...searchQueryList],
    search_results_markdown: searchMarkdown,
    search_count: search.count ?? 0,
    search_concurrency: Math.max(1, Math.min(Number(searchConcurrency) || 1, 4)),
    search_delay_ms: Math.max(0, Math.min(Number(searchDelayMs) || 0, 10000)),
    seed_results_count: (Array.isArray(seedResults) ? seedResults : []).length,
    search_error_code: search.error_code,
    search_provider_codes: [...search.provider_codes],
    selected_urls: [...selection.selected_urls],
    selected_urls_valid: selection.valid,
    selection_mode: selection.mode,
    planner_raw: selection.raw,
    planner_repair_raw: selection.repair_raw,
    planner_error: selection.error,
    fallback_urls: selection.fallback_urls ?? [],
    fallback_used: Boolean(selection.fallback_used),
    excluded_urls: excludedUrls,
    expected_pages: selection.expected_pages ?? 0,
    fetched_pages: selection.fetched_pages ?? 0,
    fetch_complete: Boolean(selection.fetch_complete),
  };

  const section = browser.researchPromptSection(pack);
  const normalizedEvidenceSections = normalizeEvidenceSections(evidenceSections);
  const evidenceDossier = selection.fetch_complete && provider && normalizedEvidenceSections.length
    ? await buildEvidenceDossier({
        sections: normalizedEvidenceSections,
        pages: pack.pages ?? [],
        candidates,
        provider,
        question: question || q,
        maxTokens: evidenceMaxTokens,
        numCtx: evidenceNumCtx,
        retries: evidenceRetries,
        concurrency: evidenceConcurrency,
        contextMaxChars: evidenceContextMaxChars,
      })
    : { enabled: false, valid: true, degraded: false, sections: [], errors: [], warnings: [] };
  const normalizedSynthesisSections = normalizeEvidenceSections(synthesisSections);
  if (evidenceDossier.enabled && evidenceDossier.valid && provider && normalizedSynthesisSections.length) {
    const synthesis = await buildSynthesisDossier({
      sections: normalizedSynthesisSections,
      evidenceDossier,
      provider,
      question: question || q,
      maxTokens: synthesisMaxTokens,
      numCtx: synthesisNumCtx,
      retries: synthesisRetries,
    });
    evidenceDossier.sections.push(...synthesis.sections);
    evidenceDossier.warnings.push(...synthesis.warnings);
    evidenceDossier.degraded = evidenceDossier.degraded || synthesis.warnings.length > 0;
  }
  const evidence = evidenceDossier.enabled ? evidenceDossierMarkdown(evidenceDossier) : pageEvidenceMarkdown(pack);
  let answer = "";
  let answerRaw = "";
  let answerError = "";
  let answerAttempt = 0;
  let coverage = false;
  let validatorPassed = true;
  let validatorError = "";
  const answerProvider = provider;
  const deterministicDossier = evidenceDossier.enabled && String(dossierComposeMode).toLowerCase() === "deterministic";
  if (deterministicDossier && evidenceDossier.valid) {
    answer = renderEvidenceDossierAnswer(evidenceDossier);
    answerRaw = answer;
    coverage = true;
    if (answerValidator && answer) {
      try {
        const verdict = await answerValidator({ answer, query: q, pages: pack.pages, research: pack, evidenceDossier });
        validatorPassed = typeof verdict === "object" ? Boolean(verdict.valid) : Boolean(verdict);
        if (verdict && typeof verdict === "object" && typeof verdict.answer === "string") answer = verdict.answer.trim();
        if (!validatorPassed) validatorError = typeof verdict === "object" ? String(verdict.error || "answer validator rejected deterministic dossier") : "answer validator rejected deterministic dossier";
      } catch (error) {
        validatorPassed = false;
        validatorError = String(error?.message ?? error);
      }
    }
  } else if (answerProvider && pack.pages_ok > 0 && selection.fetch_complete && evidenceDossier.valid) {
    const answerPrompt = [
      "No escribas http(s), enlaces Markdown ni atribuyas enlaces de navegación a runtimes; usa solo listas explícitas de Quick Start.",
      evidenceDossier.enabled
        ? "Usa exclusivamente el dossier estructurado. Incluye cada hallazgo SUPPORTED y conserva cada NOT FOUND como límite explícito."
        : "Lee TODAS las páginas Markdown recuperadas y responde la pregunta solo con esos datos.",
      "No hagas otra búsqueda ni uses memoria externa.",
      "Si una subpregunta no está respaldada por las páginas, di explícitamente que la evidencia disponible no permite responderla.",
      "No afirmes que un método es dominante, más usado o preferido sin una fuente recuperada que mida esa adopción.",
      "No atribuyas a un artículo un mecanismo que su página no describa literalmente.",
      "Devuelve SOLO JSON válido con esta forma:",
      "Cubre explÃ­citamente Goodman-Bacon, Callaway-Sant'Anna, Sun-Abraham, Borusyak-Jaravel-Spiess, did2s y Roth/Rambachan-Roth; si la evidencia de alguno falta, declÃ¡ralo como no demostrado.",
      "REQUIRED LITERAL NAMES: the answer must contain the strings Goodman-Bacon, Callaway-Sant'Anna, Sun-Abraham, Borusyak, did2s, and Roth (or Rambachan-Roth). Use one short headed paragraph per method before the comparison and limitation sections.",
      '{"answer":"respuesta Markdown sin URLs ni citas","evidence_pages":"all"}',
      'evidence_pages debe ser "all" solo después de leer todas las páginas; si un dato falta, indícalo.',
      "No incluyas sección de fuentes, URLs, capacidades no demostradas ni cifras inventadas.",
      "",
      `Pregunta: ${question || q}`,
      "",
      evidence || "[No hay evidencia]",
      "",
      'REGLA FINAL: evidence_pages debe ser "all". No conviertas los títulos de página en un catálogo dentro de la respuesta; dedica el espacio a la síntesis solicitada.',
      "Incluye también cualquier lista explícita de runtimes, Quick Start o formatos que aparezca en las páginas.",
    ].join("\n");
    const attempts = Math.max(1, Math.min(Number(answerRetries) + 1, 3));
    for (answerAttempt = 1; answerAttempt <= attempts; answerAttempt += 1) {
      const prompt = answerAttempt === 1
        ? answerPrompt
        : [
            validatorError ? "Reescribe la respuesta anterior eliminando URLs, enlaces Markdown y elementos de navegación; conserva solo hechos de la evidencia." : "",
            validatorError || answerError ? `Motivo exacto de rechazo: ${validatorError || answerError}` : "",
            validatorError?.includes("adoption/dominance")
              ? "STRICT RETRY: do not use dominant, dominance, workhorse, gaining traction, hierarchy, preferred, most used, or any ranking. Write exactly this limitation instead: The retrieved pages contain no bibliometric counts or AER/QJE/JPE adoption rates, so no dominant method can be established."
              : "",
            validatorError?.includes("missing required methods")
              ? "STRICT RETRY: explicitly name Goodman-Bacon (2021), Callaway-Sant'Anna, Sun-Abraham, Borusyak-Jaravel-Spiess, did2s, and Roth/Rambachan-Roth, or say the retrieved evidence is insufficient for the missing item."
              : "",
            validatorError?.includes("adoption/dominance")
              ? "No afirmes dominancia, jerarquÃ­a, popularidad, workhorse, uso mayoritario ni tracciÃ³n. Sustituye esa secciÃ³n por: La evidencia recuperada no contiene conteos bibliomÃ©tricos ni tasas de adopciÃ³n AER/QJE/JPE; por tanto no permite determinar un mÃ©todo dominante."
              : "",
            validatorError?.includes("missing required methods")
              ? "Incluye una secciÃ³n explÃ­cita para Goodman-Bacon (2021), Callaway-Sant'Anna, Sun-Abraham, Borusyak-Jaravel-Spiess, did2s y Roth/Rambachan-Roth; si una pÃ¡gina no lo respalda, dilo en vez de inventar."
              : "",
            evidenceDossier.enabled ? "Conserva todos los hallazgos SUPPORTED y los límites NOT FOUND del dossier." : "Menciona al menos un identificador distintivo del título de CADA página.",
            "Corrige la respuesta anterior: faltó cubrir evidencia o incumplió JSON.",
            'Devuelve SOLO {"answer":"...","evidence_pages":"all"} válido.',
            'evidence_pages debe ser exactamente "all" después de leer todas las páginas.',
            "No agregues URLs ni hechos fuera de las páginas.",
            "",
            answerPrompt,
            "",
            `Respuesta anterior: ${answerRaw}`,
          ].join("\n");
      answerRaw = await webProviderText(answerProvider, prompt, {
        temperature: answerTemperature,
        max_tokens: answerMaxTokens,
        num_ctx: answerNumCtx,
        response_format: { type: "json_object" },
      });
      const parsed = parseGroundedAnswer(answerRaw, pack.pages_ok, pack.pages);
      answer = parsed.answer;
      coverage = parsed.coverage;
      answerError = parsed.error;
      validatorPassed = true;
      validatorError = "";
      if (answerValidator && answer && !answerError) {
        try {
          const verdict = await answerValidator({ answer, query: q, pages: pack.pages, research: pack, evidenceDossier });
          if (verdict && typeof verdict === "object" && typeof verdict.answer === "string") {
            answer = verdict.answer.trim();
            coverage = evidenceDossier.enabled ? true : pageLabelCoverage(answer, pack.pages).valid;
          }
          validatorPassed = typeof verdict === "object" ? Boolean(verdict.valid) : Boolean(verdict);
          if (!validatorPassed) validatorError = typeof verdict === "object" ? String(verdict.error || "answer validator rejected output") : "answer validator rejected output";
        } catch (error) {
          validatorPassed = false;
          validatorError = String(error?.message ?? error);
        }
      }
      if (answer && (!strictGrounding || coverage) && !answerError && validatorPassed) break;
    }
  }
  if ((!answer || answerError || !validatorPassed || (strictGrounding && !coverage))
      && dossierFallback && evidenceDossier.enabled && evidenceDossier.valid) {
    const fallbackAnswer = renderEvidenceDossierAnswer(evidenceDossier);
    let fallbackValid = Boolean(fallbackAnswer);
    let fallbackError = "";
    answer = fallbackAnswer;
    if (answerValidator && fallbackAnswer) {
      try {
        const verdict = await answerValidator({
          answer: fallbackAnswer,
          query: q,
          pages: pack.pages,
          research: pack,
          evidenceDossier,
        });
        fallbackValid = typeof verdict === "object" ? Boolean(verdict.valid) : Boolean(verdict);
        fallbackError = fallbackValid ? "" : typeof verdict === "object"
          ? String(verdict.error || "answer validator rejected dossier fallback")
          : "answer validator rejected dossier fallback";
        if (verdict && typeof verdict === "object" && typeof verdict.answer === "string") answer = verdict.answer.trim();
      } catch (error) {
        fallbackValid = false;
        fallbackError = String(error?.message ?? error);
      }
    }
    if (fallbackValid) {
      coverage = true;
      answerError = "";
      validatorPassed = true;
      validatorError = "";
    } else {
      answer = "";
      validatorPassed = false;
      validatorError = fallbackError;
    }
  }
  const answerValid = Boolean(answer && pack.pages_ok > 0 && (!strictGrounding || coverage) && !answerError && validatorPassed);
  const result = {
    success: Boolean(selection.valid && selection.fetch_complete && pack.pages_ok > 0 && (!answerProvider || answerValid)),
    query: q,
    research: pack.toDict(),
    prompt_section: section,
    answer: answerValid ? answer : "",
    model: model || provider?.model || "",
    error_code: !selection.valid
      ? "web_answer_selection_failed"
      : !selection.fetch_complete
        ? "web_answer_incomplete_evidence"
      : !evidenceDossier.valid
        ? "web_answer_evidence_extraction_failed"
      : pack.pages_ok === 0
        ? "web_answer_no_pages"
        : answerProvider && !answerValid
          ? "web_answer_grounding_failed"
          : "",
    selection: {
      ...selection,
      candidates,
      search_success: Boolean(search.success),
      search_error_code: search.error_code,
      search_provider_codes: [...search.provider_codes],
      search_errors: search.errors ?? [],
    },
    answer_audit: {
      valid: answerValid,
      strict_grounding: Boolean(strictGrounding),
      pages_ok: pack.pages_ok,
      expected_pages: selection.expected_pages ?? 0,
      evidence_complete: Boolean(selection.fetch_complete),
      coverage,
      attempts: answerAttempt,
      raw: answerRaw,
      error: answerError || validatorError,
      validator_passed: validatorPassed,
      evidence_dossier_enabled: evidenceDossier.enabled,
      evidence_dossier_valid: evidenceDossier.valid,
      evidence_dossier_degraded: Boolean(evidenceDossier.degraded),
      evidence_dossier_errors: evidenceDossier.errors,
      evidence_dossier_warnings: evidenceDossier.warnings,
    },
    evidence_dossier: evidenceDossier,
  };
  return result;
}

