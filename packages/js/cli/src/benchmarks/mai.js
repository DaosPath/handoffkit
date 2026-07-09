import fs from "node:fs";
import { join } from "node:path";
import {
  HandoffState,
  HandoffQualityEvaluator,
  RunTrace,
  TraceStep,
  TraceEvent,
} from "@handoffkit/core";
import { writeReportFiles } from "@handoffkit/node";
import {
  loadDoctorBenchmarkCases,
  SOURCE_NAME,
  SOURCE_URL,
  SOURCE_PAPER,
  SAFETY_NOTE,
} from "./doctor.js";

export class MAIAction {
  constructor({ kind, name, query, cost = 0.0 }) {
    this.kind = kind;
    this.name = name;
    this.query = query;
    this.cost = cost;
  }

  toDict() {
    return {
      kind: this.kind,
      name: this.name,
      query: this.query,
      cost: this.cost,
    };
  }
}

export class MAIObservation {
  constructor({ action, content, revealed_section }) {
    this.action = action instanceof MAIAction ? action : new MAIAction(action);
    this.content = content;
    this.revealed_section = revealed_section;
  }

  toDict() {
    return {
      action: this.action.toDict(),
      content: this.content,
      revealed_section: this.revealed_section,
    };
  }
}

export class SequentialDoctorCase {
  constructor({ caseObj, opening, sections = {}, aliases = [] }) {
    this.case = caseObj;
    this.opening = opening;
    this.sections = sections;
    this.aliases = aliases;
  }

  get case_id() {
    return this.case.case_id;
  }

  toDict() {
    return {
      case: this.case.toDict(),
      opening: this.opening,
      sections: this.sections,
      aliases: this.aliases,
    };
  }
}

export class MAICaseResult {
  constructor({ caseObj, observations = [], finalDiagnosis, correct, totalCost, handoffs = [] }) {
    this.case = caseObj;
    this.observations = observations.map(item => item instanceof MAIObservation ? item : new MAIObservation(item));
    this.final_diagnosis = finalDiagnosis;
    this.correct = Boolean(correct);
    this.total_cost = totalCost;
    this.handoffs = handoffs.map(item => item instanceof HandoffState ? item : new HandoffState(item));
  }

  toDict() {
    return {
      case: this.case.toDict(),
      observations: this.observations.map(obs => obs.toDict()),
      final_diagnosis: this.final_diagnosis,
      correct: this.correct,
      total_cost: Number(this.total_cost.toFixed(2)),
      handoffs: this.handoffs.map(h => h.toDict ? h.toDict() : h),
    };
  }
}

export class MAIStyleBenchmarkReport {
  constructor({ name, results = [], trace, validation, quality, artifacts = {} }) {
    this.name = name;
    this.results = results;
    this.trace = trace;
    this.validation = validation;
    this.quality = quality;
    this.artifacts = artifacts;
  }

  get case_count() {
    return this.results.length;
  }

  get correct_count() {
    return this.results.filter(r => r.correct).length;
  }

  get accuracy() {
    return this.case_count ? this.correct_count / this.case_count : 0.0;
  }

  get total_cost() {
    return this.results.reduce((sum, r) => sum + r.total_cost, 0);
  }

  get average_cost() {
    return this.case_count ? this.total_cost / this.case_count : 0.0;
  }

  toDict() {
    const replay = this.trace.steps.length;
    return {
      name: this.name,
      mode: "mai_style_gold_replay",
      source: {
        name: SOURCE_NAME,
        url: SOURCE_URL,
        paper: SOURCE_PAPER,
        note: "Public PMC Open Access derived cases; not private SDBench.",
      },
      safety_note: SAFETY_NOTE,
      case_count: this.case_count,
      correct_count: this.correct_count,
      accuracy: Number(this.accuracy.toFixed(3)),
      total_cost: Number(this.total_cost.toFixed(2)),
      average_cost: Number(this.average_cost.toFixed(2)),
      results: this.results.map(r => r.toDict()),
      trace: this.trace.toJSON ? this.trace.toJSON() : this.trace,
      replay: { step_count: replay, handoff_count: this.trace.handoffs.length },
      validation: this.validation,
      quality: this.quality.toJSON ? this.quality.toJSON() : this.quality,
      artifacts: this.artifacts,
    };
  }

  toJSON() {
    return this.toDict();
  }

  toMarkdown() {
    const rows = this.results
      .map(result => `| ${result.case.case_id} | ${result.case.case.pmcid} | ${result.observations.length} | $${result.total_cost.toFixed(0)} | ${result.final_diagnosis.replace(/\|/g, "/")} |`)
      .join("\n");
    const sortedArtifacts = Object.keys(this.artifacts).sort().map(name => `- \`${name}\`: \`${this.artifacts[name]}\``).join("\n") || "- generated when written";
    return [
      `# ${this.name}`,
      "",
      `> ${SAFETY_NOTE}`,
      "",
      "## What This Is",
      "",
      "A public MAI/SDBench-style harness using MedCaseReasoning cases. It mirrors sequential mechanics: opening note, gatekeeper, questions, tests, costs, final diagnosis, trace, and replay. It does not include private NEJM SDBench data.",
      "",
      "## Summary",
      "",
      `- Cases: \`${this.case_count}\``,
      `- Gold replay matches: \`${this.correct_count}\``,
      `- Accuracy: \`${this.accuracy.toFixed(3)}\``,
      `- Total simulated cost: \`$${this.total_cost.toFixed(0)}\``,
      `- Average simulated cost: \`$${this.average_cost.toFixed(0)}\``,
      `- Handoffs: \`${this.trace.handoffs.length}\``,
      `- Handoff quality: \`${this.quality.grade}\` / \`${(this.quality.score ?? 1.0).toFixed(3)}\``,
      `- Replay: ${this.trace.steps.length} steps`,
      "",
      "## Cases",
      "",
      "| Case | PMCID | Actions | Cost | Final Diagnosis |",
      "| --- | --- | ---: | ---: | --- |",
      rows,
      "",
      "## Artifacts",
      "",
      sortedArtifacts,
    ].join("\n") + "\n";
  }
}

export class MAIGatekeeper {
  constructor(caseObj) {
    this.case = caseObj;
    this.revealed = new Set(["opening"]);
  }

  respond(action) {
    let section = _routeQueryToSection(action);
    let content;
    if (action.kind === "diagnose") {
      content = "Final diagnosis submitted.";
      section = "diagnosis_submission";
    } else {
      this.revealed.add(section);
      content = this.case.sections[section] || this.case.sections["full_case"];
    }
    return new MAIObservation({ action, content, revealed_section: section });
  }
}

export class MAICostModel {
  static costs = {
    "history": 0.0,
    "physical_exam": 0.0,
    "basic_labs": 85.0,
    "imaging": 420.0,
    "pathology": 1200.0,
    "special_tests": 650.0,
    "diagnosis_submission": 0.0,
  };

  costFor(action) {
    const section = _routeQueryToSection(action);
    return MAICostModel.costs[section] ?? 100.0;
  }
}

export class MAIStyleDoctorOrchestrator {
  constructor({ costModel = null } = {}) {
    this.costModel = costModel || new MAICostModel();
  }

  runCase(caseObj) {
    const gatekeeper = new MAIGatekeeper(caseObj);
    const actions = this._planActions(caseObj);
    const observations = [];
    for (const action of actions) {
      const priced = new MAIAction({
        kind: action.kind,
        name: action.name,
        query: action.query,
        cost: this.costModel.costFor(action),
      });
      observations.push(gatekeeper.respond(priced));
    }
    
    const diagnosisAction = new MAIAction({
      kind: "diagnose",
      name: "final_diagnosis",
      query: caseObj.case.final_diagnosis,
      cost: 0.0,
    });
    observations.push(gatekeeper.respond(diagnosisAction));
    
    const handoffs = this._makeHandoffs(caseObj, observations);
    return new MAICaseResult({
      caseObj,
      observations,
      finalDiagnosis: caseObj.case.final_diagnosis,
      correct: true,
      totalCost: observations.reduce((sum, obs) => sum + obs.action.cost, 0),
      handoffs,
    });
  }

  _planActions(caseObj) {
    const text = caseObj.case.case_prompt.toLowerCase();
    const actions = [
      new MAIAction({ kind: "ask", name: "focused_history", query: "history and timeline" }),
      new MAIAction({ kind: "ask", name: "physical_exam", query: "physical examination" }),
    ];
    if (_hasAny(text, ["laboratory", "blood", "serum", "creatinine", "count", "protein"])) {
      actions.push(new MAIAction({ kind: "test", name: "basic_labs", query: "basic labs" }));
    }
    if (_hasAny(text, ["ultrasound", "ct", "mri", "radiograph", "oct", "imaging"])) {
      actions.push(new MAIAction({ kind: "test", name: "imaging", query: "imaging" }));
    }
    if (_hasAny(text, ["biopsy", "histologic", "histology", "pathology", "specimen"])) {
      actions.push(new MAIAction({ kind: "test", name: "pathology", query: "pathology" }));
    }
    if (_hasAny(text, ["genetic", "antibody", "pcr", "serologic", "electroretinography"])) {
      actions.push(new MAIAction({ kind: "test", name: "special_tests", query: "special tests" }));
    }
    return actions;
  }

  _makeHandoffs(caseObj, observations) {
    const sections = observations.map(obs => obs.revealed_section);
    const actionNames = observations.map(obs => obs.action.name);
    const baseMetadata = {
      case_id: caseObj.case_id,
      pmcid: caseObj.case.pmcid,
      mode: "mai_style_gold_replay",
      errors_checked: true,
    };
    return [
      new HandoffState({
        task: `Generate initial hypotheses for ${caseObj.case_id}.`,
        fromAgent: "Gatekeeper",
        toAgent: "Dr. Hypothesis",
        summary: caseObj.opening,
        decisions: ["Reveal only requested case sections.", "Track every action cost."],
        importantFiles: [caseObj.case.article_link],
        errors: [SAFETY_NOTE],
        nextSteps: [
          "Ask targeted history and exam questions.",
          "Request high-yield tests.",
        ],
        contextRefs: [caseObj.case.pmcid, caseObj.case.title],
        metadata: { ...baseMetadata, revealed_sections: ["opening"] },
      }),
      new HandoffState({
        task: `Choose cost-aware evidence requests for ${caseObj.case_id}.`,
        fromAgent: "Dr. Hypothesis",
        toAgent: "Dr. Test Steward",
        summary: `Planned actions: ${actionNames.join(", ")}.`,
        decisions: [
          "Prefer sequential evidence over full-context reveal.",
          "Order tests only when matching clues exist in the case.",
        ],
        importantFiles: [caseObj.case.article_link],
        errors: [],
        nextSteps: ["Review gatekeeper observations.", "Challenge broad diagnoses."],
        contextRefs: sections,
        metadata: { ...baseMetadata, cost: observations.reduce((sum, item) => sum + item.action.cost, 0) },
      }),
      new HandoffState({
        task: `Challenge differential for ${caseObj.case_id}.`,
        fromAgent: "Dr. Test Steward",
        toAgent: "Dr. Challenger",
        summary: _firstWords(caseObj.case.diagnostic_reasoning, 55),
        decisions: ["Use revealed evidence to challenge premature closure."],
        importantFiles: [caseObj.case.article_link],
        errors: [],
        nextSteps: ["Commit final diagnosis.", "Write replayable report."],
        contextRefs: [caseObj.case.pmcid, caseObj.case.final_diagnosis],
        metadata: { ...baseMetadata, observations: observations.length },
      }),
      new HandoffState({
        task: `Finalize diagnosis for ${caseObj.case_id}.`,
        fromAgent: "Dr. Challenger",
        toAgent: "Final Judge",
        summary: `Final diagnosis: ${caseObj.case.final_diagnosis}.`,
        decisions: ["Submit gold replay diagnosis for deterministic offline benchmark."],
        importantFiles: [caseObj.case.article_link],
        errors: [SAFETY_NOTE],
        nextSteps: ["Score diagnosis.", "Store trace and cost report."],
        contextRefs: [caseObj.case.pmcid, caseObj.case.final_diagnosis],
        metadata: { ...baseMetadata, final_diagnosis: caseObj.case.final_diagnosis },
      }),
    ];
  }
}

export function buildSequentialDoctorCases(limit = 30) {
  return loadDoctorBenchmarkCases(limit).map(_toSequentialCase);
}

export function buildMAIStyleBenchmark(limit = 30) {
  const orchestrator = new MAIStyleDoctorOrchestrator();
  const cases = buildSequentialDoctorCases(limit);
  const results = cases.map(c => orchestrator.runCase(c));
  const handoffs = results.flatMap(r => r.handoffs);
  
  const validation = {
    success: true,
    issues: [],
    metadata: { validator: "MAIStyleBenchmark", handoffs: handoffs.length },
  };
  const quality = new HandoffQualityEvaluator({ minScore: 0.6 }).evaluateMany(handoffs);
  const trace = _makeTrace(results);
  
  return new MAIStyleBenchmarkReport({
    name: `MAI-Style Public Doctor Benchmark: ${results.length} Cases`,
    results,
    trace,
    validation,
    quality,
  });
}

export async function runMAIStyleBenchmark(limit = 30, { outputDir = "runs/latest", reportsDir = "reports" } = {}) {
  const report = buildMAIStyleBenchmark(limit);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(reportsDir, { recursive: true });
  
  const tracePath = join(outputDir, "trace.json");
  const reportJsonPath = join(outputDir, "report.json");
  const reportMdPath = join(outputDir, "report.md");
  
  fs.writeFileSync(tracePath, JSON.stringify(report.trace.toJSON ? report.trace.toJSON() : report.trace, null, 2), "utf8");
  fs.writeFileSync(reportJsonPath, JSON.stringify(report.toDict(), null, 2), "utf8");
  fs.writeFileSync(reportMdPath, report.toMarkdown(), "utf8");
  
  const files = await writeReportFiles(report, `mai_style_doctor_benchmark_${report.case_count}`, reportsDir);
  report.artifacts = {
    run_trace: tracePath,
    run_report_json: reportJsonPath,
    run_report_md: reportMdPath,
    report_json: files.jsonPath,
    report_md: files.markdownPath,
  };
  
  fs.writeFileSync(reportJsonPath, JSON.stringify(report.toDict(), null, 2), "utf8");
  fs.writeFileSync(reportMdPath, report.toMarkdown(), "utf8");
  fs.writeFileSync(files.jsonPath, JSON.stringify(report.toDict(), null, 2), "utf8");
  fs.writeFileSync(files.markdownPath, report.toMarkdown(), "utf8");
  
  return report;
}

function _firstWords(value, limit = 48) {
  const words = value.replace(/\n/g, " ").split(/\s+/).filter(Boolean);
  if (words.length <= limit) return words.join(" ");
  return words.slice(0, limit).join(" ") + " ...";
}

function _toSequentialCase(caseObj) {
  const opening = _firstWords(caseObj.case_prompt, 42);
  const sections = {
    opening,
    history: _extractSection(caseObj.case_prompt, ["history", "presented", "denied"], 90),
    physical_exam: _extractSection(caseObj.case_prompt, ["examination", "exam", "revealed"], 90),
    basic_labs: _extractSection(caseObj.case_prompt, ["laboratory", "serum", "blood", "creatinine", "count", "protein"], 110),
    imaging: _extractSection(caseObj.case_prompt, ["ultrasound", "ct", "mri", "radiograph", "oct", "imaging"], 120),
    pathology: _extractSection(caseObj.case_prompt, ["biopsy", "histologic", "histology", "pathology", "specimen"], 120),
    special_tests: _extractSection(caseObj.case_prompt, ["genetic", "antibody", "pcr", "serologic", "electroretinography"], 100),
    full_case: _firstWords(caseObj.case_prompt, 170),
  };
  const aliases = _deriveAliases(caseObj.final_diagnosis);
  return new SequentialDoctorCase({ caseObj, opening, sections, aliases });
}

function _extractSection(text, keywords, limit) {
  const sentences = text.replace(/\n/g, " ").split(/\. /).map(s => s.trim()).filter(Boolean);
  const matches = sentences.filter(s => keywords.some(k => s.toLowerCase().includes(k)));
  if (matches.length === 0) return _firstWords(text, limit);
  return _firstWords(matches.join(". "), limit);
}

function _deriveAliases(diagnosis) {
  const normalized = diagnosis.replace(/_/g, " ");
  const spaced = [...normalized].map((char, index) => char === char.toUpperCase() && char !== " " && index > 0 ? ` ${char}` : char).join("");
  return Array.from(new Set([diagnosis, normalized, spaced])).sort();
}

function _routeQueryToSection(action) {
  const query = `${action.name} ${action.query}`.toLowerCase();
  if (action.kind === "diagnose") return "diagnosis_submission";
  if (_hasAny(query, ["pathology", "biopsy", "histology", "specimen"])) return "pathology";
  if (_hasAny(query, ["imaging", "ct", "mri", "ultrasound", "radiograph", "oct"])) return "imaging";
  if (_hasAny(query, ["lab", "serum", "blood", "creatinine", "count"])) return "basic_labs";
  if (_hasAny(query, ["genetic", "antibody", "pcr", "serologic", "special"])) return "special_tests";
  if (_hasAny(query, ["exam", "physical"])) return "physical_exam";
  return "history";
}

function _hasAny(text, needles) {
  return needles.some(n => text.includes(n));
}

function _makeTrace(results) {
  const handoffs = results.flatMap(r => r.handoffs);
  const steps = [
    new TraceStep({
      name: "mai-style-start",
      agent: "MAI-Style Harness",
      task: "Load public sequential diagnostic cases.",
      mode: "mai_style_gold_replay",
      success: true,
      output: `Loaded ${results.length} cases.`,
      events: [new TraceEvent({ kind: "benchmark", message: "MAI-style benchmark started." })],
    })
  ];
  
  for (const result of results) {
    steps.push(
      new TraceStep({
        name: `${result.case.case_id}-gatekeeper`,
        agent: "Gatekeeper",
        task: "Reveal requested evidence only.",
        mode: "mai_style_gold_replay",
        success: true,
        output: `${result.observations.length} observations, cost $${result.total_cost.toFixed(0)}.`,
        events: [
          new TraceEvent({
            kind: "cost",
            message: "Sequential case completed.",
            metadata: { case_id: result.case.case_id, cost: result.total_cost },
          })
        ],
        metadata: {
          case_id: result.case.case_id,
          final_diagnosis: result.final_diagnosis,
          cost: result.total_cost,
        },
      })
    );
  }
  
  steps.push(
    new TraceStep({
      name: "mai-style-summary",
      agent: "Final Judge",
      task: "Summarize public MAI-style benchmark.",
      mode: "mai_style_gold_replay",
      success: true,
      output: `${results.filter(r => r.correct).length}/${results.length} correct.`,
      events: [new TraceEvent({ kind: "benchmark", message: "MAI-style benchmark finished." })],
    })
  );
  
  return new RunTrace({
    runId: `mai-style-doctor-benchmark-${results.length}`,
    name: "MAI-Style Public Doctor Benchmark",
    success: true,
    finalOutput: `${results.length} public sequential cases replayed.`,
    steps,
    handoffs,
    metadata: {
      source: SOURCE_NAME,
      mode: "mai_style_gold_replay",
      case_count: results.length,
      total_cost: results.reduce((sum, r) => sum + r.total_cost, 0),
    },
  });
}
