import tls from "node:tls";
import { generateKeyPairSync } from "node:crypto";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { performance } from "node:perf_hooks";
import { join } from "node:path";

import { SecurityConfig, SecurityProfile } from "../../packages/js/csp/src/index.js";
import {
  ArtifactSigner,
  ArtifactSigningCredential,
  ArtifactTrustPolicy,
  buildTlsOptions,
  getSupportedNodeCryptoCapabilities,
  verifySignedArtifact,
} from "../../packages/js/node/src/security.js";
import { generateTlsFixtures } from "../../packages/js/node/test-support/security-fixtures.mjs";

const generatedFixtures = generateTlsFixtures();
const tlsFixtures = generatedFixtures.root;
process.once("exit", () => generatedFixtures.cleanup());

function argument(name, fallback) {
  const prefix = `--${name}=`;
  const item = process.argv.find((value) => value.startsWith(prefix));
  return item ? Number(item.slice(prefix.length)) : fallback;
}

const iterations = argument("iterations", 25);
const warmup = argument("warmup", 3);
const transferBytes = argument("bytes", 4 * 1024 * 1024);
if (!Number.isInteger(iterations) || iterations < 3) throw new Error("iterations must be >= 3");
if (!Number.isInteger(warmup) || warmup < 0) throw new Error("warmup must be >= 0");
if (!Number.isInteger(transferBytes) || transferBytes < 1024) {
  throw new Error("bytes must be >= 1024");
}

function percentile(sorted, quantile) {
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1);
  return sorted[index];
}

function distribution(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    count: sorted.length,
    mean_ms: sum / sorted.length,
    p50_ms: percentile(sorted, 0.50),
    p95_ms: percentile(sorted, 0.95),
    p99_ms: percentile(sorted, 0.99),
    min_ms: sorted[0],
    max_ms: sorted.at(-1),
  };
}

function networkConfig(profile, role) {
  return new SecurityConfig({
    profile,
    requireMtls: true,
    trustDomain: "handoffkit.internal",
    caCertPath: join(tlsFixtures, "ca_cert.pem"),
    certPath: join(tlsFixtures, `${role}_cert.pem`),
    keyPath: join(tlsFixtures, `${role}_key.pem`),
  });
}

async function listen(profile, onSocket = () => {}) {
  const server = tls.createServer(buildTlsOptions(networkConfig(profile, "server"), true), onSocket);
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  return server;
}

async function closeServer(server) {
  await new Promise((resolvePromise) => server.close(resolvePromise));
}

async function connect(profile, port) {
  const started = performance.now();
  const socket = tls.connect({
    host: "127.0.0.1",
    port,
    ...buildTlsOptions(networkConfig(profile, "client"), false, { servername: "localhost" }),
  });
  await new Promise((resolvePromise, reject) => {
    socket.once("secureConnect", resolvePromise);
    socket.once("error", reject);
  });
  return { socket, handshakeMs: performance.now() - started };
}

async function benchmarkProfile(profile) {
  const server = await listen(profile);
  const port = server.address().port;
  const handshakes = [];
  const rssBefore = process.memoryUsage().rss;
  try {
    for (let index = 0; index < warmup; index += 1) {
      const { socket } = await connect(profile, port);
      socket.end();
      await new Promise((resolvePromise) => socket.once("close", resolvePromise));
    }
    for (let index = 0; index < iterations; index += 1) {
      const { socket, handshakeMs } = await connect(profile, port);
      handshakes.push(handshakeMs);
      socket.end();
      await new Promise((resolvePromise) => socket.once("close", resolvePromise));
    }
  } finally {
    await closeServer(server);
  }
  const rssAfter = process.memoryUsage().rss;

  let received = 0;
  const throughputServer = await listen(profile, (socket) => {
    socket.on("data", (chunk) => {
      received += chunk.length;
      if (received >= transferBytes) socket.write("ack");
    });
  });
  const { socket } = await connect(profile, throughputServer.address().port);
  const payload = Buffer.alloc(Math.min(64 * 1024, transferBytes), 0x5a);
  const transferStarted = performance.now();
  let remaining = transferBytes;
  while (remaining > 0) {
    const chunk = remaining >= payload.length ? payload : payload.subarray(0, remaining);
    if (!socket.write(chunk)) {
      await new Promise((resolvePromise) => socket.once("drain", resolvePromise));
    }
    remaining -= chunk.length;
  }
  await new Promise((resolvePromise, reject) => {
    socket.once("data", resolvePromise);
    socket.once("error", reject);
  });
  const transferSeconds = (performance.now() - transferStarted) / 1000;
  socket.end();
  await new Promise((resolvePromise) => socket.once("close", resolvePromise));
  await closeServer(throughputServer);

  return {
    available: true,
    handshake: distribution(handshakes),
    reconnect: distribution(handshakes.slice(1)),
    throughput: {
      bytes: transferBytes,
      seconds: transferSeconds,
      mebibytes_per_second: transferBytes / (1024 * 1024) / transferSeconds,
    },
    memory: {
      metric: "process_rss_delta_bytes",
      before_bytes: rssBefore,
      after_bytes: rssAfter,
      delta_bytes: rssAfter - rssBefore,
    },
  };
}

function benchmarkSignatures() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const identity = "spiffe://handoffkit.internal/producer/build-1";
  const signer = new ArtifactSigner(
    privateKey.export({ type: "pkcs8", format: "pem" }),
    identity,
  );
  const policy = new ArtifactTrustPolicy([
    new ArtifactSigningCredential({
      signerIdentity: identity,
      publicKey: publicKey.export({ type: "spki", format: "pem" }),
      validFrom: 1,
      validUntil: 4_000_000_000,
    }),
  ]);
  const data = Buffer.alloc(64 * 1024, 0x48);
  const signs = [];
  const verifies = [];
  let signed;
  for (let index = 0; index < iterations; index += 1) {
    let started = performance.now();
    signed = signer.sign(`benchmark-${index}`, data, { createdAt: 2_000_000_000 });
    signs.push(performance.now() - started);
    started = performance.now();
    verifySignedArtifact(data, signed, policy, { now: 2_000_000_000 });
    verifies.push(performance.now() - started);
  }
  return { sign: distribution(signs), verify: distribution(verifies) };
}

const capabilities = getSupportedNodeCryptoCapabilities();
const result = {
  notice: "Environmental measurement — not a performance guarantee.",
  runtime: "node",
  provider: capabilities.provider,
  generated_at: new Date().toISOString(),
  environment: {
    cpu: cpus()[0]?.model || "unknown",
    logical_cpus: cpus().length,
    ram_bytes: totalmem(),
    os: `${platform()} ${release()}`,
    architecture: arch(),
    node: process.version,
    openssl: process.versions.openssl || "unknown",
  },
  parameters: {
    samples: iterations,
    warmup,
    transfer_bytes: transferBytes,
    signature_payload_bytes: 64 * 1024,
    concurrency: 1,
  },
  standard: await benchmarkProfile(SecurityProfile.STANDARD),
  hybrid_pq: capabilities.hybrid_pq_supported
    ? await benchmarkProfile(SecurityProfile.HYBRID_PQ)
    : {
      available: false,
      reason: "active provider does not expose X25519MLKEM768",
      fallback_used: false,
    },
  artifact_ed25519: benchmarkSignatures(),
};

if (process.env.HANDOFFKIT_REQUIRE_HYBRID_PQ === "1" && !result.hybrid_pq.available) {
  throw new Error(`${capabilities.provider} does not expose X25519MLKEM768`);
}
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
