import { grade, round, scoreMetric, toJSONString } from "./utils.js";
import { HandoffState, ValidationReport } from "./contracts.js";

export class HandoffQualityEvaluator {
  constructor({ minScore = 0.6 } = {}) {
    this.minScore = minScore;
  }

  evaluate(state) {
    const handoff = state instanceof HandoffState ? state : HandoffState.fromJSON(state);
    const metrics = [
      scoreMetric("completeness", handoff.summary && handoff.task && handoff.nextSteps.length ? 1 : 0.4),
      scoreMetric("clarity", handoff.summary.length >= 20 ? 1 : 0.5),
      scoreMetric("actionability", handoff.nextSteps.length > 0 ? 1 : 0.3),
      scoreMetric("traceability", handoff.importantFiles.length || handoff.contextRefs.length ? 1 : 0.5),
      scoreMetric("errorAwareness", handoff.errors.length || handoff.metadata.errorsChecked ? 1 : 0.7),
    ];
    const score = round(metrics.reduce((sum, metric) => sum + metric.score * metric.weight, 0) / metrics.reduce((sum, metric) => sum + metric.weight, 0));
    return new HandoffQualityReport({
      success: score >= this.minScore,
      score,
      grade: grade(score),
      metrics,
      recommendations: score >= this.minScore ? [] : ["Add clearer next steps, files, context refs, or error notes."],
      validation: handoff.validateReport(),
    });
  }

  evaluateMany(handoffs) {
    if (!Array.isArray(handoffs) || handoffs.length === 0) {
      const validation = new ValidationReport({
        success: false,
        issues: [],
        metadata: { error: "no handoffs provided" },
      });
      return new HandoffQualityReport({
        success: false,
        score: 0.0,
        grade: "F",
        metrics: [],
        recommendations: ["Provide at least one handoff state."],
        validation,
        metadata: { handoffs: 0, evaluator: this.constructor.name },
      });
    }
    const reports = handoffs.map(state => this.evaluate(state));
    const names = ["completeness", "clarity", "actionability", "traceability", "errorAwareness"];
    const metrics = [];
    for (const name of names) {
      const matching = reports.flatMap(report => report.metrics).filter(metric => metric.name === name);
      if (!matching.length) continue;
      metrics.push({
        name,
        score: matching.reduce((sum, m) => sum + m.score, 0) / matching.length,
        weight: matching[0].weight,
        notes: [`average over ${handoffs.length} handoffs`],
      });
    }
    const score = reports.reduce((sum, r) => sum + r.score, 0) / reports.length;
    const successful = reports.filter(r => r.success).length;
    const validation = new ValidationReport({
      success: reports.every(r => r.validation?.success),
      issues: reports.flatMap(r => r.validation?.issues || []),
      metadata: { reports: reports.length, successful },
    });
    return new HandoffQualityReport({
      success: reports.every(r => r.success),
      score,
      grade: grade(score),
      metrics,
      recommendations: score >= this.minScore ? [] : ["Add clearer next steps, files, context refs, or error notes."],
      validation,
      metadata: { handoffs: handoffs.length, evaluator: this.constructor.name },
    });
  }
}

export class HandoffQualityReport {
  constructor({ success, score, grade, metrics = [], recommendations = [], validation, metadata = {} }) {
    this.success = Boolean(success);
    this.score = score;
    this.grade = grade;
    this.metrics = Array.isArray(metrics) ? [...metrics] : [];
    this.recommendations = Array.isArray(recommendations) ? [...recommendations] : [];
    this.validation = validation instanceof ValidationReport ? validation : (validation ? ValidationReport.fromJSON(validation) : null);
    this.metadata = metadata ? { ...metadata } : {};
  }

  toJSON() {
    return {
      success: this.success,
      score: this.score,
      grade: this.grade,
      metrics: this.metrics,
      recommendations: [...this.recommendations],
      validation: this.validation?.toJSON?.() ?? this.validation,
      metadata: { ...this.metadata },
    };
  }

  static fromJSON(value) {
    const data = typeof value === "string" ? JSON.parse(value) : value;
    return new HandoffQualityReport({
      success: data.success,
      score: data.score,
      grade: data.grade,
      metrics: data.metrics,
      recommendations: data.recommendations,
      validation: data.validation,
      metadata: data.metadata,
    });
  }

  toJSONString(space = 2) {
    return JSON.stringify(this.toJSON(), null, space);
  }

  toMarkdown() {
    return [
      "# Handoff Quality Report",
      "",
      `Success: ${this.success}`,
      `Score: ${this.score}`,
      `Grade: ${this.grade}`,
      "",
      "| Metric | Score | Weight |",
      "|---|---:|---:|",
      ...this.metrics.map((metric) => `| ${metric.name} | ${metric.score} | ${metric.weight} |`),
    ].join("\n");
  }
}

