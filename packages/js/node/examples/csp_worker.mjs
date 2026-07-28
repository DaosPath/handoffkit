import { NodeStdioTransport } from "@handoffkit/node";
import { makeEnvelope } from "@handoffkit/csp";

const transport = new NodeStdioTransport({ readable: process.stdin, writable: process.stdout });

try {
  const incoming = await transport.receive();
  const response = makeEnvelope({
    sessionId: incoming.sessionId,
    channel: "responses",
    source: "javascript-worker",
    target: incoming.source,
    sequence: incoming.sequence,
    payloadType: "interop_result",
    payload: {
      accepted_message_id: incoming.messageId,
      runtime: "javascript",
      handoff_state: incoming.payload,
    },
    idempotencyKey: incoming.idempotencyKey,
  });
  await transport.send(response);
} catch (error) {
  process.stderr.write(`HK-CSP worker error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await transport.close();
}
