# @handoffkit/node

Node.js utilities for HandoffKit traces, reports, and project context indexing.

Use `@handoffkit/core` in browsers, Next.js client components, Vite, Deno,
Bun, Cloudflare Workers, and other runtime-neutral environments. Use
`@handoffkit/node` when you need local filesystem features in Node.js scripts.

## Install

```bash
pnpm add @handoffkit/core @handoffkit/node
```

## Trace Files

```js
import { Agent, FileTraceStore, RunTrace, Team, writeReportFiles } from "@handoffkit/node";

const team = new Team({ agents: [new Agent({ name: "Architect" }), new Agent({ name: "Coder" })] });
const trace = RunTrace.fromTeamResult(team.run("Build a calculator."));

await new FileTraceStore({ root: "traces" }).save(trace, "latest");
await writeReportFiles(trace, "latest", "reports");
```

## Project Context

```js
import { ContextRetriever, ProjectIndexer } from "@handoffkit/node";

const docs = new ProjectIndexer({ root: process.cwd() }).index();
const hits = new ContextRetriever(docs).search("handoff protocol");

console.log(hits.map((doc) => doc.path));
```
