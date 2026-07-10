import { agentName, toJSONString } from "./utils.js";
import { EchoProvider } from "./providers-core.js";
import { ProviderToolAdapter, ToolRegistry, ToolResult } from "./tools.js";

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
