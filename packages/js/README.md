# HandoffKit JavaScript

Modular JavaScript runtime, contract layers, and utilities for multi-agent workflows with structured handoffs.

Both browser-safe and server-side runtimes are supported natively in ES Modules.

## Packages

| Package | Directory | Description |
|---|---|---|
| [`@handoffkit/core`](./core) | `packages/js/core` | Browser-safe core runtime: `Agent`, `Team`, `HandoffState`, validation, and quality scoring. |
| [`@handoffkit/node`](./node) | `packages/js/node` | Node.js filesystem integration: trace stores, reports, and project indexer. |
| [`@handoffkit/providers`](./providers) | `packages/js/providers` | LLM provider registry, selectors, and fallbacks. |
| [`@handoffkit/recipes`](./recipes) | `packages/js/recipes` | Workflow recipe templates and workflow runners. |
| [`@handoffkit/templates`](./templates) | `packages/js/templates` | Scaffolder and workspace starter templates. |
| [`@handoffkit/cli`](./cli) | `packages/js/cli` | Autonomous Node.js CLI (`handoffkit-js`). |

## Installation

Install the package suited for your runtime environment:

```bash
# Browser, Edge, Deno, Bun, or general ESM app:
npm install @handoffkit/core

# Node.js app with filesystem storage:
npm install @handoffkit/node

# Node.js CLI and showcases:
npm install -g @handoffkit/cli
```

## Running Tests

From the monorepo root:

```bash
pnpm js:check
pnpm js:test
```
