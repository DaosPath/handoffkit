# HandoffKit JavaScript

Modular JavaScript runtime, contract layers, and utilities for multi-agent workflows with structured handoffs.

Both browser-safe and server-side runtimes are supported natively in ES Modules.

## Packages

| Package | Directory | Description |
|---|---|---|
| [`@handoffkit/core`](./core) | `js/packages/core` | Browser-safe core runtime: `Agent`, `Team`, `HandoffState`, validation, and quality scoring. |
| [`@handoffkit/csp`](./csp) | `js/packages/csp` | Browser-safe bounded channels, sessions, ACK/NACK, retries, cancellation, and backpressure. |
| [`@handoffkit/node`](./node) | `js/packages/node` | Node.js filesystem integration plus NDJSON stdio/process transports. |
| [`@handoffkit/providers`](./providers) | `js/packages/providers` | LLM provider registry, selectors, and fallbacks. |
| [`@handoffkit/browser`](./browser) | `js/packages/browser` | Browser-safe search, fetch, extraction, and research tools. |
| [`@handoffkit/recipes`](./recipes) | `js/packages/recipes` | Workflow recipe templates and workflow runners. |
| [`@handoffkit/templates`](./templates) | `js/packages/templates` | Scaffolder and workspace starter templates. |
| [`@handoffkit/cli`](./cli) | `js/packages/cli` | Autonomous Node.js CLI (`handoffkit-js`). |

The packages above are published on npm at the stable `1.19.5` release.

The 1.20 Browser Platform packages below are in development
(`1.20.0`, release candidate) and are **not published** to npm yet:

| Package | Directory | Description |
|---|---|---|
| [`@handoffkit/browser/core`](./browser#core-contracts-handoffkitbrowsercore) | `js/packages/browser/src/core` | I/O-free Browser Core wire contracts, shipped as a subpath export of `@handoffkit/browser` (the Lite product). |
| [`@handoffkit/browser-real`](./browser-real) | `js/packages/browser-real` | Supervised Browser Real service (explicitly installed headless Chromium). |

In-repo only (`private`, never published to npm):

| Package | Directory | Description |
|---|---|---|
| [`@handoffkit/clinical`](./clinical) | `js/packages/clinical` | Experimental Clinical Sequential Reasoning Lab contracts and client used by Studio; not clinically validated. |

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
