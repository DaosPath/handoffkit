import fs from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HandoffState,
  HandoffQualityEvaluator,
  RunTrace,
  TraceStep,
  TraceEvent,
} from "@handoffkit/core";
import { writeReportFiles } from "@handoffkit/node";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const SOURCE_NAME = "zou-lab/MedCaseReasoning";
export const SOURCE_URL = "https://huggingface.co/datasets/zou-lab/MedCaseReasoning";
export const SOURCE_PAPER = "https://arxiv.org/abs/2505.11733";
export const SAFETY_NOTE = "Educational benchmark harness only. Cases are from open-access case reports; this output is not medical advice and must not be used for patient care.";

export class DoctorBenchmarkCase {
  constructor({ case_id, pmcid, title, journal, article_link, publication_date, case_prompt, diagnostic_reasoning, final_diagnosis }) {
    this.case_id = case_id;
    this.pmcid = pmcid;
    this.title = title;
    this.journal = journal;
    this.article_link = article_link;
    this.publication_date = publication_date;
    this.case_prompt = case_prompt;
    this.diagnostic_reasoning = diagnostic_reasoning;
    this.final_diagnosis = final_diagnosis;
  }

  static fromDict(data) {
    return new DoctorBenchmarkCase(data);
  }

  toDict() {
    return {
      case_id: this.case_id,
      pmcid: this.pmcid,
      title: this.title,
      journal: this.journal,
      article_link: this.article_link,
      publication_date: this.publication_date,
      case_prompt: this.case_prompt,
      diagnostic_reasoning: this.diagnostic_reasoning,
      final_diagnosis: this.final_diagnosis,
    };
  }
}

export class DoctorBenchmarkCaseResult {
  constructor({ caseObj, predictedDiagnosis, correct, handoffs = [] }) {
    this.case = caseObj;
    this.predicted_diagnosis = predictedDiagnosis;
    this.correct = Boolean(correct);
    this.handoffs = handoffs.map(item => item instanceof HandoffState ? item : new HandoffState(item));
  }

  toDict() {
    return {
      case: this.case.toDict(),
      predicted_diagnosis: this.predicted_diagnosis,
      correct: this.correct,
      handoffs: this.handoffs.map(h => h.toDict ? h.toDict() : h),
    };
  }
}

export class DoctorBenchmarkReport {
  constructor({ name, cases = [], trace, validation, quality, artifacts = {} }) {
    this.name = name;
    this.cases = cases;
    this.trace = trace;
    this.validation = validation;
    this.quality = quality;
    this.artifacts = artifacts;
  }

  get case_count() {
    return this.cases.length;
  }

  get correct_count() {
    return this.cases.filter(c => c.correct).length;
  }

  get accuracy() {
    return this.case_count ? this.correct_count / this.case_count : 0.0;
  }

  toDict() {
    return {
      name: this.name,
      source: {
        name: SOURCE_NAME,
        url: SOURCE_URL,
        paper: SOURCE_PAPER,
        license_note: "Dataset card lists MIT license; source reports are PMC OA.",
      },
      mode: "gold_replay",
      safety_note: SAFETY_NOTE,
      case_count: this.case_count,
      correct_count: this.correct_count,
      accuracy: Number(this.accuracy.toFixed(3)),
      cases: this.cases.map(c => c.toDict()),
      trace: this.trace.toJSON ? this.trace.toJSON() : this.trace,
      validation: this.validation,
      quality: this.quality.toJSON ? this.quality.toJSON() : this.quality,
      artifacts: this.artifacts,
    };
  }

  toJSON() {
    return this.toDict();
  }

  toMarkdown() {
    const rows = this.cases
      .map(result => `| ${result.case.case_id} | ${result.case.pmcid} | ${result.case.final_diagnosis.replace(/\|/g, "/")} | ${result.case.journal.replace(/\|/g, "/")} |`)
      .join("\n");
    const sortedArtifacts = Object.keys(this.artifacts).sort().map(name => `- \`${name}\`: \`${this.artifacts[name]}\``).join("\n") || "- generated when written";
    return [
      `# ${this.name}`,
      "",
      `> ${SAFETY_NOTE}`,
      "",
      "## Source",
      "",
      `- Dataset: [${SOURCE_NAME}](${SOURCE_URL})`,
      `- Paper: [${SOURCE_PAPER}](${SOURCE_PAPER})`,
      "- Split: test",
      "- Mode: `gold_replay` (replays known clinician-authored answers; does not claim model diagnostic accuracy)",
      "",
      "## Summary",
      "",
      `- Cases: \`${this.case_count}\``,
      `- Gold replay matches: \`${this.correct_count}\``,
      `- Accuracy: \`${this.accuracy.toFixed(3)}\``,
      `- Validation: \`${this.validation.success}\``,
      `- Handoff quality: \`${this.quality.grade}\` / \`${(this.quality.score ?? 1.0).toFixed(3)}\``,
      `- Replay: ${this.trace.steps.length} steps, ${this.trace.handoffs.length} handoffs`,
      "",
      "## Cases",
      "",
      "| Case | PMCID | Gold Diagnosis | Journal |",
      "| --- | --- | --- | --- |",
      rows,
      "",
      "## Artifacts",
      "",
      sortedArtifacts,
    ].join("\n") + "\n";
  }
}

export function loadDoctorBenchmarkCases(limit = 30) {
  if (limit < 1) throw new Error("limit must be at least 1");
  let fileName;
  if (limit <= 30) fileName = "doctor_cases_30.json";
  else if (limit <= 100) fileName = "doctor_cases_100.json";
  else fileName = "doctor_cases_400.json";
  
  const raw = fs.readFileSync(join(__dirname, fileName), "utf8");
  const list = JSON.parse(raw);
  const rawCases = list.slice(0, Math.min(limit, list.length));
  return rawCases.map(item => DoctorBenchmarkCase.fromDict(item));
}

export function buildDoctorBenchmark(limit = 30) {
  const cases = loadDoctorBenchmarkCases(limit);
  const results = cases.map(_buildCaseResult);
  const handoffs = results.flatMap(r => r.handoffs);
  const validation = _validateHandoffs(handoffs);
  const quality = new HandoffQualityEvaluator({ minScore: 0.6 }).evaluateMany(handoffs);
  const trace = _makeTrace(results);
  return new DoctorBenchmarkReport({
    name: `Doctor Benchmark: ${cases.length} Real Open-Access Cases`,
    cases: results,
    trace,
    validation,
    quality,
  });
}

export async function runDoctorBenchmark(limit = 30, { outputDir = "runs/latest", reportsDir = "reports" } = {}) {
  const report = buildDoctorBenchmark(limit);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(reportsDir, { recursive: true });
  
  const tracePath = join(outputDir, "trace.json");
  const reportJsonPath = join(outputDir, "report.json");
  const reportMdPath = join(outputDir, "report.md");
  
  fs.writeFileSync(tracePath, JSON.stringify(report.trace.toJSON ? report.trace.toJSON() : report.trace, null, 2), "utf8");
  fs.writeFileSync(reportJsonPath, JSON.stringify(report.toDict(), null, 2), "utf8");
  fs.writeFileSync(reportMdPath, report.toMarkdown(), "utf8");
  
  const files = await writeReportFiles(report, `doctor_benchmark_${report.case_count}`, reportsDir);
  report.artifacts = {
    run_trace: tracePath,
    run_report_json: reportJsonPath,
    run_report_md: reportMdPath,
    report_json: files.jsonPath,
    report_md: files.markdownPath,
  };
  
  fs.writeFileSync(reportJsonPath, JSON.stringify(report.toDict(), null, 2), "utf8");
  fs.writeFileSync(reportMdPath, report.toMarkdown(), "utf8");
  // Also write reportsDir files with final artifacts
  fs.writeFileSync(files.jsonPath, JSON.stringify(report.toDict(), null, 2), "utf8");
  fs.writeFileSync(files.markdownPath, report.toMarkdown(), "utf8");
  
  return report;
}

function _firstWords(value, limit = 44) {
  const words = value.replace(/\n/g, " ").split(/\s+/).filter(Boolean);
  if (words.length <= limit) return words.join(" ");
  return words.slice(0, limit).join(" ") + " ...";
}

function _reasoningPoints(value, limit = 3) {
  const points = [];
  for (const chunk of value.split(". ")) {
    const item = chunk.trim();
    if (!item) continue;
    if (/^\d/.test(item)) {
      points.push(item.replace(/\.$/, ""));
    }
    if (points.length >= limit) break;
  }
  if (points.length) return points;
  return [_firstWords(value, 30)];
}

function _validateHandoffs(handoffs) {
  const errors = [];
  for (let index = 0; index < handoffs.length; index++) {
    const state = handoffs[index];
    if (!state.task) errors.push(`handoff_${index + 1}: task is missing`);
    if (!state.fromAgent) errors.push(`handoff_${index + 1}: fromAgent is missing`);
    if (!state.toAgent) errors.push(`handoff_${index + 1}: toAgent is missing`);
  }
  return {
    success: errors.length === 0,
    issues: errors,
    metadata: { validator: "DoctorBenchmark", handoffs: handoffs.length },
  };
}

function _buildCaseResult(caseObj) {
  const gatekeeperHandoff = new HandoffState({
    task: `Evaluate diagnostic case ${caseObj.case_id} without revealing the gold label.`,
    fromAgent: "Gatekeeper",
    toAgent: "Diagnostic Panel",
    summary: _firstWords(caseObj.case_prompt, 50),
    decisions: [
      "Reveal only case-presentation evidence to the diagnostic panel.",
      "Keep final diagnosis hidden until judge stage.",
      "Preserve article provenance with PMCID and source link.",
    ],
    importantFiles: [caseObj.article_link],
    errors: [SAFETY_NOTE],
    nextSteps: [
      "Review case presentation evidence.",
      "Create a differential diagnosis.",
      "Pass uncertainty and missing evidence to the judge.",
    ],
    contextRefs: [caseObj.pmcid, caseObj.title],
    metadata: {
      case_id: caseObj.case_id,
      source: SOURCE_NAME,
      journal: caseObj.journal,
      publication_date: caseObj.publication_date,
      gold_hidden: true,
      errors_checked: true,
    },
  });
  
  const judgeHandoff = new HandoffState({
    task: `Judge diagnostic reasoning for case ${caseObj.case_id}.`,
    fromAgent: "Clinician Reasoning",
    toAgent: "Benchmark Judge",
    summary: _firstWords(caseObj.diagnostic_reasoning, 46),
    decisions: _reasoningPoints(caseObj.diagnostic_reasoning),
    importantFiles: [caseObj.article_link],
    errors: [SAFETY_NOTE],
    nextSteps: [
      "Compare predicted diagnosis with the gold diagnosis.",
      "Record diagnostic accuracy and reasoning provenance.",
      "Write replayable benchmark report.",
    ],
    contextRefs: [caseObj.pmcid, caseObj.title, caseObj.final_diagnosis],
    metadata: {
      case_id: caseObj.case_id,
      source: SOURCE_NAME,
      final_diagnosis: caseObj.final_diagnosis,
      mode: "gold_replay",
      errors_checked: true,
    },
  });
  
  return new DoctorBenchmarkCaseResult({
    caseObj,
    predictedDiagnosis: caseObj.final_diagnosis,
    correct: true,
    handoffs: [gatekeeperHandoff, judgeHandoff],
  });
}

function _makeTrace(results) {
  const steps = [
    new TraceStep({
      name: "benchmark-start",
      agent: "Benchmark Harness",
      task: "Load 30 real open-access diagnostic cases.",
      mode: "gold_replay",
      success: true,
      output: `Loaded ${results.length} MedCaseReasoning cases.`,
      events: [new TraceEvent({ kind: "benchmark", message: "Doctor benchmark started." })],
    })
  ];
  
  const handoffs = [];
  for (let index = 1; index <= results.length; index++) {
    const result = results[index - 1];
    for (const handoff of result.handoffs) {
      handoffs.push(handoff);
      steps.push(
        new TraceStep({
          name: `${result.case.case_id}-${handoff.toAgent.toLowerCase().replace(/\s+/g, "-")}`,
          agent: handoff.toAgent,
          task: handoff.task,
          mode: "gold_replay",
          success: true,
          output: handoff.summary,
          handoff,
          events: [
            new TraceEvent({
              kind: "case",
              message: `Processed case ${index}/${results.length}.`,
              metadata: { case_id: result.case.case_id, pmcid: result.case.pmcid },
            })
          ],
          metadata: { case_id: result.case.case_id },
        })
      );
    }
  }
  
  steps.push(
    new TraceStep({
      name: "benchmark-summary",
      agent: "Benchmark Judge",
      task: "Summarize gold replay benchmark.",
      mode: "gold_replay",
      success: true,
      output: `${results.length} real cases replayed with gold labels.`,
      events: [new TraceEvent({ kind: "benchmark", message: "Doctor benchmark finished." })],
    })
  );
  
  return new RunTrace({
    runId: "doctor-benchmark-30",
    name: "Doctor Benchmark: Real Open-Access Cases",
    success: true,
    finalOutput: `${results.length} MedCaseReasoning cases replayed.`,
    steps,
    handoffs,
    metadata: {
      source: SOURCE_NAME,
      source_url: SOURCE_URL,
      mode: "gold_replay",
      case_count: results.length,
      safety_note: SAFETY_NOTE,
    },
  });
}
