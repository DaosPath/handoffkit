import { agentName, grade, round, toJSONString } from "./utils.js";
import { HandoffState } from "./contracts.js";
import { TeamRunResult } from "./team.js";
import { HandoffQualityEvaluator } from "./quality.js";
import { ReplayRunner, RunTrace } from "./tracing.js";

export class EvaluationCheck {
  constructor({ name, passed, message, severity = "error", metadata = {} }) {
    this.name = name;
    this.passed = Boolean(passed);
    this.message = message;
    this.severity = severity;
    this.metadata = { ...metadata };
  }

  toJSON() {
    return {
      name: this.name,
      passed: this.passed,
      message: this.message,
      severity: this.severity,
      metadata: { ...this.metadata },
    };
  }
}

export class EvaluationResult {
  constructor({ target, success, checks = [], score = 0.0, metadata = {} }) {
    this.target = target;
    this.success = Boolean(success);
    this.checks = (Array.isArray(checks) ? checks : []).map(c => c instanceof EvaluationCheck ? c : new EvaluationCheck(c));
    this.score = Number(score);
    this.metadata = { ...metadata };
  }

  toJSON() {
    return {
      target: this.target,
      success: this.success,
      checks: this.checks.map(c => c.toJSON()),
      score: Math.round(this.score * 1000) / 1000,
      metadata: { ...this.metadata },
    };
  }
}

export class WorkflowEvaluationReport {
  constructor({ success, score, grade, results = [], recommendations = [], metadata = {} }) {
    this.success = Boolean(success);
    this.score = Number(score);
    this.grade = grade;
    this.results = (Array.isArray(results) ? results : []).map(r => r instanceof EvaluationResult ? r : new EvaluationResult(r));
    this.recommendations = Array.isArray(recommendations) ? [...recommendations] : [];
    this.metadata = { ...metadata };
  }

  toJSON() {
    return {
      success: this.success,
      score: Math.round(this.score * 1000) / 1000,
      grade: this.grade,
      results: this.results.map(r => r.toJSON()),
      recommendations: [...this.recommendations],
      metadata: { ...this.metadata },
    };
  }

  toJSONString(space = 2) {
    return JSON.stringify(this.toJSON(), null, space);
  }

  toMarkdown() {
    const results = this.results.map(
      r => `- \`${r.target}\` success=${r.success} score=${r.score.toFixed(2)} checks=${r.checks.length}`
    ).join("\n") || "- none";

    const checks = this.results.flatMap(r => r.checks).map(
      c => `- \`${c.name}\` passed=${c.passed} severity=${c.severity}: ${c.message}`
    ).join("\n") || "- none";

    const recs = this.recommendations.map(r => `- ${r}`).join("\n") || "- none";

    return [
      "# Workflow Evaluation Report",
      "",
      "## Success",
      "",
      String(this.success),
      "",
      "## Score",
      "",
      `${this.score.toFixed(3)} (${this.grade})`,
      "",
      "## Results",
      "",
      results,
      "",
      "## Checks",
      "",
      checks,
      "",
      "## Recommendations",
      "",
      recs
    ].join("\n");
  }
}

export class WorkflowEvaluator {
  constructor({ minScore = 0.75, handoffMinScore = 0.6 } = {}) {
    this.minScore = minScore;
    this.handoffMinScore = handoffMinScore;
  }

  evaluate(target) {
    let result;
    if (target instanceof RunTrace) {
      result = this._evaluateTrace(target);
    } else if (target instanceof TeamRunResult) {
      result = this._evaluateTeamResult(target);
    } else if (target && (target.recipeName || target.recipe_name)) {
      result = this._evaluateRecipeResult(target);
    } else if (target && (target.toolResults || target.tool_results) && target.agentName) {
      result = this._evaluateToolReport(target);
    } else if (Array.isArray(target) && target.every(item => item instanceof HandoffState)) {
      result = this._evaluateHandoffs(target);
    } else {
      result = new EvaluationResult({
        target: target?.constructor?.name || "unknown",
        success: false,
        checks: [
          new EvaluationCheck({
            name: "supported_target",
            passed: false,
            message: "target must be TeamRunResult, RecipeRunResult, RunTrace, ToolExecutionReport, or an array of HandoffState",
          })
        ],
        score: 0.0,
      });
    }
    return this._report([result]);
  }

  evaluateMany(targets) {
    if (!Array.isArray(targets) || targets.length === 0) {
      return new WorkflowEvaluationReport({
        success: false,
        score: 0.0,
        grade: "F",
        results: [],
        recommendations: ["Provide at least one workflow artifact to evaluate."],
        metadata: { targets: 0, evaluator: this.constructor.name },
      });
    }
    const results = targets.map(t => this.evaluate(t).results[0]);
    return this._report(results);
  }

  _evaluateTeamResult(result) {
    const trace = RunTrace.fromTeamResult(result, { name: "team-evaluation" });
    const checks = [
      new EvaluationCheck({
        name: "team_output",
        passed: Boolean(result.finalOutput),
        message: result.finalOutput ? "team produced final output" : "team final output is empty",
      }),
      new EvaluationCheck({
        name: "agent_outputs",
        passed: Array.isArray(result.stepResults) && result.stepResults.length > 0,
        message: Array.isArray(result.stepResults) && result.stepResults.length > 0 ? "team recorded agent outputs" : "team recorded no agent outputs",
      }),
    ];
    checks.push(...this._handoffChecks(result.handoffs));
    checks.push(...this._traceChecks(trace));
    return this._result("TeamRunResult", checks, { handoffs: result.handoffs?.length ?? 0 });
  }

  _evaluateRecipeResult(result) {
    const trace = RunTrace.fromTeamResult(result, { name: "recipe-evaluation" });
    const checks = [
      new EvaluationCheck({
        name: "recipe_success",
        passed: result.success,
        message: result.success ? "recipe run succeeded" : "recipe run failed",
      }),
      new EvaluationCheck({
        name: "recipe_steps",
        passed: Array.isArray(result.stepResults) && result.stepResults.length > 0,
        message: Array.isArray(result.stepResults) && result.stepResults.length > 0 ? "recipe recorded step results" : "recipe recorded no step results",
      }),
    ];
    const handoffs = result.handoffs || result.handoffStates || [];
    checks.push(...this._handoffChecks(handoffs));
    checks.push(...this._traceChecks(trace));
    return this._result("RecipeRunResult", checks, { recipe: result.recipeName || result.recipe_name });
  }

  _evaluateTrace(trace) {
    const checks = this._traceChecks(trace);
    checks.push(...this._handoffChecks(trace.handoffs));
    for (const step of trace.steps) {
      if (step.toolResults) {
        checks.push(...this._toolResultChecks(step.toolResults));
      }
    }
    const replay = new ReplayRunner(trace).summary();
    checks.push(
      new EvaluationCheck({
        name: "replay_summary",
        passed: replay.stepCount === trace.steps.length,
        message: "replay summary inspected trace without execution",
        metadata: replay.toJSON ? replay.toJSON() : replay,
      })
    );
    return this._result("RunTrace", checks, { runId: trace.runId, name: trace.name });
  }

  _evaluateToolReport(report) {
    const checks = [
      new EvaluationCheck({
        name: "tool_report_success",
        passed: report.success,
        message: report.success ? "tool report succeeded" : "tool report failed",
      }),
      new EvaluationCheck({
        name: "tool_steps",
        passed: Array.isArray(report.steps) && report.steps.length > 0,
        message: Array.isArray(report.steps) && report.steps.length > 0 ? "tool report recorded steps" : "tool report recorded no steps",
      }),
    ];
    const toolResults = report.toolResults || report.tool_results || [];
    checks.push(...this._toolResultChecks(toolResults));
    return this._result("ToolExecutionReport", checks, { agent: report.agentName || report.agent_name });
  }

  _evaluateHandoffs(handoffs) {
    const checks = this._handoffChecks(handoffs);
    return this._result("HandoffStateList", checks, { handoffs: handoffs.length });
  }

  _handoffChecks(handoffs) {
    if (!Array.isArray(handoffs) || handoffs.length === 0) {
      return [
        new EvaluationCheck({
          name: "handoffs_present",
          passed: false,
          message: "no handoff states were recorded",
          severity: "warning",
        })
      ];
    }
    const checks = [
      new EvaluationCheck({
        name: "handoffs_present",
        passed: true,
        message: `${handoffs.length} handoff state(s) recorded`,
        severity: "info",
      })
    ];
    for (let index = 0; index < handoffs.length; index++) {
      const state = handoffs[index];
      const validation = state.validate ? state.validate() : state;
      const passed = !validation.errors || validation.errors.length === 0;
      checks.push(
        new EvaluationCheck({
          name: `handoff_${index + 1}_contract`,
          passed,
          message: passed ? "contract validation passed" : (validation.errors?.join("; ") || "contract failed"),
          metadata: state.toJSON ? state.toJSON() : state,
        })
      );
    }
    const evaluator = new HandoffQualityEvaluator({ minScore: this.handoffMinScore });
    const quality = evaluator.evaluateMany ? evaluator.evaluateMany(handoffs) : { success: true, score: 1.0 };
    checks.push(
      new EvaluationCheck({
        name: "handoff_quality",
        passed: quality.success,
        message: `handoff quality score ${(quality.score ?? 1.0).toFixed(3)}`,
        metadata: quality.toJSON ? quality.toJSON() : quality,
      })
    );
    return checks;
  }

  _traceChecks(trace) {
    return [
      new EvaluationCheck({
        name: "trace_success",
        passed: trace.success,
        message: trace.success ? "trace succeeded" : "trace indicates failure",
      }),
      new EvaluationCheck({
        name: "trace_steps",
        passed: Array.isArray(trace.steps) && trace.steps.length > 0,
        message: Array.isArray(trace.steps) && trace.steps.length > 0 ? "trace recorded steps" : "trace recorded no steps",
      }),
      new EvaluationCheck({
        name: "trace_final_output",
        passed: Boolean(trace.finalOutput),
        message: trace.finalOutput ? "trace has final output" : "trace final output is empty",
      }),
    ];
  }

  _toolResultChecks(results) {
    const checks = [];
    const list = Array.isArray(results) ? results : [];
    for (let index = 0; index < list.length; index++) {
      const result = list[index];
      const toolName = result.name || result.tool_name || "unknown";
      checks.push(
        new EvaluationCheck({
          name: `tool_result_${index + 1}`,
          passed: result.success !== false,
          message: result.success !== false ? `tool ${toolName} succeeded` : `tool ${toolName} failed: ${result.error || "unknown"}`,
          metadata: result.toJSON ? result.toJSON() : result,
        })
      );
    }
    return checks;
  }

  _result(target, checks, metadata = {}) {
    const blocking = checks.filter(c => c.severity === "error");
    const passed = blocking.filter(c => c.passed).length;
    const score = blocking.length > 0 ? passed / blocking.length : 1.0;
    const success = score >= this.minScore && blocking.every(c => c.passed);
    return new EvaluationResult({ target, success, checks, score, metadata });
  }

  _report(results) {
    const score = results.length > 0 ? results.reduce((sum, r) => sum + r.score, 0) / results.length : 0.0;
    const success = results.length > 0 && results.every(r => r.success) && score >= this.minScore;
    const recommendations = this._recommendations(results);
    return new WorkflowEvaluationReport({
      success,
      score,
      grade: this._grade(score),
      results,
      recommendations,
      metadata: {
        targets: results.length,
        evaluator: this.constructor.name,
        minScore: this.minScore,
        handoffMinScore: this.handoffMinScore,
      },
    });
  }

  _recommendations(results) {
    const recs = [];
    for (const result of results) {
      for (const check of result.checks) {
        if (check.passed || check.severity !== "error") continue;
        if (check.name.includes("handoff")) {
          recs.push("Improve handoff contracts and quality before release.");
        } else if (check.name.includes("trace")) {
          recs.push("Record complete run traces with steps and final output.");
        } else if (check.name.includes("tool")) {
          recs.push("Resolve failed tool calls or tool execution reports.");
        } else if (check.name.includes("recipe")) {
          recs.push("Fix failing recipe steps before accepting the workflow.");
        } else {
          recs.push(check.message);
        }
      }
    }
    const unique = [...new Set(recs)];
    return unique.length > 0 ? unique : ["Workflow artifacts passed offline evaluation."];
  }

  _grade(score) {
    if (score >= 0.9) return "A";
    if (score >= 0.75) return "B";
    if (score >= 0.6) return "C";
    if (score >= 0.4) return "D";
    return "F";
  }
}

