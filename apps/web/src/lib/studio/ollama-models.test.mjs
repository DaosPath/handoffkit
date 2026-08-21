import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";

const modPath = pathToFileURL(
  path.join(process.cwd(), "src/lib/studio/ollama-models.ts"),
).href;
const { discoverOllamaModels, toOllamaModelOption } = await import(modPath);

const response = (body, ok = true) => ({
  ok,
  json: async () => body,
});

const available = await discoverOllamaModels(
  "http://127.0.0.1:11434/",
  async (url) => {
    assert.equal(url, "http://127.0.0.1:11434/api/tags");
    return response({
      models: [
        { name: "liquid-2.6b:latest" },
        { model: "qwen3:8b" },
        { name: "liquid-2.6b:latest" },
      ],
    });
  },
);
assert.equal(available.ready, true);
assert.deepEqual(
  available.models.map((model) => model.id),
  ["liquid-2.6b:latest", "qwen3:8b"],
);
assert.equal(available.models[0].publisher, "Ollama local");
assert.match(available.models[0].label, /Liquid 2\.6b/i);

const unavailable = await discoverOllamaModels(
  "http://127.0.0.1:11434",
  async () => response({}, false),
);
assert.equal(unavailable.ready, false);
assert.equal(unavailable.models.length, 0);
assert.equal(unavailable.errorCode, "ollama_unavailable");

const malformed = await discoverOllamaModels(
  "http://127.0.0.1:11434",
  async () => response({ models: "not-an-array" }),
);
assert.equal(malformed.ready, false);
assert.equal(malformed.errorCode, "ollama_invalid_response");

const noModels = await discoverOllamaModels(
  "http://127.0.0.1:11434",
  async () => response({ models: [] }),
);
assert.equal(noModels.ready, false);
assert.equal(noModels.errorCode, "ollama_no_models");

assert.equal(toOllamaModelOption("liquid-2.6b").id, "liquid-2.6b");
console.log("ollama model discovery tests passed");
