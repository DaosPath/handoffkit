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
          "User-Agent": "handoffkit/1.13.0",
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

