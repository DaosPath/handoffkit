#!/usr/bin/env node

// Real Node.js TLS 1.3 + mTLS client for the C++ HK-CSP worker interop gate.
// Deliberately uses the TCP wire framing directly so the test proves the
// cross-runtime frame contract independently from a same-runtime mock.

import fs from "node:fs";
import tls from "node:tls";

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const host = option("--host", "127.0.0.1");
const port = Number(option("--port"));
const ca = option("--ca");
const cert = option("--cert");
const key = option("--key");
const worker = option("--worker", "cpp-ml-worker-interoperability");
const source = option("--source", "client-peer");
const session = option("--session", "node-cpp-tcp");
const nonce = option("--nonce", "node-cpp-tcp-nonce");

if (!Number.isInteger(port) || port < 1 || !ca || !cert || !key) {
  throw new Error("usage: node_tcp_client.mjs --port PORT --ca CA --cert CERT --key KEY");
}

function envelope(kind, sequence, messageId) {
  return {
    protocol_version: "1.0",
    message_id: messageId,
    session_id: session,
    channel: "control",
    kind,
    source,
    target: worker,
    sequence,
    created_at: new Date().toISOString(),
    deadline: null,
    correlation_id: null,
    causation_id: null,
    idempotency_key: `${session}-${sequence}`,
    attempt: 1,
    requires_ack: false,
    payload_type: kind,
    payload: {},
    metadata: { nonce },
  };
}

function readFrame(socket) {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length < 4) return;
      const size = buffer.readUInt32BE(0);
      if (buffer.length < size + 4) return;
      socket.off("data", onData);
      resolve(JSON.parse(buffer.subarray(4, size + 4).toString("utf8")));
    };
    socket.on("data", onData);
    socket.once("error", reject);
    socket.once("close", () => reject(new Error("C++ TLS peer closed before a frame")));
  });
}

const socket = tls.connect({
  host,
  port,
  servername: "localhost",
  ca: fs.readFileSync(ca),
  cert: fs.readFileSync(cert),
  key: fs.readFileSync(key),
  minVersion: "TLSv1.3",
  maxVersion: "TLSv1.3",
  rejectUnauthorized: true,
});
socket.setTimeout(10000, () => socket.destroy(new Error("Node TLS interop timeout")));
await new Promise((resolve, reject) => {
  socket.once("secureConnect", resolve);
  socket.once("error", reject);
});
if (socket.getProtocol() !== "TLSv1.3" || !socket.authorized) {
  throw new Error(`Node TLS policy mismatch: protocol=${socket.getProtocol()} authorized=${socket.authorized}`);
}

const encoded = Buffer.from(JSON.stringify(envelope("worker_capabilities", 1, `${session}-1`)), "utf8");
const frame = Buffer.allocUnsafe(encoded.length + 4);
frame.writeUInt32BE(encoded.length, 0);
encoded.copy(frame, 4);
socket.write(frame);
const response = await readFrame(socket);
if (response.kind !== "worker_capabilities" || response.source !== worker) {
  throw new Error(`unexpected C++ response: ${JSON.stringify(response)}`);
}
console.log(JSON.stringify({
  runtime: "node",
  protocol: socket.getProtocol(),
  authorized: socket.authorized,
  response_kind: response.kind,
  response_source: response.source,
}));
socket.end();
