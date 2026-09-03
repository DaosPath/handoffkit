import { DEFAULT_CONTRACT_FIXTURES, DEFAULT_CONTRACT_SCHEMAS, listSection, toJSONString } from "./utils.js";

export class HandoffValidationError extends Error {
  constructor(message, report) {
    super(message);
    this.name = "HandoffValidationError";
    this.report = report;
  }
}

export class ContractParityReport {
  constructor({
    runtime,
    version,
    success,
    fixtureCount = 0,
    schemaCount = 0,
    supportedContracts = [],
    missingFixtures = [],
    missingSchemas = [],
    metadata = {},
  } = {}) {
    this.runtime = runtime || "";
    this.version = version || "";
    this.success = Boolean(success);
    this.fixtureCount = Number(fixtureCount || 0);
    this.schemaCount = Number(schemaCount || 0);
    this.supportedContracts = Array.isArray(supportedContracts) ? [...supportedContracts] : [];
    this.missingFixtures = Array.isArray(missingFixtures) ? [...missingFixtures] : [];
    this.missingSchemas = Array.isArray(missingSchemas) ? [...missingSchemas] : [];
    this.metadata = metadata ? { ...metadata } : {};
  }

  toJSON() {
    return {
      runtime: this.runtime,
      version: this.version,
      success: this.success,
      fixture_count: this.fixtureCount,
      schema_count: this.schemaCount,
      supported_contracts: [...this.supportedContracts],
      missing_fixtures: [...this.missingFixtures],
      missing_schemas: [...this.missingSchemas],
      metadata: { ...this.metadata },
    };
  }

  toJSONString(space = 2) {
    return JSON.stringify(this.toJSON(), null, space);
  }

  toMarkdown() {
    const contracts = this.supportedContracts.map((name) => `- \`${name}\``).join("\n") || "- none";
    const missingFixtures = this.missingFixtures.map((name) => `- \`${name}\``).join("\n") || "- none";
    const missingSchemas = this.missingSchemas.map((name) => `- \`${name}\``).join("\n") || "- none";
    return [
      "# Contract Parity Report",
      "",
      `Runtime: \`${this.runtime}\``,
      "",
      `Version: \`${this.version}\``,
      "",
      `Success: \`${this.success}\``,
      "",
      `Fixtures: \`${this.fixtureCount}\``,
      "",
      `Schemas: \`${this.schemaCount}\``,
      "",
      "## Supported Contracts",
      "",
      contracts,
      "",
      "## Missing Fixtures",
      "",
      missingFixtures,
      "",
      "## Missing Schemas",
      "",
      missingSchemas,
    ].join("\n");
  }

  static fromJSON(value) {
    const data = typeof value === "string" ? JSON.parse(value) : value;
    return new ContractParityReport({
      runtime: data.runtime,
      version: data.version,
      success: data.success,
      fixtureCount: data.fixtureCount ?? data.fixture_count,
      schemaCount: data.schemaCount ?? data.schema_count,
      supportedContracts: data.supportedContracts ?? data.supported_contracts,
      missingFixtures: data.missingFixtures ?? data.missing_fixtures,
      missingSchemas: data.missingSchemas ?? data.missing_schemas,
      metadata: data.metadata,
    });
  }
}

export async function buildContractParityReport({
  runtime = "javascript",
  version = "1.13.0",
  contractsRoot = "",
  contractInventory = null,
  expectedFixtures = DEFAULT_CONTRACT_FIXTURES,
  expectedSchemas = DEFAULT_CONTRACT_SCHEMAS,
} = {}) {
  const knownFixtures = new Set(contractInventory?.fixtures ?? expectedFixtures);
  const knownSchemas = new Set(contractInventory?.schemas ?? expectedSchemas);
  const missingFixtures = [];
  const missingSchemas = [];
  for (const name of expectedFixtures) {
    if (!knownFixtures.has(name)) missingFixtures.push(name);
  }
  for (const name of expectedSchemas) {
    if (!knownSchemas.has(name)) missingSchemas.push(name);
  }
  const supportedContracts = expectedFixtures
    .filter((name) => !missingFixtures.includes(name))
    .map((name) => name.replace(/\.json$/, ""));
  return new ContractParityReport({
    runtime,
    version,
    success: missingFixtures.length === 0 && missingSchemas.length === 0,
    fixtureCount: expectedFixtures.length - missingFixtures.length,
    schemaCount: expectedSchemas.length - missingSchemas.length,
    supportedContracts,
    missingFixtures,
    missingSchemas,
    metadata: {
      contractsRoot,
      source: contractInventory ? "provided_inventory" : "embedded_inventory",
    },
  });
}

export class ValidationIssue {
  constructor({ code, message, field = "", severity = "error" }) {
    this.code = String(code);
    this.message = String(message);
    this.field = field ? String(field) : "";
    this.severity = severity === "warning" ? "warning" : "error";
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      field: this.field,
      severity: this.severity,
    };
  }

  static fromJSON(value) {
    const data = typeof value === "string" ? JSON.parse(value) : value;
    return new ValidationIssue({
      code: data.code,
      message: data.message,
      field: data.field,
      severity: data.severity,
    });
  }
}

export class ValidationReport {
  constructor({ success = true, issues = [], metadata = {} } = {}) {
    this.success = Boolean(success);
    this.issues = (Array.isArray(issues) ? issues : []).map((issue) =>
      issue instanceof ValidationIssue ? issue : new ValidationIssue(issue),
    );
    this.metadata = metadata ? { ...metadata } : {};
  }

  static fromIssues(issues, metadata = {}) {
    const normalized = issues.map((issue) =>
      issue instanceof ValidationIssue ? issue : new ValidationIssue(issue),
    );
    return new ValidationReport({
      success: normalized.every((issue) => issue.severity !== "error"),
      issues: normalized,
      metadata,
    });
  }

  toJSON() {
    return {
      success: this.success,
      issues: this.issues.map((issue) => issue.toJSON()),
      metadata: { ...this.metadata },
    };
  }

  static fromJSON(value) {
    const data = typeof value === "string" ? JSON.parse(value) : value;
    const issues = (data.issues || []).map((issue) => ValidationIssue.fromJSON(issue));
    return new ValidationReport({
      success: data.success,
      issues,
      metadata: data.metadata,
    });
  }

  toJSONString(space = 2) {
    return JSON.stringify(this.toJSON(), null, space);
  }

  toMarkdown() {
    const lines = [`# Validation Report`, "", `Success: ${this.success}`];
    if (this.issues.length === 0) {
      lines.push("", "No issues.");
      return lines.join("\n");
    }
    lines.push("", "| Severity | Code | Field | Message |", "|---|---|---|---|");
    for (const issue of this.issues) {
      lines.push(
        `| ${issue.severity} | ${issue.code} | ${issue.field || "-"} | ${issue.message} |`,
      );
    }
    return lines.join("\n");
  }

  raiseIfFailed() {
    if (!this.success) {
      throw new HandoffValidationError("Validation failed.", this);
    }
    return this;
  }
}

export class HandoffState {
  constructor({
    task,
    fromAgent = "",
    toAgent = "",
    summary = "",
    decisions = [],
    importantFiles = [],
    errors = [],
    nextSteps = [],
    contextRefs = [],
    metadata = {},
  } = {}) {
    this.task = task ?? "";
    this.fromAgent = fromAgent || "";
    this.toAgent = toAgent || "";
    this.summary = summary || "";
    this.decisions = Array.isArray(decisions) ? [...decisions] : [];
    this.importantFiles = Array.isArray(importantFiles) ? [...importantFiles] : [];
    this.errors = Array.isArray(errors) ? [...errors] : [];
    this.nextSteps = Array.isArray(nextSteps) ? [...nextSteps] : [];
    this.contextRefs = Array.isArray(contextRefs) ? [...contextRefs] : [];
    this.metadata = metadata ? { ...metadata } : {};
  }

  static fromJSON(value) {
    const data = typeof value === "string" ? JSON.parse(value) : value;
    return new HandoffState({
      task: data.task,
      fromAgent: data.fromAgent ?? data.from_agent,
      toAgent: data.toAgent ?? data.to_agent,
      summary: data.summary,
      decisions: data.decisions,
      importantFiles: data.importantFiles ?? data.important_files,
      errors: data.errors,
      nextSteps: data.nextSteps ?? data.next_steps,
      contextRefs: data.contextRefs ?? data.context_refs,
      metadata: data.metadata,
    });
  }

  validateReport() {
    const issues = [];
    if (!this.task || !String(this.task).trim()) {
      issues.push({ code: "missing_task", field: "task", message: "task is required" });
    }
    if (!this.summary || !String(this.summary).trim()) {
      issues.push({ code: "missing_summary", field: "summary", message: "summary is required" });
    }
    for (const [field, value] of Object.entries({
      decisions: this.decisions,
      importantFiles: this.importantFiles,
      errors: this.errors,
      nextSteps: this.nextSteps,
      contextRefs: this.contextRefs,
    })) {
      if (!Array.isArray(value)) {
        issues.push({ code: "invalid_array", field, message: `${field} must be an array` });
      }
    }
    if (this.decisions.length === 0) {
      issues.push({
        code: "empty_decisions",
        field: "decisions",
        message: "decisions is empty",
        severity: "warning",
      });
    }
    return ValidationReport.fromIssues(issues, {
      validator: "HandoffState.validateReport",
    });
  }

  validate() {
    this.validateReport().raiseIfFailed();
    return this;
  }

  toJSON() {
    return this.toWire();
  }

  toWire() {
    return {
      task: this.task,
      from_agent: this.fromAgent,
      to_agent: this.toAgent,
      summary: this.summary,
      decisions: [...this.decisions],
      important_files: [...this.importantFiles],
      errors: [...this.errors],
      next_steps: [...this.nextSteps],
      context_refs: [...this.contextRefs],
      metadata: { ...this.metadata },
    };
  }

  toCamelJSON() {
    return {
      task: this.task,
      fromAgent: this.fromAgent,
      toAgent: this.toAgent,
      summary: this.summary,
      decisions: [...this.decisions],
      importantFiles: [...this.importantFiles],
      errors: [...this.errors],
      nextSteps: [...this.nextSteps],
      contextRefs: [...this.contextRefs],
      metadata: { ...this.metadata },
    };
  }

  toJSONString(space = 2) {
    return JSON.stringify(this.toJSON(), null, space);
  }

  toMarkdown() {
    return [
      `# HandoffState`,
      "",
      `Task: ${this.task}`,
      `From: ${this.fromAgent || "-"}`,
      `To: ${this.toAgent || "-"}`,
      "",
      `## Summary`,
      this.summary || "-",
      "",
      listSection("Decisions", this.decisions),
      listSection("Files", this.importantFiles),
      listSection("Errors", this.errors),
      listSection("Next Steps", this.nextSteps),
    ].join("\n");
  }

  static fromMarkdown(text) {
    let task = "";
    let fromAgent = "";
    let toAgent = "";
    let summary = "";
    const decisions = [];
    const importantFiles = [];
    const errors = [];
    const nextSteps = [];
    const contextRefs = [];

    const lines = text.split(/\r?\n/);
    let currentSection = null;
    const summaryLines = [];

    for (const line of lines) {
      const lineStr = line.trim();
      if (!lineStr) continue;

      if (lineStr.startsWith("Task:")) {
        task = lineStr.slice(5).trim();
        continue;
      }
      if (lineStr.startsWith("From:")) {
        fromAgent = lineStr.slice(5).trim();
        if (fromAgent === "-") fromAgent = "";
        continue;
      }
      if (lineStr.startsWith("To:")) {
        toAgent = lineStr.slice(3).trim();
        if (toAgent === "-") toAgent = "";
        continue;
      }

      if (lineStr.startsWith("## ")) {
        currentSection = lineStr.slice(3).trim().toLowerCase();
        continue;
      }

      if (currentSection === "summary") {
        summaryLines.push(lineStr);
      } else if (lineStr.startsWith("-")) {
        const val = lineStr.slice(1).trim();
        if (!val || val === "-") continue;
        if (currentSection === "decisions") {
          decisions.push(val);
        } else if (currentSection === "files" || currentSection === "important files" || currentSection === "importantfiles") {
          importantFiles.push(val);
        } else if (currentSection === "errors") {
          errors.push(val);
        } else if (currentSection === "next steps" || currentSection === "nextsteps") {
          nextSteps.push(val);
        } else if (currentSection === "context refs" || currentSection === "contextrefs") {
          contextRefs.push(val);
        }
      }
    }

    summary = summaryLines.join("\n").trim();
    if (summary === "-") summary = "";

    return new HandoffState({
      task,
      fromAgent,
      toAgent,
      summary,
      decisions,
      importantFiles,
      errors,
      nextSteps,
      contextRefs,
    });
  }
}

