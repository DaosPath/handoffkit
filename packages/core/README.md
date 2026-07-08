# @handoffkit/core

JavaScript contract layer for multi-agent workflows with structured handoffs.

This is the first JS package for HandoffKit. It mirrors the Python concepts in
a small dependency-free ESM package:

- `HandoffState`
- `HandoffProtocol`
- `Agent`
- `Team`
- `ValidationReport`
- `HandoffQualityEvaluator`
- `RunTrace`
- `ReplayRunner`
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

## Design Notes

- No runtime dependencies.
- Offline deterministic tests.
- ESM-first.
- Browser-compatible core shapes where possible.
- Provider/network adapters should live in separate packages later.
