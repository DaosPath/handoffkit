# @handoffkit/core

JavaScript contract layer for multi-agent workflows with structured handoffs.

This package mirrors the Python HandoffKit contracts in a small dependency-free
ESM package. Both runtimes share canonical JSON fixtures in
`packages/contracts`.

- `HandoffState`
- `HandoffProtocol`
- `Agent`
- `Team`
- `ValidationReport`
- `HandoffQualityEvaluator`
- `RunTrace`
- `ReplayRunner`
- `FileTraceStore`
- `ProviderToolAdapter`
- `ToolRegistry`
- `defineTool`

## Install

Not published yet. In the monorepo:

```bash
pnpm core:test
pnpm core:check
```

## Quick Example

```js
import { Agent, HandoffProtocol, RunTrace, Team, ReplayRunner } from "@handoffkit/core";

const team = new Team({
  agents: [
    new Agent({ name: "Architect", role: "Plan the work." }),
    new Agent({ name: "Coder", role: "Implement the work." }),
    new Agent({ name: "Tester", role: "Verify the work." }),
  ],
  protocol: new HandoffProtocol({ mode: "hybrid_state" }),
});

const result = team.run("Build a small calculator CLI.");
const trace = RunTrace.fromTeamResult(result);
const replay = new ReplayRunner(trace).summary();

console.log(result.handoffs[0].toJSON());
console.log(replay);
```

## Shared Python/JS Contract

Wire JSON uses `snake_case`, matching the Python runtime:

```js
const state = new HandoffState({
  task: "Build a CLI",
  fromAgent: "Architect",
  toAgent: "Coder",
  summary: "Use structured handoffs.",
});

console.log(state.fromAgent); // JS ergonomics
console.log(JSON.stringify(state)); // {"from_agent":"Architect", ...}
```

`HandoffState.fromJSON()` and `RunTrace.fromJSON()` accept both snake_case and
camelCase inputs, but `toJSON()` always emits the shared canonical format.

## Async Runtime

```js
const result = await team.arun("Build a small calculator CLI.");
console.log(result.finalOutput);
```

## Provider Tool Formats

```js
import { ProviderToolAdapter, defineTool } from "@handoffkit/core";

const add = defineTool({
  name: "add",
  description: "Add two numbers.",
  parameters: { type: "object" },
  execute: ({ a, b }) => a + b,
});

const adapter = new ProviderToolAdapter();
const openaiTools = adapter.toolsToProviderFormat([add], "openai");
const anthropicTools = adapter.toolsToProviderFormat([add], "anthropic");

console.log(openaiTools, anthropicTools);
```

## Trace Reports

```js
import { FileTraceStore, RunTrace, writeReportFiles } from "@handoffkit/core";

const trace = RunTrace.fromTeamResult(result);
await new FileTraceStore({ root: "traces" }).save(trace, "latest");
await writeReportFiles(trace, "latest", "reports");
```

## Design Notes

- No runtime dependencies.
- Offline deterministic tests.
- ESM-first.
- Browser-compatible core shapes where possible.
- Provider/network adapters should live in separate packages later.
