const DEFAULT_PROTOCOL_MODE = "hybrid_state";
const DEFAULT_CONTRACT_FIXTURES = [
  "handoff_state.json",
  "run_trace.json",
  "validation_report.json",
  "quality_report.json",
  "tool_call.json",
  "tool_result.json",
  "provider_tool_schema.json",
];
const DEFAULT_CONTRACT_SCHEMAS = [
  "handoff-state.schema.json",
  "run-trace.schema.json",
  "validation-report.schema.json",
  "quality-report.schema.json",
  "tool-call.schema.json",
  "tool-result.schema.json",
  "provider-tool-schema.schema.json",
];

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
  version = "1.14.0",
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

export class BaseProvider {
  constructor({ model = "" } = {}) {
    this.model = model;
  }

  generate() {
    throw new Error(`${this.constructor.name}.generate() is not implemented.`);
  }

  async agenerate(prompt, kwargs = {}) {
    return this.generate(prompt, kwargs);
  }
}

export class EchoProvider extends BaseProvider {
  constructor({ model = "echo-js" } = {}) {
    super({ model });
  }

  generate(prompt) {
    return `Echo(${this.model}): ${prompt}`;
  }
}

export class OpenAIProvider extends BaseProvider {
  constructor({
    model = "",
    apiKey = "",
    baseUrl = "",
    headers = {},
    timeout = 60000,
  } = {}) {
    const resolvedModel = model || (typeof process !== "undefined" ? process.env.OPENAI_MODEL : "") || "gpt-4o-mini";
    super({ model: resolvedModel });

    this.apiKey = apiKey || (typeof process !== "undefined" ? process.env.OPENAI_API_KEY : "");
    const resolvedBaseUrl = baseUrl || (typeof process !== "undefined" ? process.env.OPENAI_BASE_URL : "") || "https://api.openai.com/v1";
    this.baseUrl = resolvedBaseUrl.replace(/\/+$/, "");
    this.headers = { ...headers };
    this.timeout = timeout;
    /** @type {{ prompt_tokens?: number, completion_tokens?: number, total_tokens?: number } | null} */
    this.lastUsage = null;

    if (!this.apiKey) {
      throw new Error(
        "apiKey is required for OpenAIProvider. Set the environment variable OPENAI_API_KEY or pass apiKey explicitly."
      );
    }
  }

  generate() {
    throw new Error(
      `${this.constructor.name}.generate() is not supported for network calls in JS. Use agenerate() instead.`
    );
  }

  async agenerate(prompt, kwargs = {}) {
    // Agent.arun passes { agent, task, context } — never forward those to the HTTP API.
    const {
      agent: _agent,
      task: _task,
      context: _context,
      model,
      messages,
      temperature,
      max_tokens,
      top_p,
      stop,
      stream,
      ...rest
    } = kwargs;

    const payload = {
      model: model || this.model,
      messages: messages || [{ role: "user", content: prompt }],
    };
    if (temperature !== undefined) payload.temperature = temperature;
    if (max_tokens !== undefined) payload.max_tokens = max_tokens;
    if (top_p !== undefined) payload.top_p = top_p;
    if (stop !== undefined) payload.stop = stop;
    if (stream !== undefined) payload.stream = stream;
    // Only allow plain JSON-serializable OpenAI extras (no nested class instances).
    for (const [key, value] of Object.entries(rest)) {
      if (value == null) continue;
      const t = typeof value;
      if (t === "string" || t === "number" || t === "boolean") {
        payload[key] = value;
      } else if (Array.isArray(value) || (t === "object" && value.constructor === Object)) {
        payload[key] = value;
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "User-Agent": "handoffkit/1.14.0",
          ...this.headers,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        let detail = "";
        try {
          detail = await response.text();
        } catch (_) {}
        const sanitized = this.apiKey ? detail.replaceAll(this.apiKey, "[redacted-api-key]") : detail;
        throw new Error(
          `OpenAI request failed with HTTP ${response.status}: ${sanitized}`
        );
      }

      const body = await response.json();
      this.lastUsage = body.usage || null;
      const choices = body.choices || [];
      if (choices.length === 0) {
        return "";
      }
      return choices[0].message?.content || "";
    } catch (err) {
      clearTimeout(timer);
      if (err.name === "AbortError") {
        throw new Error(`OpenAI request timed out after ${this.timeout}ms`);
      }
      throw err;
    }
  }
}

export class OllamaProvider extends BaseProvider {
  constructor({
    model = "llama3.1",
    baseUrl = "http://localhost:11434",
    timeout = 60000,
  } = {}) {
    super({ model });
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.timeout = timeout;
  }

  generate() {
    throw new Error(
      `${this.constructor.name}.generate() is not supported for network calls in JS. Use agenerate() instead.`
    );
  }

  async agenerate(prompt, kwargs = {}) {
    const payload = {
      model: kwargs.model || this.model,
      prompt,
      stream: false,
      ...kwargs,
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        let detail = "";
        try {
          detail = await response.text();
        } catch (_) {}
        throw new Error(
          `Ollama request failed with HTTP ${response.status}: ${detail}`
        );
      }

      const body = await response.json();
      return body.response || "";
    } catch (err) {
      clearTimeout(timer);
      if (err.name === "AbortError") {
        throw new Error(`Ollama request timed out after ${this.timeout}ms`);
      }
      throw err;
    }
  }
}

export class Agent {
  constructor({ name, role = "", provider = new EchoProvider(), metadata = {} } = {}) {
    if (!name) {
      throw new TypeError("Agent name is required.");
    }
    this.name = name;
    this.role = role;
    this.provider = provider;
    this.metadata = { ...metadata };
  }

  run(task, { context = null } = {}) {
    const prompt = context ? `${this.role}\n\nTask: ${task}\n\nContext:\n${context}` : `${this.role}\n\nTask: ${task}`;
    const finalOutput = this.provider.generate(prompt, { agent: this, task, context });
    return new AgentRunResult({
      agentName: this.name,
      task,
      finalOutput,
      provider: this.provider.constructor?.name ?? "Provider",
      model: this.provider.model ?? "",
    });
  }

  async arun(task, { context = null, temperature, max_tokens, ...extras } = {}) {
    const prompt = context ? `${this.role}\n\nTask: ${task}\n\nContext:\n${context}` : `${this.role}\n\nTask: ${task}`;
    const generate = this.provider.agenerate?.bind(this.provider) ?? this.provider.generate.bind(this.provider);
    const kwargs = { agent: this, task, context, ...extras };
    if (temperature !== undefined) kwargs.temperature = temperature;
    if (max_tokens !== undefined) kwargs.max_tokens = max_tokens;
    const finalOutput = await generate(prompt, kwargs);
    return new AgentRunResult({
      agentName: this.name,
      task,
      finalOutput,
      provider: this.provider.constructor?.name ?? "Provider",
      model: this.provider.model ?? "",
    });
  }

  runWithTools(task, { tools = [], toolCalls = [], providerAdapter = new ProviderToolAdapter() } = {}) {
    const result = this.run(task);
    const registry = new ToolRegistry(tools);
    const calls = Array.isArray(toolCalls) ? toolCalls : providerAdapter.parseToolCalls(toolCalls);
    const toolResults = calls.map((call) => registry.execute(call));
    return new ToolAgentRunResult({ agentResult: result, toolResults });
  }

  async arunWithTools(task, { tools = [], toolCalls = [], providerAdapter = new ProviderToolAdapter() } = {}) {
    const result = await this.arun(task);
    const registry = new ToolRegistry(tools);
    const calls = Array.isArray(toolCalls) ? toolCalls : providerAdapter.parseToolCalls(toolCalls);
    const toolResults = [];
    for (const call of calls) {
      toolResults.push(await registry.aexecute(call));
    }
    return new ToolAgentRunResult({ agentResult: result, toolResults });
  }
}

export class AgentRunResult {
  constructor({ agentName, task, finalOutput, success = true, provider = "", model = "" }) {
    this.agentName = agentName;
    this.task = task;
    this.finalOutput = finalOutput;
    this.success = Boolean(success);
    this.provider = provider;
    this.model = model;
  }

  toJSON() {
    return {
      agent_name: this.agentName,
      task: this.task,
      final_output: this.finalOutput,
      success: this.success,
      provider: this.provider,
      model: this.model,
    };
  }

  toJSONString(space = 2) {
    return JSON.stringify(this.toJSON(), null, space);
  }

  static fromJSON(value) {
    const data = typeof value === "string" ? JSON.parse(value) : value;
    return new AgentRunResult({
      agentName: data.agentName ?? data.agent_name,
      task: data.task,
      finalOutput: data.finalOutput ?? data.final_output,
      success: data.success,
      provider: data.provider,
      model: data.model,
    });
  }
}

export class HandoffProtocol {
  constructor({ mode = DEFAULT_PROTOCOL_MODE } = {}) {
    this.mode = mode;
  }

  transfer({ fromAgent, toAgent, task, summary, decisions = [], importantFiles = [], errors = [], nextSteps = [], contextRefs = [], metadata = {} }) {
    return new HandoffState({
      task,
      fromAgent: agentName(fromAgent),
      toAgent: agentName(toAgent),
      summary,
      decisions,
      importantFiles,
      errors,
      nextSteps,
      contextRefs,
      metadata: { protocolMode: this.mode, ...metadata },
    }).validate();
  }
}

export class Team {
  constructor({ agents = [], protocol = new HandoffProtocol(), metadata = {} } = {}) {
    const list = Array.isArray(agents) ? agents : [];
    if (list.length === 0) {
      throw new TypeError("Team requires at least one agent.");
    }
    this.agents = [...list];
    this.protocol = protocol;
    this.metadata = metadata ? { ...metadata } : {};
  }

  run(task) {
    const stepResults = [];
    const handoffs = [];
    let currentTask = task;
    let previousAgent = null;
    let previousResult = null;

    for (const agent of this.agents) {
      const result = agent.run(currentTask, {
        context: previousResult?.finalOutput ?? null,
      });
      stepResults.push(result);

      if (previousAgent) {
        handoffs.push(
          this.protocol.transfer({
            fromAgent: previousAgent,
            toAgent: agent,
            task: currentTask,
            summary: previousResult.finalOutput,
            decisions: [`${previousAgent.name} completed its step.`],
            nextSteps: [`${agent.name} should continue from structured state.`],
          }),
        );
      }

      previousAgent = agent;
      previousResult = result;
      currentTask = result.finalOutput;
    }

    return new TeamRunResult({
      success: stepResults.every((result) => result.success),
      task,
      finalOutput: stepResults.at(-1)?.finalOutput ?? "",
      stepResults,
      handoffs,
      metadata: this.metadata,
    });
  }

  async arun(task) {
    const stepResults = [];
    const handoffs = [];
    let currentTask = task;
    let previousAgent = null;
    let previousResult = null;

    for (const agent of this.agents) {
      const result = await agent.arun(currentTask, {
        context: previousResult?.finalOutput ?? null,
      });
      stepResults.push(result);

      if (previousAgent) {
        handoffs.push(
          this.protocol.transfer({
            fromAgent: previousAgent,
            toAgent: agent,
            task: currentTask,
            summary: previousResult.finalOutput,
            decisions: [`${previousAgent.name} completed its step.`],
            nextSteps: [`${agent.name} should continue from structured state.`],
          }),
        );
      }

      previousAgent = agent;
      previousResult = result;
      currentTask = result.finalOutput;
    }

    return new TeamRunResult({
      success: stepResults.every((result) => result.success),
      task,
      finalOutput: stepResults.at(-1)?.finalOutput ?? "",
      stepResults,
      handoffs,
      metadata: this.metadata,
    });
  }
}

export class TeamRunResult {
  constructor({ success, task, finalOutput, stepResults = [], handoffs = [], metadata = {} }) {
    this.success = Boolean(success);
    this.task = task;
    this.finalOutput = finalOutput;
    this.stepResults = Array.isArray(stepResults) ? [...stepResults] : [];
    this.handoffs = Array.isArray(handoffs) ? [...handoffs] : [];
    this.metadata = metadata ? { ...metadata } : {};
  }

  toJSON() {
    return {
      success: this.success,
      task: this.task,
      final_output: this.finalOutput,
      step_results: this.stepResults.map((result) => result.toJSON()),
      handoffs: this.handoffs.map((handoff) => handoff.toJSON()),
      metadata: { ...this.metadata },
    };
  }

  toJSONString(space = 2) {
    return JSON.stringify(this.toJSON(), null, space);
  }

  static fromJSON(value) {
    const data = typeof value === "string" ? JSON.parse(value) : value;
    return new TeamRunResult({
      success: data.success,
      task: data.task,
      finalOutput: data.finalOutput ?? data.final_output,
      stepResults: (Array.isArray(data.stepResults ?? data.step_results) ? data.stepResults ?? data.step_results : [])
        .map((result) => result instanceof AgentRunResult ? result : AgentRunResult.fromJSON(result)),
      handoffs: (Array.isArray(data.handoffs) ? data.handoffs : [])
        .map((handoff) => handoff instanceof HandoffState ? handoff : HandoffState.fromJSON(handoff)),
      metadata: data.metadata,
    });
  }
}

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

export class TraceEvent {
  constructor({ kind, message, timestamp = new Date().toISOString(), metadata = {} }) {
    this.kind = kind;
    this.message = message;
    this.timestamp = timestamp;
    this.metadata = { ...metadata };
  }

  toJSON() {
    return { kind: this.kind, message: this.message, timestamp: this.timestamp, metadata: { ...this.metadata } };
  }

  toJSONString(space = 2) {
    return JSON.stringify(this.toJSON(), null, space);
  }

  static fromJSON(value) {
    const data = typeof value === "string" ? JSON.parse(value) : value;
    return new TraceEvent(data);
  }
}

export class TraceStep {
  constructor(init) {
    const {
      name,
      agent = "",
      task = "",
      mode = "",
      success = true,
      output = "",
      handoff = null,
      toolResults = init?.tool_results ?? [],
      events = [],
      metadata = {},
    } = init ?? {};
    this.name = name;
    this.agent = agent;
    this.task = task;
    this.mode = mode;
    this.success = Boolean(success);
    this.output = output;
    this.handoff = handoff instanceof HandoffState ? handoff : (handoff ? HandoffState.fromJSON(handoff) : null);
    this.toolResults = Array.isArray(toolResults) ? [...toolResults] : [];
    this.events = (Array.isArray(events) ? events : []).map((event) => event instanceof TraceEvent ? event : new TraceEvent(event));
    this.metadata = metadata ? { ...metadata } : {};
  }

  toJSON() {
    return {
      name: this.name,
      agent: this.agent,
      task: this.task,
      mode: this.mode,
      success: this.success,
      output: this.output,
      handoff: this.handoff?.toJSON?.() ?? this.handoff,
      tool_results: this.toolResults.map((result) => result?.toJSON?.() ?? result),
      events: this.events.map((event) => event.toJSON()),
      metadata: { ...this.metadata },
    };
  }

  toJSONString(space = 2) {
    return JSON.stringify(this.toJSON(), null, space);
  }

  static fromJSON(value) {
    const data = typeof value === "string" ? JSON.parse(value) : value;
    return new TraceStep(data);
  }
}

export class RunTrace {
  constructor(init = {}) {
    const {
      runId,
      run_id,
      name = "run",
      success = true,
      finalOutput,
      final_output,
      steps = [],
      handoffs = [],
      metadata = {},
    } = init;
    this.runId = runId || run_id || cryptoRandomId();
    this.name = name;
    this.success = Boolean(success);
    this.finalOutput = finalOutput || final_output || "";
    this.steps = (Array.isArray(steps) ? steps : []).map((step) => step instanceof TraceStep ? step : new TraceStep(step));
    this.handoffs = (Array.isArray(handoffs) ? handoffs : []).map((handoff) => handoff instanceof HandoffState ? handoff : HandoffState.fromJSON(handoff));
    this.metadata = metadata ? { ...metadata } : {};
  }

  static fromTeamResult(result, { name = "team-run" } = {}) {
    const handoffs = result.handoffs || result.handoffStates || [];
    const stepResults = result.stepResults || [];
    return new RunTrace({
      name,
      success: result.success,
      finalOutput: result.finalOutput,
      steps: stepResults.map((step, index) => new TraceStep({
        name: step.name || step.step_name || `step-${index + 1}`,
        agent: step.agentName || step.agent_name,
        task: step.task,
        mode: "agent",
        success: step.success,
        output: step.finalOutput || step.output,
        handoff: handoffs[index - 1] ?? null,
      })),
      handoffs: handoffs,
      metadata: result.metadata,
    });
  }

  static fromJSON(value) {
    const data = typeof value === "string" ? JSON.parse(value) : value;
    return new RunTrace(data);
  }

  toJSON() {
    return {
      run_id: this.runId,
      name: this.name,
      success: this.success,
      final_output: this.finalOutput,
      steps: this.steps.map((step) => step.toJSON()),
      handoffs: this.handoffs.map((handoff) => handoff.toJSON()),
      metadata: { ...this.metadata },
    };
  }

  toJSONString(space = 2) {
    return JSON.stringify(this.toJSON(), null, space);
  }

  toMarkdown() {
    return [
      `# RunTrace: ${this.name}`,
      "",
      `Success: ${this.success}`,
      `Steps: ${this.steps.length}`,
      `Handoffs: ${this.handoffs.length}`,
      "",
      `Final Output: ${this.finalOutput}`,
    ].join("\n");
  }

  toTimeline() {
    const lines = [
      `# Execution Timeline: ${this.name} (Run ID: ${this.runId})`,
      `- Success: ${this.success}`,
      `- Total Steps: ${this.steps.length}`,
      `- Total Handoffs: ${this.handoffs.length}`,
      "",
      "## Timeline",
    ];

    for (let i = 0; i < this.steps.length; i++) {
      const step = this.steps[i];
      const agentName = step.agent || "Unknown";
      lines.push(`${i + 1}. [${agentName}] -> Task: ${step.task}`);
      lines.push(`   - Mode: ${step.mode || "default"}`);
      lines.push(`   - Success: ${step.success}`);
      lines.push(`   - Tools Used: ${step.toolResults?.length ?? 0}`);
      if (step.output) {
        const cleanedOutput = step.output.replace(/\r?\n/g, " ");
        const preview = cleanedOutput.length > 60 ? cleanedOutput.slice(0, 60) + "..." : cleanedOutput;
        lines.push(`   - Output Preview: ${preview}`);
      }
      if (step.handoff) {
        const fromA = step.handoff.fromAgent || step.handoff.from_agent || "";
        const toA = step.handoff.toAgent || step.handoff.to_agent || "";
        lines.push(`   - [Handoff] -> ${fromA} to ${toA}`);
      }
    }

    return lines.join("\n");
  }
}

export class ReplayRunner {
  constructor(trace) {
    this.trace = trace instanceof RunTrace ? trace : RunTrace.fromJSON(trace);
  }

  summary() {
    return {
      success: this.trace.success,
      stepCount: this.trace.steps.length,
      handoffCount: this.trace.handoffs.length,
      toolResultCount: this.trace.steps.reduce((sum, step) => sum + step.toolResults.length, 0),
      finalOutput: this.trace.finalOutput,
      metadata: { replayed: true, sourceRunId: this.trace.runId },
    };
  }
}

export class Tool {
  constructor({ name, description = "", parameters = {}, execute = null, metadata = {} } = {}) {
    if (!name) throw new TypeError("Tool name is required.");
    if (execute != null && typeof execute !== "function") {
      throw new TypeError(`Tool ${name} execute must be a function.`);
    }
    this.name = name;
    this.description = description;
    this.parameters = parameters && typeof parameters === "object" ? { ...parameters } : {};
    this.execute = execute;
    this.metadata = metadata ? { ...metadata } : {};
  }

  toSchema() {
    return {
      name: this.name,
      description: this.description,
      parameters: { ...this.parameters },
    };
  }

  toJSON() {
    return {
      name: this.name,
      description: this.description,
      parameters: { ...this.parameters },
      metadata: { ...this.metadata },
    };
  }

  toJSONString(space = 2) {
    return JSON.stringify(this.toJSON(), null, space);
  }

  static fromJSON(value) {
    const data = typeof value === "string" ? JSON.parse(value) : value;
    return new Tool(data);
  }
}

export class ToolCall {
  constructor({ name, tool_name, arguments: args = {}, callId = "", call_id = "", id = "", provider = "", metadata = {} } = {}) {
    const init = arguments[0] ?? {};
    this.name = name || tool_name || init.tool_name || "";
    if (!this.name) throw new TypeError("ToolCall name is required.");
    this.arguments = { ...args };
    this.callId = callId || call_id || id || init.call_id || init.id || "";
    this.provider = provider;
    this.metadata = { ...metadata };
  }

  toJSON() {
    const res = {
      tool_name: this.name,
      arguments: { ...this.arguments },
      call_id: this.callId,
      metadata: { ...this.metadata },
    };
    if (this.provider) {
      res.provider = this.provider;
    }
    return res;
  }

  toJSONString(space = 2) {
    return JSON.stringify(this.toJSON(), null, space);
  }

  static fromJSON(value) {
    const data = typeof value === "string" ? JSON.parse(value) : value;
    return new ToolCall(data);
  }
}

export class ToolResult {
  constructor({ name, tool_name, callId = "", call_id = "", success = true, output = null, result = null, error = "", metadata = {} } = {}) {
    const init = arguments[0] ?? {};
    this.name = name || tool_name || init.tool_name || "";
    this.callId = callId || call_id || init.call_id || "";
    this.success = Boolean(success);
    this.output = output !== null ? output : (result !== null ? result : (init.output !== null ? init.output : init.result));
    this.error = error;
    this.metadata = { ...metadata };
  }

  toJSON() {
    return {
      tool_name: this.name,
      call_id: this.callId,
      success: this.success,
      result: this.output,
      error: this.error,
      metadata: { ...this.metadata },
    };
  }

  toJSONString(space = 2) {
    return JSON.stringify(this.toJSON(), null, space);
  }

  static fromJSON(value) {
    const data = typeof value === "string" ? JSON.parse(value) : value;
    return new ToolResult(data);
  }
}

export class ToolRegistry {
  constructor(tools = []) {
    this.tools = new Map();
    const list = Array.isArray(tools) ? tools : [];
    for (const tool of list) {
      this.register(tool);
    }
  }

  register(tool) {
    if (!tool?.name) throw new TypeError("Tool name is required.");
    if (typeof tool.execute !== "function") throw new TypeError(`Tool ${tool.name} requires execute().`);
    const normalized = tool instanceof Tool ? tool : new Tool(tool);
    this.tools.set(normalized.name, normalized);
    return this;
  }

  get(name) {
    return this.tools.get(name) ?? null;
  }

  list() {
    return [...this.tools.values()];
  }

  listSchemas() {
    return this.list().map((tool) => normalizeToolSchema(tool));
  }

  toJSON() {
    return {
      tools: this.list().map((tool) => tool.toJSON?.() ?? normalizeToolSchema(tool)),
    };
  }

  toJSONString(space = 2) {
    return JSON.stringify(this.toJSON(), null, space);
  }

  execute(call, { requireApproval = false } = {}) {
    const toolCall = call instanceof ToolCall ? call : new ToolCall(call);
    if (requireApproval && requiresApproval(toolCall.name)) {
      return new ToolResult({
        name: toolCall.name,
        callId: toolCall.callId,
        success: false,
        error: "approval_required",
        metadata: { approval_required: true },
      });
    }
    if (toolCall.name === "run_command") {
      const command = String(toolCall.arguments?.command ?? "");
      if (isDangerousCommand(command)) {
        return new ToolResult({
          name: toolCall.name,
          callId: toolCall.callId,
          success: false,
          error: `unsafe command blocked: ${command}`,
          metadata: { unsafe: true },
        });
      }
    }
    const tool = this.get(toolCall.name);
    if (!tool) {
      return new ToolResult({
        name: toolCall.name,
        callId: toolCall.callId,
        success: false,
        error: `Tool not found: ${toolCall.name}`,
      });
    }
    try {
      return new ToolResult({
        name: toolCall.name,
        callId: toolCall.callId,
        output: tool.execute(toolCall.arguments),
      });
    } catch (error) {
      return new ToolResult({
        name: toolCall.name,
        callId: toolCall.callId,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async aexecute(call, { requireApproval = false } = {}) {
    const toolCall = call instanceof ToolCall ? call : new ToolCall(call);
    if (requireApproval && requiresApproval(toolCall.name)) {
      return new ToolResult({
        name: toolCall.name,
        callId: toolCall.callId,
        success: false,
        error: "approval_required",
        metadata: { approval_required: true },
      });
    }
    if (toolCall.name === "run_command") {
      const command = String(toolCall.arguments?.command ?? "");
      if (isDangerousCommand(command)) {
        return new ToolResult({
          name: toolCall.name,
          callId: toolCall.callId,
          success: false,
          error: `unsafe command blocked: ${command}`,
          metadata: { unsafe: true },
        });
      }
    }
    const tool = this.get(toolCall.name);
    if (!tool) {
      return new ToolResult({
        name: toolCall.name,
        callId: toolCall.callId,
        success: false,
        error: `Tool not found: ${toolCall.name}`,
      });
    }
    try {
      return new ToolResult({
        name: toolCall.name,
        callId: toolCall.callId,
        output: await tool.execute(toolCall.arguments),
      });
    } catch (error) {
      return new ToolResult({
        name: toolCall.name,
        callId: toolCall.callId,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export class ToolAgentRunResult {
  constructor({ agentResult, toolResults = [] }) {
    this.agentResult = agentResult instanceof AgentRunResult ? agentResult : AgentRunResult.fromJSON(agentResult);
    this.toolResults = toolResults.map((result) => result instanceof ToolResult ? result : new ToolResult(result));
    this.success = this.agentResult.success && this.toolResults.every((result) => result.success);
  }

  toJSON() {
    return {
      success: this.success,
      agent_result: this.agentResult.toJSON(),
      tool_results: this.toolResults.map((result) => result.toJSON()),
    };
  }

  toJSONString(space = 2) {
    return JSON.stringify(this.toJSON(), null, space);
  }

  static fromJSON(value) {
    const data = typeof value === "string" ? JSON.parse(value) : value;
    return new ToolAgentRunResult({
      agentResult: data.agentResult ?? data.agent_result,
      toolResults: data.toolResults ?? data.tool_results ?? [],
    });
  }
}

export class ProviderToolAdapter {
  constructor({ providerFormat = "handoffkit" } = {}) {
    this.providerFormat = providerFormat;
  }

  toolsToProviderFormat(tools, providerFormat = this.providerFormat) {
    const list = (Array.isArray(tools) ? tools : []).map((tool) => normalizeToolSchema(tool));
    if (providerFormat === "handoffkit") return list;
    if (providerFormat === "openai") {
      return list.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }));
    }
    if (providerFormat === "anthropic") {
      return list.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
      }));
    }
    throw new TypeError(`Unsupported provider tool format: ${providerFormat}`);
  }

  parseToolCalls(payload, providerFormat = this.providerFormat) {
    if (payload == null) return [];
    if (providerFormat === "handoffkit") return parseHandoffKitToolCalls(payload);
    if (providerFormat === "openai") return parseOpenAIToolCalls(payload);
    if (providerFormat === "anthropic") return parseAnthropicToolCalls(payload);
    throw new TypeError(`Unsupported provider tool format: ${providerFormat}`);
  }
}

export class RetryPolicy {
  constructor({ maxAttempts = 3, baseDelayMs = 250, retryStatusCodes = [429, 500, 502, 503, 504] } = {}) {
    this.maxAttempts = maxAttempts;
    this.baseDelayMs = baseDelayMs;
    this.retryStatusCodes = [...retryStatusCodes];
  }

  shouldRetry(error, attempt) {
    if (attempt >= this.maxAttempts) return false;
    const status = error?.status ?? error?.statusCode;
    if (status) return this.retryStatusCodes.includes(status);
    return Boolean(error?.retryable);
  }

  async run(operation) {
    let attempt = 1;
    for (;;) {
      try {
        return await operation({ attempt });
      } catch (error) {
        if (!this.shouldRetry(error, attempt)) throw error;
        await sleep(this.baseDelayMs * attempt);
        attempt += 1;
      }
    }
  }
}

export function defineTool({ name, description = "", parameters = {}, execute }) {
  if (!name) {
    throw new TypeError("Tool name is required.");
  }
  if (typeof execute !== "function") {
    throw new TypeError("Tool execute function is required.");
  }
  return new Tool({ name, description, parameters, execute });
}

function listSection(title, values) {
  return [`## ${title}`, ...(values.length ? values.map((value) => `- ${value}`) : ["-"])].join("\n");
}

function agentName(agent) {
  return typeof agent === "string" ? agent : agent?.name ?? "";
}

function scoreMetric(name, score, weight = 1) {
  return { name, score: round(score), weight, notes: [] };
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function grade(score) {
  if (score >= 0.9) return "A";
  if (score >= 0.8) return "B";
  if (score >= 0.7) return "C";
  if (score >= 0.6) return "D";
  return "F";
}

function cryptoRandomId() {
  const random = globalThis.crypto?.randomUUID?.();
  if (random) return random;
  return `trace-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeToolSchema(tool) {
  const schema = tool?.toSchema?.() ?? tool;
  if (!schema?.name) throw new TypeError("Tool schema name is required.");
  return {
    name: schema.name,
    description: schema.description ?? "",
    parameters: schema.parameters ?? {},
  };
}

function parseHandoffKitToolCalls(payload) {
  const calls = Array.isArray(payload) ? payload : (payload.toolCalls ?? payload.tool_calls ?? [payload]);
  return calls.filter(Boolean).map((call) => new ToolCall({
    name: call.tool_name ?? call.name,
    arguments: call.arguments ?? call.args ?? {},
    callId: call.callId ?? call.call_id ?? call.id ?? "",
    provider: "handoffkit",
    metadata: call.metadata ?? {},
  }));
}

function parseOpenAIToolCalls(payload) {
  const calls = payload.choices?.[0]?.message?.tool_calls ?? payload.message?.tool_calls ?? payload.tool_calls ?? [];
  if (!Array.isArray(calls)) throw new TypeError("OpenAI tool_calls must be an array.");
  return calls.map((call) => {
    const fn = call.function ?? {};
    if (!fn.name) throw new TypeError("OpenAI tool call function.name is required.");
    return new ToolCall({
      name: fn.name,
      arguments: parseArgumentsObject(fn.arguments, "OpenAI function.arguments"),
      callId: call.id ?? "",
      provider: "openai",
      metadata: { type: call.type ?? "function" },
    });
  });
}

function parseAnthropicToolCalls(payload) {
  const content = payload.content ?? payload.message?.content ?? [];
  if (!Array.isArray(content)) throw new TypeError("Anthropic content must be an array.");
  return content.filter((block) => block?.type === "tool_use").map((block) => {
    if (!block.name) throw new TypeError("Anthropic tool_use name is required.");
    return new ToolCall({
      name: block.name,
      arguments: parseArgumentsObject(block.input ?? {}, "Anthropic tool_use.input"),
      callId: block.id ?? "",
      provider: "anthropic",
    });
  });
}

function parseArgumentsObject(value, label) {
  const parsed = typeof value === "string" ? JSON.parse(value || "{}") : value;
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new TypeError(`${label} must be a JSON object.`);
  }
  return parsed;
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

export class ContextDocument {
  constructor({ path, content, summary = "", metadata = {} } = {}) {
    this.path = path;
    this.content = content;
    this.summary = summary;
    this.metadata = { ...metadata };
  }

  toDict() {
    return {
      path: this.path,
      content: this.content,
      summary: this.summary,
      metadata: this.metadata,
    };
  }

  toJSON() {
    return this.toDict();
  }

  toJSONString(space = 2) {
    return JSON.stringify(this.toJSON(), null, space);
  }

  static fromJSON(value) {
    const data = typeof value === "string" ? JSON.parse(value) : value;
    return new ContextDocument(data);
  }
}

export class ContextRetriever {
  constructor(documents = []) {
    this.documents = [...documents];
  }

  search(query, { limit = 5 } = {}) {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];

    const scored = [];
    for (const doc of this.documents) {
      const haystack = `${doc.path}\n${doc.summary}\n${doc.content}`.toLowerCase();
      let score = 0;
      for (const term of terms) {
        let pos = 0;
        while (true) {
          pos = haystack.indexOf(term, pos);
          if (pos >= 0) {
            score++;
            pos += term.length;
          } else {
            break;
          }
        }
      }

      if (score > 0) {
        scored.push({ score, doc });
      }
    }

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.doc.path.localeCompare(b.doc.path);
    });

    return scored.slice(0, limit).map(item => item.doc);
  }
}

export class ContextPack {
  constructor({ query, documents = [], memories = [], summary = "", metadata = {} } = {}) {
    this.query = query;
    this.documents = (Array.isArray(documents) ? documents : []).map((doc) =>
      doc instanceof ContextDocument ? doc : ContextDocument.fromJSON(doc),
    );
    this.memories = Array.isArray(memories) ? [...memories] : [];
    this.summary = summary;
    this.metadata = { ...metadata };
  }

  toDict() {
    return {
      query: this.query,
      documents: this.documents.map(doc => doc.toDict()),
      memories: this.memories.map(m => (typeof m.toDict === "function" ? m.toDict() : m)),
      summary: this.summary,
      metadata: this.metadata,
    };
  }

  toJSON() {
    return this.toDict();
  }

  toJSONString(space = 2) {
    return JSON.stringify(this.toJSON(), null, space);
  }

  toMarkdown() {
    const docsStr = this.documents.map(doc => `- \`${doc.path}\`: ${doc.summary}`).join("\n");
    const memoriesStr = this.memories.map(m => `- \`${m.kind}\` ${m.content}`).join("\n");
    return [
      "# Context Pack",
      "",
      "## Query",
      this.query,
      "",
      "## Summary",
      this.summary || "No summary.",
      "",
      "## Documents",
      docsStr || "- none",
      "",
      "## Memories",
      memoriesStr || "- none",
    ].join("\n");
  }

  static fromJSON(value) {
    const data = typeof value === "string" ? JSON.parse(value) : value;
    return new ContextPack(data);
  }
}

export class ContextRunResult {
  constructor({ finalOutput, contextUsed = null, memoriesUsed = [], success = true } = {}) {
    this.finalOutput = finalOutput;
    this.contextUsed = contextUsed instanceof ContextPack ? contextUsed : (contextUsed ? ContextPack.fromJSON(contextUsed) : null);
    this.memoriesUsed = Array.isArray(memoriesUsed) ? [...memoriesUsed] : [];
    this.success = Boolean(success);
  }

  toDict() {
    return {
      final_output: this.finalOutput,
      context_used: this.contextUsed ? this.contextUsed.toDict() : null,
      memories_used: this.memoriesUsed.map(m => (typeof m.toDict === "function" ? m.toDict() : m)),
      success: this.success,
    };
  }

  toJSON() {
    return this.toDict();
  }

  toJSONString(space = 2) {
    return JSON.stringify(this.toJSON(), null, space);
  }

  static fromJSON(value) {
    const data = typeof value === "string" ? JSON.parse(value) : value;
    return new ContextRunResult({
      finalOutput: data.finalOutput ?? data.final_output,
      contextUsed: data.contextUsed ?? data.context_used,
      memoriesUsed: data.memoriesUsed ?? data.memories_used,
      success: data.success,
    });
  }
}
export const HANDOFFKIT_CORE_VERSION = "1.14.0";
export function toJSONValue(value) {
  if (value == null) return value;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map((item) => toJSONValue(item));
  if (typeof value.toJSON === "function") return toJSONValue(value.toJSON());
  if (typeof value !== "object") return undefined;

  const result = {};
  for (const [key, item] of Object.entries(value)) {
    const serialized = toJSONValue(item);
    if (serialized !== undefined) {
      result[key] = serialized;
    }
  }
  return result;
}

export function toJSONString(value, space = 2) {
  return JSON.stringify(toJSONValue(value), null, space);
}

export function serializeReport(report, { format = "json", space = 2 } = {}) {
  if (format === "object" || format === "json_object") return toJSONValue(report);
  if (format === "markdown") {
    if (typeof report?.toMarkdown !== "function") {
      throw new TypeError("Report does not implement toMarkdown().");
    }
    return report.toMarkdown();
  }
  if (format === "json") return toJSONString(report, space);
  throw new TypeError(`Unsupported report format: ${format}`);
}

export function deserializeReport(value, ReportClass = ValidationReport) {
  const data = typeof value === "string" ? JSON.parse(value) : value;
  if (ReportClass && typeof ReportClass.fromJSON === "function") {
    return ReportClass.fromJSON(data);
  }
  return data;
}

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

export class UnsafeToolCallError extends Error {
  constructor(message) {
    super(message);
    this.name = "UnsafeToolCallError";
  }
}

export class DangerousCommandError extends Error {
  constructor(message) {
    super(message);
    this.name = "DangerousCommandError";
  }
}

export const DANGEROUS_COMMAND_PATTERNS = [
  /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-rf|-fr)\b/i,
  /\bdel\s+\/s\b/i,
  /\bformat\b/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bmkfs(\.[a-z0-9]+)?\b/i,
  /\bdiskpart\b/i,
];

export const APPROVAL_REQUIRED_TOOLS = new Set(["run_command", "write_file"]);

export function isDangerousCommand(command) {
  if (typeof command !== "string") return false;
  const normalized = command.trim().replace(/\s+/g, " ");
  return DANGEROUS_COMMAND_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function requiresApproval(toolName) {
  return APPROVAL_REQUIRED_TOOLS.has(toolName);
}

// ==========================================
// Memory Systems
// ==========================================

export class MemoryEntry {
  constructor({ role, content, metadata = {}, createdAt = null } = {}) {
    this.role = role;
    this.content = content;
    this.metadata = metadata;
    this.createdAt = createdAt || new Date().toISOString();
  }

  toDict() {
    return {
      role: this.role,
      content: this.content,
      metadata: this.metadata,
      created_at: this.createdAt,
    };
  }

  static fromDict(data) {
    return new MemoryEntry({
      role: data.role || "",
      content: data.content || "",
      metadata: data.metadata || {},
      createdAt: data.created_at || data.createdAt,
    });
  }
}

export class AgentMemory {
  constructor({ entries = [] } = {}) {
    this.entries = entries.map(item => item instanceof MemoryEntry ? item : MemoryEntry.fromDict(item));
  }

  add(role, content, metadata = {}) {
    const entry = new MemoryEntry({ role, content, metadata });
    this.entries.push(entry);
    return entry;
  }

  last(count = 5) {
    if (count <= 0) return [];
    return this.entries.slice(-count);
  }

  toText(count = 5) {
    return this.last(count).map(entry => `${entry.role}: ${entry.content}`).join("\n");
  }

  clear() {
    this.entries = [];
  }
}

export class MemoryItem {
  constructor({ id = null, content, kind = "note", tags = [], metadata = {}, createdAt = null, updatedAt = null } = {}) {
    this.id = id || Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    this.content = content;
    this.kind = kind;
    this.tags = Array.isArray(tags) ? tags : [];
    this.metadata = metadata;
    this.createdAt = createdAt || new Date().toISOString();
    this.updatedAt = updatedAt;
  }

  toDict() {
    return {
      id: this.id,
      content: this.content,
      kind: this.kind,
      tags: this.tags,
      metadata: this.metadata,
      created_at: this.createdAt,
      updated_at: this.updatedAt,
    };
  }

  toJS() {
    return this.toDict();
  }

  static fromDict(data) {
    return new MemoryItem({
      id: data.id,
      content: data.content || "",
      kind: data.kind || "note",
      tags: data.tags || [],
      metadata: data.metadata || {},
      createdAt: data.created_at || data.createdAt,
      updatedAt: data.updated_at || data.updatedAt,
    });
  }
}

export class MemoryStore {
  constructor({ items = [] } = {}) {
    this._items = new Map();
    for (const item of items) {
      const inst = item instanceof MemoryItem ? item : MemoryItem.fromDict(item);
      this._items.set(inst.id, inst);
    }
  }

  add(content, { kind = "note", tags = [], metadata = {} } = {}) {
    const item = new MemoryItem({ content, kind, tags, metadata });
    this._items.set(item.id, item);
    this._save();
    return item;
  }

  list() {
    return Array.from(this._items.values());
  }

  get(memoryId) {
    return this._items.get(memoryId) || null;
  }

  search(query, { limit = null } = {}) {
    if (!query) return [];
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const scored = [];
    for (const item of this._items.values()) {
      const haystack = [
        item.content,
        item.kind,
        item.tags.join(" "),
        JSON.stringify(item.metadata),
      ].join(" ").toLowerCase();
      
      let score = 0;
      for (const term of terms) {
        let idx = -1;
        while ((idx = haystack.indexOf(term, idx + 1)) !== -1) {
          score++;
        }
      }
      
      if (score > 0) {
        scored.push({ score, item });
      }
    }
    
    // Sort: score descending, then createdAt ascending, then id ascending
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.item.createdAt !== b.item.createdAt) return a.item.createdAt.localeCompare(b.item.createdAt);
      return a.item.id.localeCompare(b.item.id);
    });
    
    const results = scored.map(entry => entry.item);
    return limit !== null ? results.slice(0, limit) : results;
  }

  delete(memoryId) {
    const existed = this._items.delete(memoryId);
    if (existed) {
      this._save();
    }
    return existed;
  }

  clear() {
    this._items.clear();
    this._save();
  }

  _save() {
    // In-memory no-op
  }
}

export class MemoryReport {
  constructor({ memoriesStored = [], searchesExecuted = [], contextDocumentsUsed = [], finalResult = "" } = {}) {
    this.memoriesStored = memoriesStored.map(item => item instanceof MemoryItem ? item : MemoryItem.fromDict(item));
    this.searchesExecuted = searchesExecuted;
    this.contextDocumentsUsed = contextDocumentsUsed;
    this.finalResult = finalResult;
  }

  toDict() {
    return {
      memories_stored: this.memoriesStored.map(item => item.toDict()),
      searches_executed: this.searchesExecuted,
      context_documents_used: this.contextDocumentsUsed,
      final_result: this.finalResult,
    };
  }

  toJS() {
    return this.toDict();
  }

  toMarkdown() {
    const memories = this.memoriesStored.map(item => `- ${item.kind}: ${item.content}`).join("\n");
    const searches = this.searchesExecuted.map(item => `- ${item}`).join("\n");
    const docs = this.contextDocumentsUsed.map(item => `- ${item}`).join("\n");
    return [
      "# Memory Report",
      "",
      "## Memories Stored",
      "",
      memories || "- none",
      "",
      "## Searches Executed",
      "",
      searches || "- none",
      "",
      "## Context Documents Used",
      "",
      docs || "- none",
      "",
      "## Final Result",
      "",
      this.finalResult,
    ].join("\n") + "\n";
  }
}

// ==========================================
// Extensions Registry
// ==========================================

export class Extension {
  constructor({ name, description, version, recipes = [], tools = [], metadata = {} } = {}) {
    this.name = name;
    this.description = description;
    this.version = version;
    this.recipes = recipes; // array of Recipes
    this.tools = tools; // array of functions or Tool instances
    this.metadata = metadata;
  }

  validate() {
    if (!this.name || !this.name.trim()) {
      throw new Error("extension name must be a non-empty string");
    }
    for (const recipe of this.recipes) {
      if (recipe.validate) recipe.validate();
    }
    const toolNames = this.tools.map(item => {
      // In JS, check if it's a function or an object with a name property
      if (typeof item === "function") return item.name || "anonymous";
      if (item && typeof item === "object") return item.name || "unknown";
      return "invalid";
    });
    const duplicates = toolNames.filter((name, index) => name !== "invalid" && toolNames.indexOf(name) !== index);
    if (duplicates.length > 0) {
      throw new Error(`duplicate tool names: ${[...new Set(duplicates)].join(", ")}`);
    }
    return this;
  }

  toDict() {
    return {
      name: this.name,
      description: this.description,
      version: this.version,
      recipes: this.recipes.map(recipe => recipe.toDict ? recipe.toDict() : recipe),
      tools: this.tools.map(tool => {
        if (tool.toDict) return tool.toDict();
        if (typeof tool === "function") return { name: tool.name || "anonymous", type: "function" };
        return tool;
      }),
      metadata: this.metadata,
    };
  }

  toJS() {
    return this.toDict();
  }
}

export class ExtensionRegistry {
  constructor() {
    this._extensions = new Map();
  }

  register(extension) {
    if (!(extension instanceof Extension)) {
      extension = new Extension(extension);
    }
    extension.validate();
    if (this._extensions.has(extension.name)) {
      throw new Error(`Extension already registered: ${extension.name}`);
    }
    this._extensions.set(extension.name, extension);
    return extension;
  }

  get(name) {
    if (!this._extensions.has(name)) {
      throw new Error(`Extension not found: ${name}`);
    }
    return this._extensions.get(name);
  }

  list() {
    const keys = Array.from(this._extensions.keys()).sort();
    return keys.map(key => this._extensions.get(key));
  }

  recipes() {
    const list = [];
    for (const ext of this.list()) {
      list.push(...ext.recipes);
    }
    return list;
  }

  tools() {
    const list = [];
    for (const ext of this.list()) {
      list.push(...ext.tools);
    }
    return list;
  }
}

