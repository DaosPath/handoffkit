import path from "node:path";
import { fileURLToPath } from "node:url";

import { MessageEnvelope, SessionConfig } from "@handoffkit/csp";
import { SubprocessStdioTransport } from "@handoffkit/node";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const defaultBinary = path.join(root, ".local-tests", "bin", process.platform === "win32" ? "handoffkit-worker.exe" : "handoffkit-worker");
const binary = path.resolve(process.env.HANDOFFKIT_GO_BIN || defaultBinary);
const transport = SubprocessStdioTransport.spawn([binary], { cwd: root, env: process.env });
const config = new SessionConfig({ sessionId: "javascript-go-demo" });
let sequence = 0;

function envelope({ kind, channel, payload, target = "go-worker" }) {
  const id = `javascript-go-${sequence}`;
  return new MessageEnvelope({
    messageId: id, sessionId: config.sessionId, channel, kind,
    source: "javascript-demo", target, sequence: sequence++, payloadType: "json",
    payload, idempotencyKey: id,
  });
}

try {
  const opening = envelope({ kind: "session_open", channel: "control", target: null, payload: { protocol_version: "1.0", runtime: "javascript", session_config: config.toWire(), capabilities: ["request_response"] } });
  await transport.send(opening);
  const ready = await transport.receive();
  if (ready.kind !== "session_ready" || ready.correlationId !== opening.messageId) throw new Error("Go worker did not complete HK-CSP handshake");
  const request = envelope({ kind: "request", channel: "requests", payload: { task: "JavaScript starts a Go HK-CSP worker" } });
  await transport.send(request);
  const response = await transport.receive();
  if (response.correlationId !== request.messageId) throw new Error("Go worker response did not match request");
  const closing = envelope({ kind: "session_close", channel: "control", payload: {} });
  await transport.send(closing);
  const closed = await transport.receive();
  if (closed.correlationId !== closing.messageId) throw new Error("Go worker close response was not correlated");
  process.stdout.write(`${JSON.stringify({ success: response.kind === "result" && closed.kind === "session_closed", source_runtime: "javascript", target_runtime: ready.payload.peer_runtime, payload: response.payload }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`HK-CSP JS/Go demo error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await transport.close();
}
