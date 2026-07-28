# @handoffkit/csp

Browser-safe HK-CSP runtime. HK-CSP means **Communicating Sequential
Processes**, not Content Security Policy.

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
