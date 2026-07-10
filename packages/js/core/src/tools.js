import { toJSONString } from "./utils.js";
import { isDangerousCommand, requiresApproval } from "./safety.js";

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

