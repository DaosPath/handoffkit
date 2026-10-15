# @handoffkit/node

Node.js utilities for HandoffKit traces, reports, project context indexing, and
HK-CSP NDJSON stdio/process transport.

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

## HK-CSP stdio

```js
import { SubprocessStdioTransport } from "@handoffkit/node";

const transport = SubprocessStdioTransport.spawn([
  process.execPath,
  "./worker.mjs",
]);

await transport.send(envelope);
const reply = await transport.receive();
await transport.close();
```

stdio uses one canonical JSON envelope per line. Protocol frames go through
stdout/stdin; worker logs must use stderr. Process spawning always uses
`shell: false`.

## HK-CSP network security (experimental)

The Node package has a real TLS 1.3 TCP client/server path with explicit SNI,
hostname and CA verification, mTLS, certificate-derived URI SAN identity,
local capability grants, and mandatory replay checks before dispatch. Invalid
or unauthorized peers fail closed. `hybrid-pq` is exposed only when the active
OpenSSL provider accepts `X25519MLKEM768`; unsupported providers report false
and never fall back to `standard`. Secure `tlsOptions` overrides and direct
wrapping outside the validated TCP factories are rejected.

Ed25519 artifact sign/verify uses `node:crypto`. The file keystore is a
development backend, not an OS keystore. Optional durable replay/local-
revocation stores and atomic certificate/trust reload with transition-window
rotation are integration-tested; replay still resets on restart when no
durable store is configured. CRL/OCSP, OS keystores, zeroization guarantees,
and durable channel/session buffers remain unavailable. Node provides the
filesystem backend for the optional cross-runtime scheduler state store;
queued jobs survive restart, while in-flight assignments become interrupted
and require explicit retry/fail by default. The opt-in `autoResume` path
requeues them as at-least-once work only; exactly-once effects are not claimed.
See

[`HK_CSP_SECURITY.md`](../../../docs/spec/HK_CSP_SECURITY.md) for the exact
status ledger.
