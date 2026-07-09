import assert from "node:assert/strict";
import test from "node:test";

import {
  EchoProvider,
  GROQ_SPEC,
  NVIDIA_SPEC,
  OLLAMA_SPEC,
  OPENCODE_SPEC,
  OPENROUTER_SPEC,
  OpenAICompatibleProvider,
  PROVIDER_SPECS,
  ProviderAPIError,
  ProviderConfigurationError,
  ProviderRouter,
  ProviderSelector,
  RetryPolicy,
  createProvider,
  getProviderSpec,
  listProviderSpecs,
  redactSecrets,
} from "../src/index.js";

function jsonResponse(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
  };
}

test("provider specs include requested OpenAI-compatible targets", () => {
  assert.equal(PROVIDER_SPECS.groq.baseURL, "https://api.groq.com/openai/v1");
  assert.equal(PROVIDER_SPECS.openrouter.baseURL, "https://openrouter.ai/api/v1");
  assert.equal(PROVIDER_SPECS.nvidia.baseURL, "https://integrate.api.nvidia.com/v1");
  assert.equal(PROVIDER_SPECS.ollama.baseURL, "http://localhost:11434/v1");
  assert.equal(OPENCODE_SPEC.requiresApiKey, false);
  assert.equal(NVIDIA_SPEC.requiresApiKey, true);
  assert.equal(GROQ_SPEC.apiKeyEnv, "GROQ_API_KEY");
  assert.equal(OPENROUTER_SPEC.chatCompletionsPath, "/chat/completions");
  assert.equal(OLLAMA_SPEC.defaultModel, "llama3.1");
  assert.ok(listProviderSpecs().some((spec) => spec.id === "openai-compatible"));
  assert.equal(getProviderSpec("groq").name, "Groq");
  assert.throws(() => getProviderSpec("missing"), ProviderConfigurationError);
});

test("echo provider works sync and async", async () => {
  const provider = new EchoProvider({ model: "unit" });

  assert.equal(provider.generate("hello"), "Echo(unit): hello");
  assert.equal(await provider.agenerate("hello"), "Echo(unit): hello");
});

test("openai-compatible provider posts chat completions with injected fetch", async () => {
  const calls = [];
  const provider = new OpenAICompatibleProvider({
    provider: "groq",
    apiKey: "sk-test",
    model: "llama-test",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({
        choices: [{ message: { content: "done" } }],
      });
    },
    allowEnv: false,
  });

  const output = await provider.agenerate("Ship it", { temperature: 0.2 });

  assert.equal(output, "done");
  assert.equal(calls[0].url, "https://api.groq.com/openai/v1/chat/completions");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.Authorization, "Bearer sk-test");
  assert.equal(JSON.parse(calls[0].init.body).model, "llama-test");
  assert.equal(JSON.parse(calls[0].init.body).messages[0].content, "Ship it");
  assert.equal(JSON.parse(calls[0].init.body).temperature, 0.2);
});

test("openai-compatible provider supports message arrays and raw chat responses", async () => {
  const provider = new OpenAICompatibleProvider({
    provider: "openrouter",
    apiKey: "or-key",
    model: "openai/gpt-test",
    fetchImpl: async () => jsonResponse({
      choices: [{ message: { content: [{ type: "text", text: "chunk " }, { text: "text" }] } }],
    }),
    allowEnv: false,
  });

  const output = await provider.agenerate([{ role: "user", content: "hi" }], {
    headers: { "HTTP-Referer": "https://example.test" },
  });

  assert.equal(output, "chunk text");
});

test("provider configuration requires explicit apiKey and model when needed", async () => {
  const provider = new OpenAICompatibleProvider({
    provider: "groq",
    model: "llama-test",
    allowEnv: false,
    fetchImpl: async () => jsonResponse({ choices: [] }),
  });

  await assert.rejects(() => provider.agenerate("hello"), {
    name: "ProviderConfigurationError",
    provider: "groq",
  });

  const opencode = new OpenAICompatibleProvider({
    provider: "opencode",
    baseURL: "http://127.0.0.1:1337/v1",
    model: "local-model",
    allowEnv: false,
    fetchImpl: async () => jsonResponse({ choices: [{ message: { content: "local" } }] }),
  });
  assert.equal(await opencode.agenerate("hello"), "local");
});

test("api errors redact configured secrets", async () => {
  const provider = new OpenAICompatibleProvider({
    provider: "nvidia",
    apiKey: "nvapi-secret",
    model: "nvidia/test",
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      async text() {
        return '{"error":"bad bearer nvapi-secret","api_key":"nvapi-secret"}';
      },
    }),
    allowEnv: false,
  });

  await assert.rejects(
    () => provider.agenerate("hello"),
    (error) => {
      assert.equal(error instanceof ProviderAPIError, true);
      assert.equal(error.status, 401);
      assert.doesNotMatch(error.message, /nvapi-secret/);
      assert.match(error.message, /\[redacted\]/);
      return true;
    }
  );

  assert.equal(redactSecrets("Authorization: Bearer abc123", ["abc123"]), "Authorization: Bearer [redacted]");
});

test("retry policy retries configured HTTP statuses", async () => {
  let attempts = 0;
  const provider = new OpenAICompatibleProvider({
    provider: "openrouter",
    apiKey: "or-key",
    model: "openai/gpt-test",
    retryPolicy: new RetryPolicy({ maxAttempts: 2, baseDelayMs: 0, sleepImpl: async () => {} }),
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) {
        return {
          ok: false,
          status: 429,
          async text() {
            return "rate limit";
          },
        };
      }
      return jsonResponse({ choices: [{ message: { content: "retried" } }] });
    },
    allowEnv: false,
  });

  assert.equal(await provider.agenerate("hello"), "retried");
  assert.equal(attempts, 2);
});

test("provider selector and router choose configured fallback providers", async () => {
  const broken = new OpenAICompatibleProvider({
    id: "broken",
    provider: "opencode",
    baseURL: "http://127.0.0.1:9999/v1",
    model: "local",
    fetchImpl: async () => ({
      ok: false,
      status: 503,
      async text() {
        return "offline";
      },
    }),
    allowEnv: false,
  });
  const echo = new EchoProvider({ id: "echo-backup", model: "backup" });
  const selector = new ProviderSelector({ providers: [broken, echo] });
  const router = new ProviderRouter({ providers: [broken, echo] });

  assert.equal(selector.select({ configured: true }).id, "broken");
  assert.equal(await router.route("hello"), "Echo(backup): hello");
});

test("factory creates echo and OpenAI-compatible providers", () => {
  assert.equal(createProvider("echo").id, "echo");
  const provider = createProvider("ollama", {
    baseURL: "http://localhost:11434/v1",
    model: "llama3.1",
    allowEnv: false,
  });

  assert.equal(provider.id, "ollama");
  assert.equal(provider.isConfigured(), true);
});
