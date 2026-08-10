# @handoffkit/csp

Browser-safe HK-CSP runtime. HK-CSP means **Communicating Sequential
Processes**, not Content Security Policy.

This package contains browser-safe contracts and local policy helpers. It does
not open TLS sockets, read private keys, verify certificates, or advertise
provider-backed cryptography. Use a platform transport such as
`@handoffkit/node` for those capabilities.

`DistributedScheduler` accepts a synchronous state-store contract, but this
browser-safe package ships no filesystem backend. `@handoffkit/node` provides
the optional bounded/checksummed file store. With it, queued work, counters,
and dedup identities survive restart; in-flight assignments become explicit
`interrupted` records requiring retry/fail by default. The opt-in
`auto_resume` path requeues them as at-least-once work only; exactly-once
effects are not claimed.

```bash
pnpm add @handoffkit/csp
```

```js
import { CspRuntime, makeEnvelope } from "@handoffkit/csp";

const session = new CspRuntime().createSession({ sessionId: "demo" });
session.channel("tasks");
session.spawn("worker", async (context) => {
  const message = await context.receive("tasks");
  context.ack(message);
});
await session.send("tasks", makeEnvelope({
  sessionId: "demo",
  channel: "tasks",
  source: "app",
  sequence: 1,
  payloadType: "json",
  payload: { task: "work" },
}));
await session.wait();
```

The package has no Node built-ins. Install `@handoffkit/node` for local stdio
process transport.
