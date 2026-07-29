import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { makeEnvelope } from "@handoffkit/csp";

import {
  FileDedupStore,
  LengthDelimitedTransport,
  NetworkConfig,
  TcpTransport,
} from "../src/index.js";

test("file dedup store survives restart and releases retries", async () => {
  const directory = await mkdtemp(join(tmpdir(), "handoffkit-dedup-"));
  const filePath = join(directory, "dedup.ndjson");
  const first = new FileDedupStore(filePath, { capacity: 2 });
  assert.equal(first.claim("key-1"), true);
  assert.equal(first.claim("key-1"), false);
  const second = new FileDedupStore(filePath, { capacity: 2 });
  assert.equal(second.contains("key-1"), true);
  assert.equal(second.release("key-1"), true);
  assert.equal(new FileDedupStore(filePath, { capacity: 2 }).claim("key-1"), true);
});

test("TCP length-delimited transport exchanges a real envelope", async () => {
  let resolveHandled;
  let rejectHandled;
  const handled = new Promise((resolve, reject) => { resolveHandled = resolve; rejectHandled = reject; });
  const server = createServer(async (socket) => {
    const transport = new LengthDelimitedTransport(socket);
    try {
      const envelope = await transport.receive();
      await transport.send(envelope);
      resolveHandled();
    } catch (error) {
      rejectHandled(error);
    } finally {
      await transport.close();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  const client = await TcpTransport.connect("127.0.0.1", port);
  const envelope = makeEnvelope({ sessionId: "network", channel: "tasks", source: "javascript", payloadType: "json", payload: { ok: true }, sequence: 1 });
  await client.send(envelope);
  assert.deepEqual((await client.receive()).toWire(), envelope.toWire());
  await handled;
  await client.close();
  server.close();
  await once(server, "close");
});

test("TCP transport rejects oversized length before allocation", async () => {
  const server = createServer((socket) => {
    const header = Buffer.alloc(4);
    header.writeUInt32BE(4097);
    socket.end(header);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const client = await TcpTransport.connect("127.0.0.1", server.address().port, { config: new NetworkConfig({ maxMessageBytes: 4096 }) });
  await assert.rejects(client.receive(), /exceeds 4096 bytes/);
  await client.close();
  server.close();
  await once(server, "close");
});
