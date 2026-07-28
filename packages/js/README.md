# HandoffKit JavaScript

Modular JavaScript runtime, contract layers, and utilities for multi-agent workflows with structured handoffs.

Both browser-safe and server-side runtimes are supported natively in ES Modules.

## Packages

| Package | Directory | Description |
|---|---|---|
| [`@handoffkit/core`](./core) | `packages/js/core` | Browser-safe core runtime: `Agent`, `Team`, `HandoffState`, validation, and quality scoring. |
| [`@handoffkit/csp`](./csp) | `packages/js/csp` | Browser-safe bounded channels, sessions, ACK/NACK, retries, cancellation, and backpressure. |
| [`@handoffkit/node`](./node) | `packages/js/node` | Node.js filesystem integration plus NDJSON stdio/process transports. |
| [`@handoffkit/providers`](./providers) | `packages/js/providers` | LLM provider registry, selectors, and fallbacks. |
| [`@handoffkit/browser`](./browser) | `packages/js/browser` | Browser-safe search, fetch, extraction, and research tools. |
| [`@handoffkit/recipes`](./recipes) | `packages/js/recipes` | Workflow recipe templates and workflow runners. |
| [`@handoffkit/templates`](./templates) | `packages/js/templates` | Scaffolder and workspace starter templates. |
| [`@handoffkit/cli`](./cli) | `packages/js/cli` | Autonomous Node.js CLI (`handoffkit-js`). |

## Installation

Install the package suited for your runtime environment:

```bash
# Browser, Edge, Deno, Bun, or general ESM app:
pnpm add @handoffkit/core @handoffkit/csp

# Node.js app with filesystem storage:
pnpm add @handoffkit/node

# Node.js CLI and showcases:
pnpm add --global @handoffkit/cli
```

`HandoffState` defines what data crosses an agent boundary. `@handoffkit/csp`
defines delivery: channels, ordering, backpressure, ACK/NACK, retries,
cancellation, and deadlines. All wire keys remain canonical `snake_case`.

## Running Tests

From the monorepo root:

```bash
pnpm js:check
pnpm js:test
```
