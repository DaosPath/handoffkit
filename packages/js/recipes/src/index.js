import {
  Agent,
  HandoffProtocol,
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
    this.panel = panel.map(item => item instanceof PanelResponse ? item : new PanelResponse(item));
    this.consensus = consensus || [];
    this.contradictions = contradictions || [];
    this.coverageGaps = coverageGaps || [];
    this.uniqueInsights = uniqueInsights || [];
    this.blindSpots = blindSpots || [];
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

export async function runModelFusionPanel({ task = DEFAULT_FUSION_TASK, provider = "opencode-go", models = DEFAULT_FUSION_MODELS, real = false, timeout = 300 } = {}) {
  let panel;
  let mode;
  if (real) {
    panel = await realFusionPanel(provider, splitModels(models), task, { timeout });
    mode = "real-provider-panel";
  } else {
    panel = offlineFusionPanel(task);
    mode = "offline-deterministic-panel";
  }
  const report = judgeFusionPanel(task, panel, { mode });
  return report;
}

export async function realFusionPanel(provider, models, task = DEFAULT_FUSION_TASK, { timeout = 300 } = {}) {
  let providersModule;
  try {
    providersModule = await import("@handoffkit/providers");
  } catch (err) {
    throw new Error("The '@handoffkit/providers' package is required to run a real fusion panel. Install it first.");
  }
  const { ProviderSelector, ModelCandidate } = providersModule;
  const selector = new ProviderSelector();
  const roles = [
    "broad diagnostician",
    "mechanism checker",
    "adversarial reviewer",
    "retrieval planner",
  ];
  const responses = [];
  for (let index = 0; index < models.length; index++) {
    const model = models[index];
    const role = roles[index % roles.length];
    const candidate = new ModelCandidate({ provider, model, priority: index });
    try {
      const spec = selector.getProvider(candidate.provider);
      const providerInstance = spec.factory(candidate.model);
      if (timeout) {
        providerInstance.timeout = timeout;
      }
      const prompt = _panelPrompt(task, role);
      const res = await providerInstance.generate(prompt, { temperature: 0 });
      responses.push(
        new PanelResponse({
          model: `${provider}/${model}`,
          role,
          answer: res.trim().replace(/\n/g, " ").substring(0, 800),
          strengths: ["real provider response"],
          risks: ["cost, latency, and provider availability"],
          confidence: "model-reported",
        })
      );
    } catch (exc) {
      responses.push(
        new PanelResponse({
          model: `${provider}/${model}`,
          role,
          answer: `Provider failed safely: ${String(exc.message || exc).substring(0, 240)}`,
          strengths: [],
          risks: ["provider call failed"],
          confidence: "failed",
        })
      );
    }
  }
  return responses;
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

  static fromDict(data) {
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

  static fromDict(data) {
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

  static fromDict(data) {
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

  static fromDict(data) {
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
    this.source = source instanceof MediaAsset ? source : MediaAsset.fromDict(source);
    this.targetLanguage = targetLanguage;
    this.transcriptSegments = transcriptSegments.map(item => item instanceof TranscriptSegment ? item : TranscriptSegment.fromDict(item));
    this.speakers = speakers.map(item => item instanceof SpeakerProfile ? item : SpeakerProfile.fromDict(item));
    this.dubbingSegments = dubbingSegments.map(item => item instanceof DubbingSegment ? item : DubbingSegment.fromDict(item));
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

export function buildDubbingPlan(segments, translations, speakers = []) {
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

// Async Node.js filesystem integrations with dynamic imports
export async function writeTranscriptJSON(segments, filePath) {
  const { writeFile, mkdir } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  await mkdir(dirname(filePath), { recursive: true });
  const payload = { segments: segments.map(s => s.toDict()) };
  await writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
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
  const { writeFile, mkdir } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  await mkdir(dirname(filePath), { recursive: true });
  const content = formatSRT(segments, { translated });
  await writeFile(filePath, content, "utf8");
  return filePath;
}

export async function ffmpegAvailable(ffmpeg = "ffmpeg") {
  const { execSync } = await import("node:child_process");
  try {
    const checkCmd = process.platform === "win32" ? `where ${ffmpeg}` : `which ${ffmpeg}`;
    execSync(checkCmd, { stdio: "ignore" });
    return true;
  } catch (_) {
    return false;
  }
}

export async function extractAudio(videoPath, audioPath, { ffmpeg = "ffmpeg", overwrite = false } = {}) {
  const { exec } = await import("node:child_process");
  const { mkdir } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  await mkdir(dirname(audioPath), { recursive: true });
  
  const args = [
    ffmpeg,
    overwrite ? "-y" : "-n",
    "-i",
    `"${videoPath}"`,
    "-vn",
    "-acodec pcm_s16le",
    `"${audioPath}"`,
  ].join(" ");
  
  await new Promise((resolve, reject) => {
    exec(args, (error, stdout, stderr) => {
      if (error) reject(new Error(`ffmpeg failed: ${stderr || error.message}`));
      else resolve();
    });
  });
  
  return new MediaAsset({
    path: audioPath,
    mediaType: "audio",
    metadata: { source: videoPath },
  });
}

export async function muxAudio(videoPath, audioPath, outputPath, { ffmpeg = "ffmpeg", overwrite = false } = {}) {
  const { exec } = await import("node:child_process");
  const { mkdir } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  await mkdir(dirname(outputPath), { recursive: true });
  
  const args = [
    ffmpeg,
    overwrite ? "-y" : "-n",
    "-i",
    `"${videoPath}"`,
    "-i",
    `"${audioPath}"`,
    "-map 0:v:0",
    "-map 1:a:0",
    "-c:v copy",
    "-c:a aac",
    `"${outputPath}"`,
  ].join(" ");
  
  await new Promise((resolve, reject) => {
    exec(args, (error, stdout, stderr) => {
      if (error) reject(new Error(`ffmpeg failed: ${stderr || error.message}`));
      else resolve();
    });
  });
  
  return new MediaAsset({
    path: outputPath,
    mediaType: "video",
    metadata: { audio: audioPath },
  });
}

function _formatTimeRange(start, end) {
  return `${formatSRTTimestamp(start)} -> ${formatSRTTimestamp(end)}`;
}
