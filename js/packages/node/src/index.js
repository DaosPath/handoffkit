import fs from "node:fs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import path, { join } from "node:path";

import {
  DEFAULT_MAX_MESSAGE_BYTES,
  MIN_MESSAGE_BYTES,
  AuthenticationError,
  AuthorizationError,
  CapabilityPolicy,
  CertificateIdentityPolicy,
  MessageEnvelope,
  MessageTooLargeError,
  PeerIdentity,
  ReplayProtection,
  SecurityConfig,
  SecurityError,
  SecurityProfile,
  Transport,
  validateDeclaredPeerIdentity,
} from "@handoffkit/csp";
import {
  authenticateTlsSocket,
  buildTlsOptions,
  detectHybridPqSupport,
} from "./security.js";

export * from "@handoffkit/core";
import {
  ContextDocument,
  HANDOFFKIT_CORE_VERSION,
  MemoryItem,
  MemoryStore,
  RunTrace,
  buildContractParityReport,
} from "@handoffkit/core";

const DEFAULT_EXTENSIONS = new Set([".py", ".md", ".toml", ".json", ".txt", ".yaml", ".yml", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"]);
const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "target",
  "__pycache__",
  ".venv",
  "venv",
  ".ruff_cache",
  ".next",
  ".turbo",
  "coverage",
]);
const SECURE_TRANSPORT_FACTORY_TOKEN = Symbol("secure transport factory");

export class FileTraceStore {
  constructor({ root = "traces" } = {}) {
    this.root = path.resolve(root);
  }

  async save(trace, name = "") {
    const runTrace = trace instanceof RunTrace ? trace : RunTrace.fromJSON(trace);
    const fileName = `${safeFileName(name || runTrace.runId)}.json`;
    const filePath = join(this.root, fileName);
    await atomicWriteFile(filePath, runTrace.toJSONString(2));
    return filePath;
  }

  async load(nameOrPath) {
    const value = String(nameOrPath || "");
    if (!value) throw new TypeError("nameOrPath must be a non-empty string");
    const filePath = value.endsWith(".json") ? path.resolve(value) : join(this.root, `${safeFileName(value)}.json`);
    return RunTrace.fromJSON(await readFile(filePath, "utf8"));
  }

  async list() {
    try {
      const entries = await readdir(this.root, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => join(this.root, entry.name))
        .sort();
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
  }
}

export async function writeReportFiles(report, name, outputDir = "reports") {
  const base = join(path.resolve(outputDir), safeFileName(name));
  const jsonPath = `${base}.json`;
  const markdownPath = `${base}.md`;
  const data = report?.toJSON?.() ?? report;
  const markdown = report?.toMarkdown?.() ?? `# ${name}\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\`\n`;
  await Promise.all([
    atomicWriteFile(jsonPath, JSON.stringify(data, null, 2)),
    atomicWriteFile(markdownPath, markdown),
  ]);
  return { jsonPath, markdownPath };
}

export async function loadReportJSON(filePath) {
  const absolute = path.resolve(filePath);
  const source = await readFile(absolute, "utf8");
  try {
    return JSON.parse(source);
  } catch (cause) {
    throw new SyntaxError(`Invalid JSON report: ${absolute} (${cause.message})`, { cause });
  }
}

export async function buildNodeContractParityReport({
  runtime = "node",
  version = HANDOFFKIT_CORE_VERSION,
  contractsRoot = join(import.meta.dirname, "..", "..", "..", "..", "shared", "contracts"),
  expectedFixtures,
  expectedSchemas,
} = {}) {
  const inventory = await readContractInventory(contractsRoot);
  return buildContractParityReport({
    runtime,
    version,
    contractsRoot,
    contractInventory: inventory,
    expectedFixtures,
    expectedSchemas,
  });
}

export async function readContractInventory(contractsRoot) {
  const [fixtures, schemas] = await Promise.all([
    readDirectoryNames(join(contractsRoot, "fixtures")),
    readDirectoryNames(join(contractsRoot, "schemas")),
  ]);
  return { fixtures, schemas };
}

export class ProjectIndexer {
  constructor({ root = ".", allowedExtensions = null, maxFileSize = 64000, maxFiles = 10000 } = {}) {
    this.root = path.resolve(root);
    this.allowedExtensions = new Set(
      (allowedExtensions ? [...allowedExtensions] : [...DEFAULT_EXTENSIONS]).map((extension) =>
        String(extension).toLowerCase().startsWith(".") ? String(extension).toLowerCase() : `.${String(extension).toLowerCase()}`,
      ),
    );
    this.maxFileSize = normalizePositiveInteger(maxFileSize, 64000);
    this.maxFiles = normalizePositiveInteger(maxFiles, 10000);
  }

  index() {
    const docs = [];
    const walk = (dir) => {
      if (docs.length >= this.maxFiles) return;
      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (_) {
        return;
      }
      for (const entry of entries) {
        if (docs.length >= this.maxFiles) break;
        if (entry.isSymbolicLink()) continue;
        const fullPath = path.join(dir, entry.name);
        const relative = path.relative(this.root, fullPath);
        const parts = relative.split(path.sep);
        const isIgnored = parts.some((part) => IGNORED_DIRS.has(part) || part.endsWith(".egg-info"));
        if (isIgnored) continue;

        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile()) {
          const extension = path.extname(entry.name).toLowerCase();
          if (!this.allowedExtensions.has(extension)) continue;
          try {
            const fileStat = fs.statSync(fullPath);
            if (fileStat.size > this.maxFileSize) continue;
            const content = fs.readFileSync(fullPath, "utf8");
            const lines = content.split(/\r?\n/);
            docs.push(
              new ContextDocument({
                path: relative.replace(/\\/g, "/"),
                content,
                summary: this._summarize(entry.name, extension, lines, content),
                metadata: {
                  extension,
                  size: fileStat.size,
                  lineCount: lines.length,
                },
              }),
            );
          } catch (_) {
            // Ignore files that disappear or cannot be decoded while indexing.
          }
        }
      }
    };

    walk(this.root);
    return docs.sort((left, right) => left.path.localeCompare(right.path));
  }

  _summarize(name, extension, lines, content) {
    const preview = lines.slice(0, 3).map((line) => line.trim()).filter(Boolean).join(" ");
    return `${name}: ${lines.length} lines, ${Buffer.byteLength(content, "utf8")} bytes, extension ${extension}. ${preview}`.trim();
  }
}

export class JsonMemoryStore extends MemoryStore {
  constructor(filePath) {
    if (!filePath) throw new TypeError("filePath is required for JsonMemoryStore");
    const absolute = path.resolve(filePath);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    if (!fs.existsSync(absolute)) atomicWriteFileSync(absolute, "[]");
    const raw = fs.readFileSync(absolute, "utf8").trim();
    let items = [];
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) throw new TypeError("JSON memory store must contain a list");
        items = parsed.map((item) => MemoryItem.fromDict(item));
      } catch (cause) {
        throw new SyntaxError(`Invalid JSON memory store: ${absolute} (${cause.message})`, { cause });
      }
    }
    super({ items });
    this.filePath = absolute;
  }

  _save() {
    if (!this.filePath) return;
    const serialized = JSON.stringify(this.list().map((item) => item.toDict()), null, 2);
    atomicWriteFileSync(this.filePath, serialized);
  }
}

export class NodeStdioTransport extends Transport {
  constructor({ readable, writable, maxMessageBytes = DEFAULT_MAX_MESSAGE_BYTES }) {
    super();
    if (!readable || !writable) throw new TypeError("readable and writable streams are required");
    validateMaxMessageBytes(maxMessageBytes);
    this.readable = readable;
    this.writable = writable;
    this.maxMessageBytes = maxMessageBytes;
    this.buffer = "";
    this.lines = [];
    this.waiters = [];
    this.ended = false;
    this.failure = null;
    readable.setEncoding?.("utf8");
    readable.on("data", (chunk) => this._accept(String(chunk)));
    readable.on("end", () => this._finish());
    readable.on("error", (error) => this._finish(error));
  }

  _accept(chunk) {
    this.buffer += chunk;
    if (Buffer.byteLength(this.buffer, "utf8") > this.maxMessageBytes) {
      this._finish(new MessageTooLargeError(`stdio frame exceeds ${this.maxMessageBytes} bytes`));
      return;
    }
    while (true) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) break;
      const line = this.buffer.slice(0, newline).replace(/\r$/, "");
      this.buffer = this.buffer.slice(newline + 1);
      if (!line.trim()) continue;
      const waiter = this.waiters.shift();
      if (waiter) waiter.resolve(line);
      else this.lines.push(line);
    }
  }

  _finish(error = null) {
    if (this.ended) return;
    this.ended = true;
    this.failure = error;
    for (const waiter of this.waiters.splice(0)) {
      waiter.reject(error ?? new Error("stdio peer closed the protocol stream"));
    }
  }

  async send(value) {
    const envelope = value instanceof MessageEnvelope ? value : MessageEnvelope.fromWire(value);
    const data = `${envelope.toJSONString()}\n`;
    if (Buffer.byteLength(data, "utf8") > this.maxMessageBytes) {
      throw new MessageTooLargeError(`stdio frame exceeds ${this.maxMessageBytes} bytes`);
    }
    if (!this.writable.write(data, "utf8")) await once(this.writable, "drain");
  }

  async receive() {
    const line = this.lines.shift();
    if (line) return MessageEnvelope.fromJSON(line);
    if (this.ended) throw this.failure ?? new Error("stdio peer closed the protocol stream");
    const pending = new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
    return MessageEnvelope.fromJSON(await pending);
  }

  async close() {
    if (!this.writable.destroyed && !this.writable.writableEnded) this.writable.end();
    this._finish();
  }
}

export class FileDedupStore {
  constructor(filePath, { capacity = 4096, maxLogBytes = 16 * 1024 * 1024 } = {}) {
    if (!filePath) throw new TypeError("filePath is required");
    if (!Number.isInteger(capacity) || capacity < 1) throw new TypeError("capacity must be at least 1");
    if (!Number.isInteger(maxLogBytes) || maxLogBytes < 1024) throw new TypeError("maxLogBytes must be at least 1024");
    this.filePath = path.resolve(filePath);
    this.capacity = capacity;
    this.maxLogBytes = maxLogBytes;
    this.keys = new Map();
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    if (!fs.existsSync(this.filePath)) fs.writeFileSync(this.filePath, "", { encoding: "utf8", mode: 0o600 });
    const lines = fs.readFileSync(this.filePath, "utf8").split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      let record;
      try { record = JSON.parse(line); } catch (cause) { throw new SyntaxError(`Invalid dedup log: ${cause.message}`, { cause }); }
      const key = this.validateKey(record.key);
      if (record.op === "claim") { this.keys.delete(key); this.keys.set(key, true); }
      else if (record.op === "release") this.keys.delete(key);
      else throw new SyntaxError("Invalid dedup log operation");
    }
    while (this.keys.size > this.capacity) this.keys.delete(this.keys.keys().next().value);
  }
  validateKey(key) {
    const normalized = String(key ?? "").trim();
    if (!normalized) throw new TypeError("idempotency key must not be empty");
    if (Buffer.byteLength(normalized, "utf8") > 1024) throw new TypeError("idempotency key must not exceed 1024 bytes");
    return normalized;
  }
  append(op, key) {
    fs.appendFileSync(this.filePath, `${JSON.stringify({ op, key, timestamp: new Date().toISOString() })}\n`, { encoding: "utf8" });
    if (fs.statSync(this.filePath).size > this.maxLogBytes) this.compact();
  }
  compact() {
    const content = [...this.keys.keys()].map((key) => JSON.stringify({ op: "claim", key, timestamp: new Date().toISOString() })).join("\n");
    atomicWriteFileSync(this.filePath, content ? `${content}\n` : "");
  }
  claim(value) {
    const key = this.validateKey(value);
    if (this.keys.has(key)) return false;
    this.keys.set(key, true);
    while (this.keys.size > this.capacity) this.keys.delete(this.keys.keys().next().value);
    this.append("claim", key);
    return true;
  }
  release(value) {
    const key = this.validateKey(value);
    if (!this.keys.delete(key)) return false;
    this.append("release", key);
    return true;
  }
  contains(value) { return this.keys.has(this.validateKey(value)); }
  get size() { return this.keys.size; }
}

export class NetworkConfig {
  constructor({
    maxMessageBytes = DEFAULT_MAX_MESSAGE_BYTES,
    connectTimeoutMs = 5000,
    ioTimeoutMs = 30000,
    maxAttempts = 3,
    baseDelayMs = 100,
    maxDelayMs = 2000,
    securityConfig = new SecurityConfig(),
    identityPolicy = null,
    capabilityPolicy = null,
    replayProtection = new ReplayProtection(),
  } = {}) {
    validateMaxMessageBytes(maxMessageBytes);
    for (const [name, value] of Object.entries({ connectTimeoutMs, ioTimeoutMs, maxAttempts })) {
      if (!Number.isInteger(value) || value < 1) throw new TypeError(`${name} must be at least 1`);
    }
    if (baseDelayMs < 0 || maxDelayMs < baseDelayMs) throw new TypeError("retry delays are invalid");
    if (!(securityConfig instanceof SecurityConfig)) {
      securityConfig = new SecurityConfig(securityConfig);
    }
    if (identityPolicy && !(identityPolicy instanceof CertificateIdentityPolicy)) {
      identityPolicy = new CertificateIdentityPolicy(identityPolicy);
    }
    if (capabilityPolicy && !(capabilityPolicy instanceof CapabilityPolicy)) {
      capabilityPolicy = new CapabilityPolicy(capabilityPolicy);
    }
    if (!(replayProtection instanceof ReplayProtection)) {
      replayProtection = new ReplayProtection(replayProtection);
    }
    if ([SecurityProfile.STANDARD, SecurityProfile.HYBRID_PQ].includes(securityConfig.profile)) {
      if (!identityPolicy) throw new TypeError("secure network transport requires identityPolicy");
      if (!capabilityPolicy) throw new TypeError("secure network transport requires capabilityPolicy");
      if (identityPolicy.trustDomain !== securityConfig.trustDomain) {
        throw new TypeError("identityPolicy trustDomain must match securityConfig");
      }
    }
    Object.assign(this, {
      maxMessageBytes,
      connectTimeoutMs,
      ioTimeoutMs,
      maxAttempts,
      baseDelayMs,
      maxDelayMs,
      securityConfig,
      identityPolicy,
      capabilityPolicy,
      replayProtection,
    });
  }
}

export class LengthDelimitedTransport extends Transport {
  constructor(socket, {
    config = new NetworkConfig(),
    secureFactoryToken = null,
  } = {}) {
    super();
    this.config = config instanceof NetworkConfig ? config : new NetworkConfig(config);
    const profile = this.config.securityConfig.profile;
    if (profile === SecurityProfile.RESEARCH) {
      throw new SecurityError(
        "The research security profile has no production TLS provider.",
        { code: "security_profile_unavailable", details: { profile } },
      );
    }
    if (profile === SecurityProfile.HYBRID_PQ && !detectHybridPqSupport()) {
      throw new SecurityError(
        "The hybrid-pq security profile is unavailable in the active Node TLS provider.",
        { code: "security_profile_unavailable", details: { profile } },
      );
    }
    if ([SecurityProfile.STANDARD, SecurityProfile.HYBRID_PQ].includes(profile)
      && secureFactoryToken !== SECURE_TRANSPORT_FACTORY_TOKEN) {
      throw new SecurityError(
        "Secure transports must be created by TcpTransport.connect() or TcpTransport.startServer().",
        { code: "secure_transport_factory_required", details: { profile } },
      );
    }
    if (!socket || typeof socket.write !== "function") throw new TypeError("socket is required");
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.frames = [];
    this.waiters = [];
    this.ended = false;
    this.failure = null;
    this.authenticatedPeer = null;
    if ([SecurityProfile.STANDARD, SecurityProfile.HYBRID_PQ]
      .includes(this.config.securityConfig.profile)) {
      this.authenticatedPeer = authenticateTlsSocket(socket, this.config.identityPolicy);
    }
    socket.on("data", (chunk) => this.accept(Buffer.from(chunk)));
    socket.on("end", () => this.finish());
    socket.on("close", () => this.finish());
    socket.on("error", (error) => this.finish(error));
  }
  accept(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 4) {
      const size = this.buffer.readUInt32BE(0);
      if (size > this.config.maxMessageBytes) {
        this.finish(new MessageTooLargeError(`network frame exceeds ${this.config.maxMessageBytes} bytes`));
        this.socket.destroy();
        return;
      }
      if (this.buffer.length < size + 4) return;
      const frame = this.buffer.subarray(4, size + 4);
      this.buffer = this.buffer.subarray(size + 4);
      const waiter = this.waiters.shift();
      if (waiter) waiter.resolve(frame);
      else this.frames.push(frame);
    }
  }
  finish(error = null) {
    if (this.ended) return;
    this.ended = true;
    this.failure = error;
    for (const waiter of this.waiters.splice(0)) waiter.reject(error ?? new Error("network peer closed the protocol stream"));
  }
  async send(value) {
    if (this.ended) throw this.failure ?? new Error("network transport is closed");
    const envelope = value instanceof MessageEnvelope ? value : MessageEnvelope.fromWire(value);
    const payload = Buffer.from(envelope.toJSONString(), "utf8");
    if (payload.length > this.config.maxMessageBytes) throw new MessageTooLargeError(`network frame exceeds ${this.config.maxMessageBytes} bytes`);
    const frame = Buffer.allocUnsafe(payload.length + 4);
    frame.writeUInt32BE(payload.length, 0);
    payload.copy(frame, 4);
    if (!this.socket.write(frame)) await once(this.socket, "drain");
  }
  async receive() {
    const frame = this.frames.shift();
    if (frame) {
      const envelope = MessageEnvelope.fromJSON(frame.toString("utf8"));
      this.validateSecureEnvelope(envelope);
      return envelope;
    }
    if (this.ended) throw this.failure ?? new Error("network peer closed the protocol stream");
    const pending = new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
    const envelope = MessageEnvelope.fromJSON((await pending).toString("utf8"));
    this.validateSecureEnvelope(envelope);
    return envelope;
  }
  validateSecureEnvelope(envelope) {
    if (![SecurityProfile.STANDARD, SecurityProfile.HYBRID_PQ]
      .includes(this.config.securityConfig.profile)) return;
    const peer = this.authenticatedPeer;
    if (!peer) {
      throw new AuthenticationError(
        "Secure envelope has no authenticated transport peer.",
        { code: "authenticated_peer_missing" },
      );
    }
    const declared = envelope.metadata?.peer_identity;
    if (!declared || typeof declared !== "object" || Array.isArray(declared)) {
      throw new AuthenticationError(
        "Secure envelope requires a declared peer_identity object.",
        { code: "declared_identity_missing" },
      );
    }
    validateDeclaredPeerIdentity(peer, new PeerIdentity(declared));
    if (envelope.source !== peer.peerId) {
      throw new AuthenticationError(
        "Envelope source does not match the authenticated peer_id.",
        { code: "declared_identity_mismatch", details: { fields: ["peer_id"] } },
      );
    }
    const nonce = envelope.metadata?.security_nonce;
    if (typeof nonce !== "string" || nonce.length === 0 || nonce.length > 256) {
      throw new AuthenticationError(
        "Secure envelope requires a bounded non-empty security_nonce.",
        { code: "security_nonce_missing" },
      );
    }
    const createdAt = Date.parse(envelope.createdAt) / 1000;
    const replayScope = `${peer.credentialFingerprint}|${envelope.sessionId}`;
    this.config.replayProtection.checkAndRecord(
      replayScope,
      envelope.sequence,
      nonce,
      createdAt,
    );
    const operation = envelope.metadata?.operation;
    if (typeof operation !== "string" || operation.length === 0) {
      throw new AuthorizationError(
        "Secure envelope requires an explicit operation for authorization.",
        { code: "operation_missing" },
      );
    }
    if (!this.config.capabilityPolicy?.isOperationAuthorized(operation, peer)) {
      throw new AuthorizationError(
        `Peer '${peer.peerId}' is not authorized for operation '${operation}'.`,
        { details: { peer_id: peer.peerId, operation } },
      );
    }
  }
  async close() {
    if (this.ended) return;
    const closed = once(this.socket, "close").catch(() => []);
    this.socket.end();
    let timer;
    const timeout = new Promise((resolve) => { timer = setTimeout(resolve, this.config.ioTimeoutMs, "timeout"); timer.unref?.(); });
    const result = await Promise.race([closed, timeout]);
    clearTimeout(timer);
    if (result === "timeout") this.socket.destroy();
    this.finish();
  }
}

export * from "./security.js";
import tls from "node:tls";
import net from "node:net";

export class TcpTransport extends LengthDelimitedTransport {
  static async connect(host, port, options = {}) {
    const config = options.config instanceof NetworkConfig ? options.config : new NetworkConfig(options.config);
    const tlsOpts = resolveTlsOptions(
      config,
      options.tlsOptions,
      false,
      options.servername || host,
    );
    const socket = await connectSocket({ host, port, ...tlsOpts }, config.connectTimeoutMs, Boolean(tlsOpts));
    return new TcpTransport(socket, {
      config,
      secureFactoryToken: SECURE_TRANSPORT_FACTORY_TOKEN,
    });
  }
  static async startServer(clientCallback, host, port, options = {}) {
    const config = options.config instanceof NetworkConfig ? options.config : new NetworkConfig(options.config);
    config.securityConfig?.validateListenAddress(host);
    const tlsOpts = resolveTlsOptions(config, options.tlsOptions, true);
    const server = tlsOpts
      ? tls.createServer(tlsOpts, (socket) => invokeClientCallback(clientCallback, socket, config))
      : net.createServer((socket) => invokeClientCallback(clientCallback, socket, config));
    await new Promise((resolve) => server.listen(port, host, resolve));
    return server;
  }
  static async connectWithRetry(host, port, options = {}) {
    const config = options.config instanceof NetworkConfig ? options.config : new NetworkConfig(options.config);
    let lastError;
    for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
      try { return await TcpTransport.connect(host, port, { config }); }
      catch (error) {
        lastError = error;
        if (attempt === config.maxAttempts) break;
        const delay = Math.min(config.baseDelayMs * (2 ** (attempt - 1)), config.maxDelayMs);
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    throw new Error(`TCP connection failed after retries: ${String(lastError?.message ?? "connection failed").replace(/[\r\n\0]/g, " ")}`);
  }
}

export class UnixSocketTransport extends LengthDelimitedTransport {
  static async connect(socketPath, options = {}) {
    const config = options.config instanceof NetworkConfig ? options.config : new NetworkConfig(options.config);
    const socket = await connectSocket({ path: socketPath }, config.connectTimeoutMs);
    return new UnixSocketTransport(socket, { config });
  }
}

function validateMaxMessageBytes(value) {
  if (!Number.isInteger(value) || value < MIN_MESSAGE_BYTES || value > DEFAULT_MAX_MESSAGE_BYTES) {
    throw new TypeError(`maxMessageBytes must be between ${MIN_MESSAGE_BYTES} and ${DEFAULT_MAX_MESSAGE_BYTES}`);
  }
}

function connectSocket(options, timeoutMs, useTls = false) {
  return new Promise((resolve, reject) => {
    const socket = useTls ? tls.connect(options) : createConnection(options);
    const connectEvent = useTls ? "secureConnect" : "connect";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("network connection timed out"));
    }, timeoutMs);
    socket.once(connectEvent, () => {
      clearTimeout(timer);
      socket.removeListener("error", rejectOnce);
      if (useTls && !socket.authorized) {
        const error = new AuthenticationError(
          "TLS peer certificate was not authorized by the active trust store.",
          {
            code: "peer_certificate_untrusted",
            details: { authorization_error: socket.authorizationError || null },
          },
        );
        socket.destroy(error);
        reject(error);
        return;
      }
      resolve(socket);
    });
    const rejectOnce = (error) => { clearTimeout(timer); reject(error); };
    socket.once("error", rejectOnce);
  });
}

function resolveTlsOptions(config, supplied, isServer, servername) {
  const profile = config.securityConfig?.profile;
  if (supplied && [
    SecurityProfile.STANDARD,
    SecurityProfile.HYBRID_PQ,
    SecurityProfile.RESEARCH,
  ].includes(profile)) {
    if ([SecurityProfile.HYBRID_PQ, SecurityProfile.RESEARCH].includes(profile)) {
      // Preserve provider/profile errors. A caller-supplied standard context
      // must never make hybrid-pq appear supported.
      buildTlsOptions(config.securityConfig, isServer, { servername });
    }
    throw new SecurityError(
      "Secure profiles reject tlsOptions overrides; configure trust and credentials through SecurityConfig.",
      { code: "tls_context_override_forbidden", details: { profile } },
    );
  }
  return supplied || (config.securityConfig
    ? buildTlsOptions(config.securityConfig, isServer, { servername })
    : null);
}

function invokeClientCallback(clientCallback, socket, config) {
  let transport;
  try {
    transport = new TcpTransport(socket, {
      config,
      secureFactoryToken: SECURE_TRANSPORT_FACTORY_TOKEN,
    });
  } catch (error) {
    socket.destroy(error);
    return;
  }
  Promise.resolve(clientCallback(transport)).catch((error) => {
    socket.destroy(error);
  });
}

export class SubprocessStdioTransport extends NodeStdioTransport {
  constructor(child, options = {}) {
    if (!child.stdout || !child.stdin) throw new TypeError("child must expose stdin and stdout");
    super({ readable: child.stdout, writable: child.stdin, ...options });
    this.child = child;
    this.stderr = child.stderr;
    this.stderrTail = "";
    this.stderr?.setEncoding?.("utf8");
    this.stderr?.on("data", (chunk) => {
      this.stderrTail = `${this.stderrTail}${String(chunk)}`.slice(-64 * 1024);
    });
  }

  static spawn(argv, { cwd, env, maxMessageBytes = DEFAULT_MAX_MESSAGE_BYTES } = {}) {
    if (!Array.isArray(argv) || argv.length === 0) throw new TypeError("argv must not be empty");
    const child = spawn(argv[0], argv.slice(1), {
      cwd,
      env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return new SubprocessStdioTransport(child, { maxMessageBytes });
  }

  async close() {
    await super.close();
    if (this.child.exitCode == null && this.child.signalCode == null) {
      const exited = once(this.child, "exit");
      let timer;
      const timeout = new Promise((resolve) => {
        timer = setTimeout(resolve, 2000, "timeout");
        timer.unref?.();
      });
      const result = await Promise.race([exited, timeout]);
      clearTimeout(timer);
      if (result === "timeout") {
        this.child.kill();
        await once(this.child, "exit").catch(() => []);
      }
    }
  }
}

async function readDirectoryNames(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function atomicWriteFile(filePath, data) {
  const absolute = path.resolve(filePath);
  const directory = path.dirname(absolute);
  await mkdir(directory, { recursive: true });
  const temporary = join(directory, `.${path.basename(absolute)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, data, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temporary, absolute);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}

function atomicWriteFileSync(filePath, data) {
  const absolute = path.resolve(filePath);
  const directory = path.dirname(absolute);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = join(directory, `.${path.basename(absolute)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, data, { encoding: "utf8", flag: "wx", mode: 0o600 });
    fs.renameSync(temporary, absolute);
  } finally {
    try {
      fs.rmSync(temporary, { force: true });
    } catch (_) {}
  }
}

function safeFileName(value) {
  return String(value || "report").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "report";
}

function normalizePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
