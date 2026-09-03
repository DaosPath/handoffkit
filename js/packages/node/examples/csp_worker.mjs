import { MessageEnvelope } from "@handoffkit/csp";
import { NodeStdioTransport } from "@handoffkit/node";

const transport = new NodeStdioTransport({ readable: process.stdin, writable: process.stdout });
let sequence = 1;

function responseFor(incoming, { kind, payloadType = "json", payload }) {
  return new MessageEnvelope({
    messageId: `javascript-${process.pid}-${sequence}`,
    sessionId: incoming.sessionId,
    channel: incoming.channel,
    kind,
    source: "javascript-worker",
    target: incoming.source,
    sequence: sequence++,
    payloadType,
    payload,
    correlationId: incoming.messageId,
    causationId: incoming.messageId,
    idempotencyKey: `javascript-response-${incoming.messageId}`,
  });
}

async function serve() {
  const opening = await transport.receive();
  if (opening.kind !== "session_open") {
    await transport.send(
      responseFor(opening, {
        kind: "session_reject",
        payload: { code: "handshake_required", message: "first message must be session_open" },
      }),
    );
    throw new Error("first message must be session_open");
  }
  const requestedVersion = String(opening.payload?.protocol_version ?? "");
  if (requestedVersion.split(".")[0] !== "1") {
    await transport.send(
      responseFor(opening, {
        kind: "session_reject",
        payload: { code: "version_mismatch", message: "unsupported HK-CSP protocol version" },
      }),
    );
    return;
  }
  const configuredSession = opening.payload?.session_config?.session_id;
  if (configuredSession !== opening.sessionId) {
    await transport.send(
      responseFor(opening, {
        kind: "session_reject",
        payload: { code: "session_mismatch", message: "handshake session IDs differ" },
      }),
    );
    return;
  }
  await transport.send(
    responseFor(opening, {
      kind: "session_ready",
      payload: {
        protocol_version: "1.0",
        session_id: opening.sessionId,
        peer_runtime: "javascript",
        capabilities: ["handoff_state", "request_response"],
      },
    }),
  );

  while (true) {
    const incoming = await transport.receive();
    if (incoming.sessionId !== opening.sessionId) {
      await transport.send(
        responseFor(incoming, {
          kind: "nack",
          payloadType: "delivery_nack",
          payload: {
            message_id: incoming.messageId,
            code: "session_mismatch",
            message: "message belongs to another session",
            retryable: false,
            processed_at: new Date().toISOString(),
            metadata: {},
          },
        }),
      );
      continue;
    }
    if (incoming.kind === "session_close" || incoming.kind === "cancel") {
      await transport.send(
        responseFor(incoming, {
          kind: incoming.kind === "cancel" ? "cancelled" : "session_closed",
          payload: { success: true },
        }),
      );
      break;
    }
    if (["data", "request", "workflow_start", "workflow_step"].includes(incoming.kind)) {
      await transport.send(
        responseFor(incoming, {
          kind: "result",
          payloadType: "interop_result",
          payload: {
            accepted_message_id: incoming.messageId,
            runtime: "javascript",
            handoff_state: incoming.payload,
          },
        }),
      );
      continue;
    }
    await transport.send(
      responseFor(incoming, {
        kind: "nack",
        payloadType: "delivery_nack",
        payload: {
          message_id: incoming.messageId,
          code: "unknown_message_kind",
          message: "worker does not support this message kind",
          retryable: false,
          processed_at: new Date().toISOString(),
          metadata: {},
        },
      }),
    );
  }
}

try {
  await serve();
} catch (error) {
  process.stderr.write(`HK-CSP worker error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await transport.close();
}
