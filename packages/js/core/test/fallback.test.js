import test from "node:test";
import assert from "node:assert/strict";
import { EchoProvider, FailingProvider, FallbackProvider } from "../src/providers-core.js";

test("FallbackProvider uses secondary after primary fails", () => {
  const fb = new FallbackProvider({
    providers: [
      new FailingProvider({ model: "a", message: "down" }),
      new EchoProvider({ model: "b" }),
    ],
  });
  const out = fb.generate("hello");
  assert.match(out, /hello/);
  assert.equal(fb.selectedModel, "b");
  assert.ok(fb.lastErrors.length >= 1);
});
