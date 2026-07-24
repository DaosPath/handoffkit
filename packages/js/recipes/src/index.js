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
  constructor(recipe, { protocol = new HandoffProtocol({ mode: "hybrid_state" }) } = {}) {
    this.recipe = (recipe instanceof Recipe ? recipe : new Recipe(recipe)).validate();
    this.protocol = protocol;
  }

  run(initialTask = "") {
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
// Parity with packages/python/handoffkit/recipes/media.py
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
      description: "Edit timing, copy, cuts, and structure of media or transcripts.",
      inputs: ["assets", "transcript", "edition_ops"],
      outputs: ["assets", "transcript", "edition_ops"],
      agentRole: "media-editor",
    }),
    new MediaOperationSpec({
      name: "transcription",
      description: "Speech-to-text into timestamped transcript segments.",
      inputs: ["audio", "video"],
      outputs: ["transcript_segments"],
      agentRole: "transcriber",
    }),
    new MediaOperationSpec({
      name: "translation",
      description: "Translate transcript or script text into a target language.",
      inputs: ["transcript_segments", "target_language"],
      outputs: ["dubbing_segments", "translations"],
      agentRole: "translator",
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
