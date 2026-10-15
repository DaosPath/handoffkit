#!/usr/bin/env node

// Real Node.js TLS 1.3 + mTLS server for the reverse C++ interop gate.

import fs from "node:fs";
import tls from "node:tls";

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const port = Number(option("--port"));
const ca = option("--ca");
const cert = option("--cert");
const key = option("--key");
if (!Number.isInteger(port) || port < 1 || !ca || !cert || !key) {
  throw new Error("usage: node_tcp_server.mjs --port PORT --ca CA --cert CERT --key KEY");
}

const server = tls.createServer({
  ca: fs.readFileSync(ca),
  cert: fs.readFileSync(cert),
  key: fs.readFileSync(key),
  requestCert: true,
  rejectUnauthorized: true,
  minVersion: "TLSv1.3",
  maxVersion: "TLSv1.3",
}, (socket) => {
  if (!socket.authorized || socket.getProtocol() !== "TLSv1.3") {
    socket.destroy(new Error("Node reverse interop TLS policy mismatch"));
    return;
  }
  let buffer = Buffer.alloc(0);
  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length < 4) return;
    const size = buffer.readUInt32BE(0);
    if (buffer.length < size + 4) return;
    const request = JSON.parse(buffer.subarray(4, size + 4).toString("utf8"));
    const response = {
      ...request,
      message_id: "node-reverse-response",
      kind: "interop_echo",
      source: "node-server",
      target: request.source,
      sequence: 1,
      correlation_id: request.message_id,
      causation_id: request.message_id,
      payload_type: "interop_echo",
      payload: { runtime: "node", request_kind: request.kind },
    };
    const encoded = Buffer.from(JSON.stringify(response), "utf8");
    const frame = Buffer.allocUnsafe(encoded.length + 4);
    frame.writeUInt32BE(encoded.length, 0);
    encoded.copy(frame, 4);
    socket.end(frame);
    console.log(JSON.stringify({ runtime: "node", protocol: socket.getProtocol(), authorized: socket.authorized }));
    server.close();
  });
});
server.listen(port, "127.0.0.1");
