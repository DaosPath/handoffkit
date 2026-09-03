import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";

import {
  BrowserCapabilities,
  BrowserCommand,
  BrowserCoreError,
  BrowserEvent,
  BrowserPolicy,
  BrowserSessionRequest,
  BrowserSessionState,
  redactSensitive,
} from "@handoffkit/browser-core";
import { normalizeFingerprint, ReplayProtection } from "@handoffkit/csp";

import { ArtifactStore } from "./artifacts.js";
import {
  assertEnvelopeSource,
  checkTransportReplay,
  decodeEnvelope,
  wrapEventEnvelope,
  connectionSequencer,
  identityFingerprint,
  identityWithGrants,
} from "./csp_bridge.js";
import { assertRemoteNavigable } from "./egress.js";
import { detectChallenge, isDefaultUserProfile, LOCAL_COMMANDS, nodeMajor } from "./helpers.js";
import { SessionJournal } from "./journal.js";
import { resolveManagedProfile } from "./profiles.js";
import { ChromiumSupervisor } from "./supervisor.js";

const LOCAL_TIMEOUT_MS = 15_000;
const MAX_INFLIGHT = 16;
const MAX_REDIRECTS = 5;
const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MARKDOWN_PREVIEW = 4_096;
const PROBE_HTML = `<!doctype html><html><head><title>probe</title></head>
<body>
<main>
<p>ok</p>
<form><input name="q" value="probe"><button>go</button></form>
<div id="host"><template shadowrootmode="open"><span>shadow</span></template></div>
<iframe name="child" src="about:blank"></iframe>
<a id="popup" href="about:blank" target="_blank">popup</a>
</main>
</body></html>`;

function event(command, name, payload) {
  return BrowserEvent.fromWire({
    event_id: randomUUID(),
    command_id: command.commandId,
    request_id: command.requestId,
    session_id: command.sessionId,
    name,
    occurred_at: new Date().toISOString(),
    page_id: command.pageId || "",
    profile_id: command.profileId || "",
    payload: redactSensitive(payload ?? {}),
  });
}

function structuredTransportError(error, where) {
  return {
    where,
    code: String(error?.code || error?.details?.code || "engine_crash"),
    message: String(error?.message || error).slice(0, 500),
    details: error?.details && typeof error.details === "object" && !Array.isArray(error.details)
      ? { ...error.details }
      : {},
    at: new Date().toISOString(),
  };
}

function isCleanDisconnect(error) {
  const message = String(error?.message || "");
  const code = String(error?.code || "");
  return (
    message.includes("peer closed")
    || message.includes("network transport is closed")
    || code === "ECONNRESET"
    || code === "EPIPE"
  );
}

async function sendTransportError(transport, request, error, identity, sequences) {
  const failed = event({
    commandId: request?.payload?.command_id || request?.payload?.commandId || "unknown",
    requestId: request?.payload?.request_id || request?.payload?.requestId || "",
    sessionId: request?.sessionId || request?.payload?.session_id || "",
    pageId: "",
    profileId: "",
  }, "error", {
    code: error?.code || "engine_crash",
    message: String(error?.message ?? error),
  });
  await transport.send(wrapEventEnvelope({
    event: failed,
    request,
    identity,
    sequence: sequences.next(),
  }));
}

function forceCloseTransport(transport) {
  if (typeof transport?.destroy === "function") {
    transport.destroy();
    return;
  }
  transport?.socket?.destroy?.();
}

function headContentLength(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (error) {
      reject(error);
      return;
    }
    const lib = parsed.protocol === "https:" ? https : http;
    const req = lib.request(parsed, { method: "HEAD", timeout: timeoutMs }, (response) => {
      resolve(Number(response.headers["content-length"] || 0));
      response.resume();
    });
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("HEAD timed out"));
    });
    req.on("error", reject);
    req.end();
  });
}

async function readDownloadCapped(download, maxBytes) {
  if (typeof download.createReadStream === "function") {
    const stream = await download.createReadStream();
    const chunks = [];
    let received = 0;
    try {
      for await (const chunk of stream) {
        received += chunk.length;
        if (received > maxBytes) {
          stream.destroy();
          download.cancel?.();
          throw new BrowserCoreError("download exceeded 50 MiB", { code: "download_too_large" });
        }
        chunks.push(chunk);
      }
    } catch (error) {
      if (error instanceof BrowserCoreError) throw error;
      throw new BrowserCoreError(String(error?.message ?? error), { code: "artifact_integrity_failed" });
    }
    return Buffer.concat(chunks);
  }
  throw new BrowserCoreError("download stream is unavailable", { code: "engine_unsupported" });
}

function normalizeGrants(raw) {
  const entries = raw instanceof Map ? [...raw.entries()] : Object.entries(raw ?? { "*": ["browser:*"] });
  return new Map(entries.map(([key, caps]) => {
    const list = Array.isArray(caps) ? [...caps] : [];
    if (!list.includes("browser:*") && !list.includes("browser:control")) {
      list.unshift("browser:control");
    }
    return [key === "*" ? "*" : normalizeFingerprint(key), list];
  }));
}

function grantsAllow(grants, fingerprint, commandName) {
  if (!fingerprint) return false;
  const exact = grants.get(normalizeFingerprint(fingerprint)) || grants.get("*") || [];
  return exact.includes("browser:*") || exact.includes(`browser:${commandName}`);
}

function effectiveDeadlineMs(command, envelope) {
  const now = Date.now();
  const candidates = [now + LOCAL_TIMEOUT_MS];
  if (command.deadlineAt) {
    const at = Date.parse(command.deadlineAt);
    if (!Number.isNaN(at)) candidates.push(at);
  }
  if (envelope?.deadline) {
    const at = Date.parse(envelope.deadline);
    if (!Number.isNaN(at)) candidates.push(at);
  }
  return Math.min(...candidates) - now;
}

function handleIsDisconnected(handle) {
  if (!handle) return false;
  if (handle.dead === true) return true;
  if (typeof handle.browser?.isConnected === "function" && !handle.browser.isConnected()) {
    return true;
  }
  return false;
}

async function htmlToMarkdown(html, url) {
  try {
    const { htmlToMarkdown: convert } = await import("@handoffkit/browser");
    return convert(html, { baseUrl: url });
  } catch {
    return String(html ?? "");
  }
}

export class BrowserRealService {
  constructor(options = {}) {
    this.policy = options.policy instanceof BrowserPolicy
      ? options.policy
      : BrowserPolicy.fromWire(options.policy ?? {});
    this.networkMode = Boolean(options.networkConfig || options.config);
    this.replay = options.replay
      ?? (this.networkMode ? null : new ReplayProtection({ windowSeconds: 300 }));
    this.localCapabilities = new Set(options.localCapabilities ?? LOCAL_COMMANDS);
    this.grants = normalizeGrants(options.grants ?? { "*": ["browser:*"] });
    this.sessions = new Map();
    this.seenCommandIds = new Map();
    this.idempotency = new Map();
    this.supervisor = new ChromiumSupervisor({
      engine: options.engine ?? null,
      executablePath: options.executablePath || process.env.HANDOFFKIT_BROWSER_CHROMIUM || "",
    });
    this.engine = options.engine ?? null;
    this.capabilities = BrowserCapabilities.fromWire({ product: "real" });
    this.artifactStore = options.artifactStore
      ?? (options.artifactRoot ? new ArtifactStore(options.artifactRoot) : null);
    this.profileRoot = options.profileRoot || "";
    this.journal = options.journal
      ?? (options.stateStore ? new SessionJournal(path.join(options.stateStore, "sessions.json")) : null);
    this.inflight = 0;
    this.sessionQueues = new Map();
    this.firstTransportError = null;
    this.journal?.interruptOpen();
  }

  rememberStructuredError(error, where) {
    if (this.firstTransportError || isCleanDisconnect(error)) return this.firstTransportError;
    this.firstTransportError = structuredTransportError(error, where);
    return this.firstTransportError;
  }

  async attachEngine() {
    if (this.engine) return this.engine;
    if (nodeMajor() < 24) {
      throw new BrowserCoreError("Browser Real requires Node.js 24+", { code: "engine_unsupported" });
    }
    this.engine = this.supervisor;
    return this.engine;
  }

  async createSession(request) {
    const sessionRequest = request instanceof BrowserSessionRequest
      ? request
      : BrowserSessionRequest.fromWire(request);
    if (sessionRequest.profileDir && isDefaultUserProfile(sessionRequest.profileDir)) {
      throw new BrowserCoreError("Refusing to reuse the operator browser profile", { code: "profile_denied" });
    }
    const peerPolicy = sessionRequest.policy;
    const policy = this.policy.restrictWith(peerPolicy);
    if (sessionRequest.persistentProfile && !sessionRequest.profileId) {
      throw new BrowserCoreError("Persistent profiles require a managed profile_id", {
        code: "profile_denied",
        details: { field: "profile_id" },
      });
    }
    let userDataDir = "";
    if (sessionRequest.persistentProfile) {
      if (!this.profileRoot) {
        throw new BrowserCoreError("profile_root is required for persistent profiles", { code: "profile_denied" });
      }
      userDataDir = resolveManagedProfile(this.profileRoot, sessionRequest.profileId);
    } else {
      userDataDir = await mkdtemp(path.join(os.tmpdir(), "handoffkit-browser-real-"));
    }
    const engine = await this.attachEngine();
    const session = {
      id: sessionRequest.sessionId || randomUUID(),
      request: sessionRequest,
      policy,
      ephemeralRoot: sessionRequest.persistentProfile ? "" : userDataDir,
      profileId: sessionRequest.profileId,
      handle: null,
      status: "starting",
      currentUrl: "",
      paused: false,
      active: null,
      cancelRequested: false,
      routeError: null,
      egressInterceptors: new Map(),
    };
    this.sessions.set(session.id, session);
    try {
      session.handle = await engine.launch({
        headless: sessionRequest.headless,
        userDataDir,
        persistent: sessionRequest.persistentProfile,
      });
      if (!session.handle.pages) {
        const pageId = randomUUID();
        session.handle.pages = new Map(session.handle.page ? [[pageId, session.handle.page]] : []);
        session.handle.activePageId = session.handle.page ? pageId : "";
      }
      if (!session.handle.pid) {
        session.handle.pid = session.handle.browser?.process?.()?.pid ?? null;
      }
      session.status = "ready";
      await this.probe(session);
      this.journal?.record(session);
      return BrowserSessionState.fromWire({
        session_id: session.id,
        request_id: sessionRequest.requestId,
        status: "ready",
        product: "real",
        engine: this.capabilities.engine,
        headless: sessionRequest.headless,
        persistent_profile: sessionRequest.persistentProfile,
        profile_id: session.profileId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    } catch (error) {
      await this.cleanup(session, true);
      if (error instanceof BrowserCoreError) throw error;
      throw new BrowserCoreError(String(error?.message ?? error), { code: "engine_crash" });
    }
  }

  async probe(session) {
    const page = session.handle?.page;
    const probeResults = [];
    const operations = [];
    const checks = [
      ["navigate", async () => page?.goto?.(`data:text/html,${encodeURIComponent(PROBE_HTML)}`)],
      ["markdown", async () => page?.content?.()],
      ["snapshot.dom", async () => page?.content?.()],
      ["snapshot.ax", async () => page?.accessibility?.snapshot?.()],
      ["click", async () => page?.locator?.("button")?.count?.()],
      ["type", async () => page?.locator?.("input")?.count?.()],
      ["screenshot", async () => page?.screenshot?.({ type: "png", timeout: 5000 })],
      ["pdf", async () => page?.pdf?.({ timeout: 5000 })],
      ["download", async () => {
        if (typeof page?.waitForEvent !== "function") throw new Error("download api missing");
      }],
      ["back", async () => page?.goBack?.({ timeout: 500 }).catch(() => true)],
    ];
    for (const [name, fn] of checks) {
      if (!this.localCapabilities.has(name)) continue;
      try {
        await fn();
        operations.push(name);
        probeResults.push({ name, ok: true });
      } catch (error) {
        probeResults.push({ name, ok: false, error: String(error?.message ?? error) });
      }
    }
    this.capabilities = BrowserCapabilities.fromWire({
      product: "real",
      engine: "chromium",
      engine_ready: operations.includes("navigate"),
      operations,
      javascript: operations.includes("click"),
      screenshots: operations.includes("screenshot"),
      pdf: operations.includes("pdf"),
      downloads: operations.includes("download"),
      persistent_profile: Boolean(this.profileRoot),
      probed_at: new Date().toISOString(),
      probe_results: probeResults,
    });
  }

  authorize(command, identity = null) {
    const fingerprint = identityFingerprint(identity);
    if (fingerprint) {
      if (!grantsAllow(this.grants, fingerprint, command.name)) {
        throw new BrowserCoreError(`Capability denied: ${command.name}`, { code: "capability_denied" });
      }
    } else if (!this.localCapabilities.has(command.name)) {
      throw new BrowserCoreError(`Capability denied: ${command.name}`, { code: "capability_denied" });
    }
    if (command.payload?.capabilities) {
      throw new BrowserCoreError("Remote capability declarations are ignored and forbidden", {
        code: "capability_denied",
      });
    }
    if (command.name === "evaluate" && !this.policy.javascript.allow_evaluate) {
      throw new BrowserCoreError("JavaScript evaluation is denied", { code: "javascript_denied" });
    }
  }

  businessDedup(command) {
    if (this.seenCommandIds.has(command.commandId)) {
      throw new BrowserCoreError("Duplicate command_id", { code: "replay_detected" });
    }
    if (command.idempotencyKey && this.idempotency.has(command.idempotencyKey)) {
      return this.idempotency.get(command.idempotencyKey);
    }
    this.seenCommandIds.set(command.commandId, command.sessionId);
    return null;
  }

  remember(command, result) {
    if (command.idempotencyKey) this.idempotency.set(command.idempotencyKey, result);
    return result;
  }

  async handleEnvelope(raw, identity, options = {}) {
    const replayArg = typeof options?.checkAndRecord === "function"
      ? { replay: options, transportValidated: false }
      : options;
    const {
      replay = this.replay,
      transportValidated = false,
      localIdentity = null,
      responseSequence = null,
    } = replayArg;
    const envelope = decodeEnvelope(raw);
    assertEnvelopeSource(envelope, identity);
    if (!transportValidated) {
      if (!replay) {
        throw new BrowserCoreError("transport replay is required outside in-process dispatch", {
          code: "replay_detected",
        });
      }
      checkTransportReplay(replay, envelope, identity);
    }
    if (envelope.payloadType !== "browser.command") {
      throw new BrowserCoreError("payload_type must be browser.command", { code: "invalid_request" });
    }
    const result = await this.dispatch(envelope.payload, { identity, envelope });
    if (!localIdentity) return result;
    return wrapEventEnvelope({
      event: result,
      request: envelope,
      identity: localIdentity,
      sequence: responseSequence ?? envelope.sequence,
    });
  }

  enqueueSession(sessionId, task, { bypass = false } = {}) {
    if (bypass) return task();
    const key = sessionId || "";
    const previous = this.sessionQueues.get(key) || Promise.resolve();
    const next = previous.then(task, task);
    this.sessionQueues.set(key, next.catch((error) => {
      this.rememberStructuredError(error, "queue");
    }));
    return next;
  }

  async dispatch(rawCommand, context = {}) {
    const command = rawCommand instanceof BrowserCommand
      ? rawCommand
      : BrowserCommand.fromWire(rawCommand);
    const cached = this.businessDedup(command);
    if (cached) return cached;
    this.authorize(command, context.identity || null);
    const run = async () => {
      if (this.inflight >= MAX_INFLIGHT && command.name !== "cancel") {
        throw new BrowserCoreError("too many inflight requests", { code: "timeout" });
      }
      this.inflight += 1;
      try {
        const result = await this.dispatchCommand(command, context);
        return this.remember(command, result);
      } finally {
        this.inflight -= 1;
      }
    };
    return this.enqueueSession(command.sessionId, run, { bypass: command.name === "cancel" });
  }

  async dispatchCommand(command, context) {
    if (command.name === "session.start") {
      const state = await this.createSession({
        ...command.payload,
        session_id: command.sessionId,
        request_id: command.requestId,
        profile_id: command.profileId || command.payload.profile_id,
      });
      return event(command, "session.started", state.toWire());
    }
    const session = this.sessions.get(command.sessionId);
    if (!session) throw new BrowserCoreError("Unknown session", { code: "not_found" });
    if (handleIsDisconnected(session.handle)) {
      session.status = "interrupted";
      if (command.name === "session.retry") return this.retrySession(session, command);
      await this.cleanup(session, true);
      return event(command, "session.interrupted", { code: "engine_crash" });
    }
    if (command.name === "cancel") return this.cancelSession(session, command);
    if (command.name === "session.status") {
      return event(command, "session.status", { status: session.status, current_url: session.currentUrl });
    }
    if (command.name === "session.pause") {
      session.paused = true;
      session.status = "paused";
      this.journal?.record(session);
      return event(command, "session.paused", { status: "paused" });
    }
    if (command.name === "session.resume") {
      if (session.status !== "paused") {
        throw new BrowserCoreError("session is not paused", { code: "invalid_request" });
      }
      session.paused = false;
      session.status = "ready";
      this.journal?.record(session);
      return event(command, "session.resumed", { status: "ready" });
    }
    if (command.name === "session.retry") {
      return this.retrySession(session, command);
    }
    if (session.paused && command.name !== "session.close") {
      throw new BrowserCoreError("session is paused", { code: "interrupted" });
    }
    if (command.name === "navigate") {
      const url = String(command.payload.url ?? "");
      session.routeError = null;
      await assertRemoteNavigable(url, session.policy, {
        resolveDns: this.networkMode || Boolean(this.supervisor.sharedBrowser),
      });
    }
    if (command.name === "download") {
      session.policy.assertFilesystem("download");
      if (!command.payload.selector) {
        throw new BrowserCoreError("download requires selector", { code: "invalid_request" });
      }
    }
    if (command.name === "screenshot" && command.payload.path) {
      throw new BrowserCoreError("peer-supplied artifact paths are forbidden", { code: "policy_denied" });
    }
    const page = this.resolvePage(session, command);
    if (handleIsDisconnected(session.handle)) {
      await this.cleanup(session, true);
      return event(command, "session.interrupted", { code: "engine_crash" });
    }
    const pid = session.handle?.pid;
    if (pid) {
      try {
        process.kill(pid, 0);
      } catch {
        await this.cleanup(session, true);
        return event(command, "session.interrupted", { code: "engine_crash" });
      }
    }
    const timeout = Math.max(1, effectiveDeadlineMs(command, context.envelope));
    try {
      return await this.withDeadline(session, timeout, () => this.runPageCommand(session, command, page, timeout));
    } catch (error) {
      if (error instanceof BrowserCoreError) throw error;
      const crashed = /crash|target closed|browser has been closed/i.test(String(error?.message ?? error));
      if (crashed) {
        await this.cleanup(session, true);
        return event(command, "session.interrupted", { code: "engine_crash" });
      }
      throw new BrowserCoreError(String(error?.message ?? error), {
        code: "engine_crash",
        details: { stack: String(error?.stack || "") },
      });
    }
  }

  resolvePage(session, command) {
    const handle = session.handle;
    if (command.pageId && handle?.pages?.has(command.pageId)) {
      return handle.pages.get(command.pageId);
    }
    if (handle?.pages?.has(handle.activePageId)) return handle.pages.get(handle.activePageId);
    return handle?.page;
  }

  async touchGesture(page, payload, name, timeout) {
    const selector = String(payload.selector ?? "");
    const target = page;
    let center = null;
    if (selector) {
      const box = target?.locator ? await target.locator(selector).boundingBox() : null;
      if (!box) throw new BrowserCoreError(`${name} target not found`, { code: "not_found" });
      center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    } else {
      const viewport = page?.viewportSize ? page.viewportSize() : null;
      if (!viewport) throw new BrowserCoreError(`${name} requires selector`, { code: "invalid_request" });
      center = { x: viewport.width / 2, y: viewport.height / 2 };
    }
    let client = null;
    try {
      client = page?.context ? await page.context().newCDPSession(page) : null;
    } catch {
      client = null;
    }
    if (!client || typeof client.send !== "function") {
      throw new BrowserCoreError(`${name} is not supported by this engine`, { code: "engine_unsupported" });
    }
    const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
    try {
      if (name === "swipe") {
        const direction = String(payload.direction ?? "");
        if (!["up", "down", "left", "right"].includes(direction)) {
          throw new BrowserCoreError("swipe requires direction up|down|left|right", { code: "invalid_request" });
        }
        const distance = Number(payload.distance ?? 300);
        if (!Number.isFinite(distance) || distance < 10 || distance > 2000) {
          throw new BrowserCoreError("swipe distance must be 10..2000 px", { code: "invalid_request" });
        }
        const delta = { up: [0, -distance], down: [0, distance], left: [-distance, 0], right: [distance, 0] }[direction];
        const from = { x: center.x - delta[0] / 2, y: center.y - delta[1] / 2 };
        const to = { x: center.x + delta[0] / 2, y: center.y + delta[1] / 2 };
        await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...from }] });
        for (let step = 1; step <= 4; step += 1) {
          await client.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [{ x: from.x + ((to.x - from.x) * step) / 4, y: from.y + ((to.y - from.y) * step) / 4 }],
          });
        }
        await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        return { direction, distance };
      }
      if (name === "longpress") {
        const duration = Number(payload.duration_ms ?? 600);
        if (!Number.isFinite(duration) || duration < 100 || duration > 5000) {
          throw new BrowserCoreError("longpress duration_ms must be 100..5000", { code: "invalid_request" });
        }
        await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...center }] });
        await sleep(Math.min(duration, Math.max(timeout - 1000, 0) || duration));
        await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        return { duration_ms: duration };
      }
      const scale = Number(payload.scale ?? 0);
      if (!Number.isFinite(scale) || scale < 0.25 || scale > 4 || scale === 1) {
        throw new BrowserCoreError("pinch scale must be 0.25..4 excluding 1", { code: "invalid_request" });
      }
      const spread = scale > 1 ? 1 : -1;
      const radius = 60;
      const first = { x: center.x - radius, y: center.y };
      const second = { x: center.x + radius, y: center.y };
      const movedFirst = { x: center.x - radius - spread * 40, y: center.y };
      const movedSecond = { x: center.x + radius + spread * 40, y: center.y };
      await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...first, id: 1 }, { ...second, id: 2 }] });
      await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...movedFirst, id: 1 }, { ...movedSecond, id: 2 }] });
      await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      return { scale };
    } finally {
      try { await client.detach?.(); } catch { /* already closed */ }
    }
  }

  async resolveFrame(page, payload) {
    const name = String(payload.frame_name ?? "");
    const url = String(payload.frame_url ?? "");
    if (!name && !url) return page;
    const frames = page?.frames?.() ?? [];
    const frame = name
      ? frames.find((item) => item.name?.() === name)
      : frames.find((item) => item.url?.() === url);
    if (!frame) throw new BrowserCoreError("frame not found", { code: "not_found" });
    return frame;
  }

  async installEgressInterceptor(session, page) {
    if (!page?.context || typeof page.context().newCDPSession !== "function") return false;
    session.egressInterceptors ||= new Map();
    if (session.egressInterceptors.has(page)) return true;
    let client = null;
    try {
      client = await page.context().newCDPSession(page);
      const state = { client, redirects: new Map() };
      client.on("Fetch.requestPaused", (event) => {
        void this.handleEgressPaused(session, state, event);
      });
      await client.send("Fetch.enable", {
        patterns: [{ urlPattern: "*", requestStage: "Request" }],
      });
      session.egressInterceptors.set(page, state);
      return true;
    } catch {
      try { await client?.detach?.(); } catch { /* already closed */ }
      return false;
    }
  }

  async handleEgressPaused(session, state, event) {
    const requestId = event?.requestId;
    if (!requestId) return;
    try {
      const redirectCount = event.redirectedRequestId
        ? (state.redirects.get(event.redirectedRequestId) || 0) + 1
        : 0;
      if (event.redirectedRequestId) state.redirects.set(requestId, redirectCount);
      if (redirectCount > session.policy.network.max_redirects) {
        throw new BrowserCoreError("Too many redirects", {
          code: "policy_denied",
          details: { max_redirects: session.policy.network.max_redirects },
        });
      }
      await assertRemoteNavigable(event.request?.url || "", session.policy);
      await state.client.send("Fetch.continueRequest", { requestId });
    } catch (error) {
      session.routeError = error instanceof BrowserCoreError
        ? error
        : new BrowserCoreError(String(error?.message ?? error), { code: "policy_denied" });
      try {
        await state.client.send("Fetch.failRequest", {
          requestId,
          errorReason: "BlockedByClient",
        });
      } catch {
        // The browser may have completed or closed the request already.
      }
    } finally {
      if (state.redirects.size > 128) {
        const oldest = state.redirects.keys().next().value;
        if (oldest) state.redirects.delete(oldest);
      }
    }
  }

  async closeEgressInterceptors(session) {
    for (const { client } of session.egressInterceptors?.values?.() || []) {
      try { await client.send("Fetch.disable"); } catch { /* page already closed */ }
      try { await client.detach?.(); } catch { /* page already closed */ }
    }
    session.egressInterceptors?.clear?.();
  }

  async withDeadline(session, timeout, fn) {
    let timer;
    const timeoutError = new BrowserCoreError("deadline exceeded", { code: "timeout" });
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => reject(timeoutError), timeout);
    });
    try {
      return await Promise.race([fn(), timeoutPromise]);
    } catch (error) {
      if (error === timeoutError || error?.code === "timeout") {
        try {
          await session.handle?.page?.close?.();
        } catch {
          // Closing the page is the abort path when the engine cannot cancel cleanly.
        }
        session.status = "interrupted";
        this.journal?.record(session);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async runPageCommand(session, command, page, timeout) {
    const name = command.name;
    const payload = command.payload;
    if (name === "navigate") {
      const url = String(payload.url ?? "");
      const cdpEgress = await this.installEgressInterceptor(session, page);
      if (page?.route && !cdpEgress && !session.routedPages?.has(page)) {
        session.routedPages = session.routedPages || new WeakSet();
        session.routedPages.add(page);
        await page.route("**/*", async (route) => {
          try {
            await assertRemoteNavigable(route.request().url(), session.policy);
            const redirects = route.request().redirectedFrom();
            let hops = 0;
            let current = redirects;
            while (current) {
              hops += 1;
              if (hops > MAX_REDIRECTS) throw new Error("too many redirects");
              current = current.redirectedFrom?.() ?? current.redirectedFrom;
            }
            await route.continue();
          } catch (error) {
            session.routeError = error instanceof BrowserCoreError
              ? error
              : new BrowserCoreError(String(error?.message ?? error), { code: "policy_denied" });
            try {
              // Abort immediately so a blocked redirect cannot leave page.goto
              // waiting on a socket that will never complete. A fulfillment is
              // only a compatibility fallback for engines that reject abort
              // on an already-resolved route.
              await route.abort("blockedbyclient");
            } catch {
              await route.fulfill({
                status: 403,
                contentType: "text/plain",
                body: "blocked by local browser policy",
              });
            }
          }
        });
      }
      if (page?.goto) {
        try {
          await page.goto(url, { waitUntil: payload.wait_until || "load", timeout });
        } catch (error) {
          if (session.routeError) {
            const routeError = session.routeError;
            session.routeError = null;
            throw routeError;
          }
          throw error;
        }
      }
      if (session.routeError) {
        const routeError = session.routeError;
        session.routeError = null;
        throw routeError;
      }
      const body = page?.content ? await page.content() : String(payload.preview_html ?? "");
      if (detectChallenge(body)) {
        return event(command, "error", { code: "provider_challenge", url });
      }
      const finalUrl = page?.url?.() ?? url;
      session.currentUrl = finalUrl;
      session.status = "running";
      this.journal?.record(session);
      return event(command, "navigated", { url, final_url: finalUrl });
    }
    if (name === "back") {
      if (page?.goBack) await page.goBack({ timeout });
      return event(command, "navigated", { action: "back" });
    }
    if (name === "forward") {
      if (page?.goForward) await page.goForward({ timeout });
      return event(command, "navigated", { action: "forward" });
    }
    if (name === "reload") {
      if (page?.reload) await page.reload({ timeout });
      return event(command, "navigated", { action: "reload" });
    }
    if (name === "wait") {
      if (payload.selector && page?.waitForSelector) {
        await page.waitForSelector(String(payload.selector), { timeout: payload.timeout_ms || timeout });
      } else if (page?.waitForLoadState) {
        await page.waitForLoadState(payload.state || "load", { timeout });
      }
      return event(command, "wait.done", { selector: payload.selector || "" });
    }
    if (name === "snapshot.dom") {
      const html = page?.content ? await page.content() : "";
      return event(command, "snapshot", { kind: "dom", html });
    }
    if (name === "snapshot.ax") {
      const ax = page?.accessibility?.snapshot ? await page.accessibility.snapshot() : null;
      return event(command, "snapshot", { kind: "ax", tree: ax });
    }
    if (name === "locate") {
      const selector = String(payload.selector ?? "");
      const target = await this.resolveFrame(page, payload);
      const count = target?.locator ? await target.locator(selector).count() : 0;
      return event(command, "located", { selector, count });
    }
    if (name === "click") {
      const selector = String(payload.selector ?? "");
      const target = await this.resolveFrame(page, payload);
      if (payload.expect_popup && page?.waitForEvent && target?.click) {
        const popupPromise = page.waitForEvent("popup", { timeout });
        await target.locator(selector).click({ timeout });
        const popup = await popupPromise;
        const pageId = randomUUID();
        session.handle.pages = session.handle.pages || new Map();
        session.handle.pages.set(pageId, popup);
        return event(command, "action.done", { action: "click", page_id: pageId, popup: true });
      }
      if (target?.locator) await target.locator(selector).click({ timeout });
      else if (page?.click) await page.click(selector, { timeout });
      return event(command, "action.done", { action: "click" });
    }
    if (name === "type") {
      const selector = String(payload.selector ?? "");
      const text = String(payload.text ?? "");
      const target = await this.resolveFrame(page, payload);
      if (target?.locator) await target.locator(selector).fill(text, { timeout });
      else if (page?.fill) await page.fill(selector, text, { timeout });
      else if (page?.type) await page.type(selector, text, { timeout });
      return event(command, "action.done", { action: "type" });
    }
    if (name === "select") {
      const selector = String(payload.selector ?? "");
      const target = await this.resolveFrame(page, payload);
      if (target?.locator) await target.locator(selector).selectOption(payload.value, { timeout });
      else if (page?.selectOption) await page.selectOption(selector, payload.value, { timeout });
      return event(command, "action.done", { action: "select" });
    }
    if (name === "press") {
      const selector = String(payload.selector ?? "body");
      const key = String(payload.key ?? "Enter");
      const target = await this.resolveFrame(page, payload);
      if (target?.locator) await target.locator(selector).press(key, { timeout });
      else if (page?.press) await page.press(selector, key, { timeout });
      else if (page?.keyboard?.press) await page.keyboard.press(key);
      return event(command, "action.done", { action: "press" });
    }
    if (name === "hover") {
      const selector = String(payload.selector ?? "");
      if (!selector) throw new BrowserCoreError("hover requires selector", { code: "invalid_request" });
      const target = await this.resolveFrame(page, payload);
      if (target?.locator) await target.locator(selector).hover({ timeout });
      else if (page?.hover) await page.hover(selector, { timeout });
      else throw new BrowserCoreError("hover is not supported by this engine", { code: "engine_unsupported" });
      return event(command, "action.done", { action: "hover" });
    }
    if (name === "focus") {
      const selector = String(payload.selector ?? "");
      if (!selector) throw new BrowserCoreError("focus requires selector", { code: "invalid_request" });
      const target = await this.resolveFrame(page, payload);
      if (target?.locator) await target.locator(selector).focus({ timeout });
      else if (page?.focus) await page.focus(selector, { timeout });
      else throw new BrowserCoreError("focus is not supported by this engine", { code: "engine_unsupported" });
      return event(command, "action.done", { action: "focus" });
    }
    if (name === "check" || name === "uncheck") {
      const selector = String(payload.selector ?? "");
      if (!selector) throw new BrowserCoreError(`${name} requires selector`, { code: "invalid_request" });
      const target = await this.resolveFrame(page, payload);
      if (target?.locator) {
        if (name === "check") await target.locator(selector).check({ timeout });
        else await target.locator(selector).uncheck({ timeout });
      } else if (page?.check && page?.uncheck) {
        if (name === "check") await page.check(selector, { timeout });
        else await page.uncheck(selector, { timeout });
      } else {
        throw new BrowserCoreError(`${name} is not supported by this engine`, { code: "engine_unsupported" });
      }
      return event(command, "action.done", { action: name });
    }
    if (name === "dblclick") {
      const selector = String(payload.selector ?? "");
      if (!selector) throw new BrowserCoreError("dblclick requires selector", { code: "invalid_request" });
      const target = await this.resolveFrame(page, payload);
      if (target?.locator) await target.locator(selector).dblclick({ timeout });
      else if (page?.dblclick) await page.dblclick(selector, { timeout });
      else throw new BrowserCoreError("dblclick is not supported by this engine", { code: "engine_unsupported" });
      return event(command, "action.done", { action: "dblclick" });
    }
    if (name === "scroll") {
      const selector = String(payload.selector ?? "");
      const target = await this.resolveFrame(page, payload);
      if (selector && target?.locator) {
        await target.locator(selector).scrollIntoViewIfNeeded({ timeout });
      } else if (selector && page?.locator) {
        await page.locator(selector).scrollIntoViewIfNeeded({ timeout });
      } else if (page?.evaluate) {
        const by = Number(payload.by ?? 0);
        if (selector) {
          await page.evaluate(
            ([sel]) => document.querySelector(sel)?.scrollIntoView?.(),
            [selector],
          );
        } else if (by) {
          await page.evaluate(([dy]) => window.scrollBy?.(0, dy), [by]);
        } else {
          throw new BrowserCoreError("scroll requires selector or by", { code: "invalid_request" });
        }
      } else {
        throw new BrowserCoreError("scroll is not supported by this engine", { code: "engine_unsupported" });
      }
      return event(command, "action.done", { action: "scroll" });
    }
    if (name === "upload") {
      const selector = String(payload.selector ?? "");
      const filePath = String(payload.path ?? payload.file ?? "");
      if (!selector) throw new BrowserCoreError("upload requires selector", { code: "invalid_request" });
      if (!filePath) throw new BrowserCoreError("upload requires path", { code: "invalid_request" });
      const { statSync } = await import("node:fs");
      let size = 0;
      try {
        size = Number(statSync(filePath).size ?? 0);
      } catch {
        throw new BrowserCoreError("upload file is missing", { code: "upload_missing_file" });
      }
      if (!Number.isFinite(size) || size <= 0) {
        throw new BrowserCoreError("upload file is missing", { code: "upload_missing_file" });
      }
      if (size > MAX_UPLOAD_BYTES) {
        throw new BrowserCoreError("upload exceeds 5 MiB", { code: "upload_too_large" });
      }
      const target = await this.resolveFrame(page, payload);
      if (target?.locator) await target.locator(selector).setInputFiles(filePath, { timeout });
      else if (page?.setInputFiles) await page.setInputFiles(selector, filePath, { timeout });
      else throw new BrowserCoreError("upload is not supported by this engine", { code: "engine_unsupported" });
      return event(command, "action.done", { action: "upload", bytes: size });
    }
    if (name === "tap") {
      const selector = String(payload.selector ?? "");
      if (!selector) throw new BrowserCoreError("tap requires selector", { code: "invalid_request" });
      const target = await this.resolveFrame(page, payload);
      if (target?.locator) await target.locator(selector).tap({ timeout });
      else if (page?.tap) await page.tap(selector, { timeout });
      else throw new BrowserCoreError("tap is not supported by this engine", { code: "engine_unsupported" });
      return event(command, "action.done", { action: "tap" });
    }
    if (name === "swipe" || name === "longpress" || name === "pinch") {
      const gesture = await this.touchGesture(page, payload, name, timeout);
      return event(command, "action.done", { action: name, ...gesture });
    }
    if (name === "markdown") {
      const html = page?.content ? await page.content() : "";
      const url = page?.url?.() ?? session.currentUrl;
      let markdown = await htmlToMarkdown(html, url);
      const frames = page?.frames?.() ?? [];
      for (const frame of frames) {
        if (frame === page?.mainFrame?.()) continue;
        const frameUrl = frame.url?.() || "";
        const frameHtml = await frame.content?.().catch(() => "");
        if (frameHtml) {
          markdown += `\n\n## Frame ${frameUrl}\n\n${await htmlToMarkdown(frameHtml, frameUrl)}`;
        }
      }
      const truncated = markdown.length > MARKDOWN_PREVIEW;
      const preview = truncated ? markdown.slice(0, MARKDOWN_PREVIEW) : markdown;
      let artifactRef = null;
      if (this.artifactStore) {
        artifactRef = await this.artifactStore.write({
          bytes: Buffer.from(markdown),
          mime: "text/markdown",
          kind: "markdown",
          sessionId: session.id,
        });
      }
      return event(command, "markdown", {
        url,
        markdown: preview,
        truncated,
        artifact_ref: artifactRef ? {
          uri: artifactRef.uri,
          mime: artifactRef.mime,
          bytes: artifactRef.bytes,
          sha256: artifactRef.sha256,
        } : null,
      });
    }
    if (name === "screenshot") {
      const bytes = page?.screenshot ? await page.screenshot({ type: "png", timeout }) : Buffer.from("");
      let artifactRef = null;
      if (this.artifactStore) {
        artifactRef = await this.artifactStore.write({
          bytes,
          mime: "image/png",
          kind: "screenshot",
          sessionId: session.id,
        });
      }
      return event(command, "screenshot", {
        bytes: Buffer.byteLength(bytes),
        encoding: "png",
        preview: payload.authorize_preview ? this.artifactStore?.previewPng(bytes) || "" : "",
        artifact_ref: artifactRef ? {
          uri: artifactRef.uri,
          mime: artifactRef.mime,
          bytes: artifactRef.bytes,
          sha256: artifactRef.sha256,
        } : null,
      });
    }
    if (name === "pdf") {
      const bytes = page?.pdf ? await page.pdf({ timeout }) : Buffer.from("");
      let artifactRef = null;
      if (this.artifactStore) {
        artifactRef = await this.artifactStore.write({
          bytes,
          mime: "application/pdf",
          kind: "pdf",
          sessionId: session.id,
        });
      }
      return event(command, "pdf", {
        bytes: Buffer.byteLength(bytes),
        artifact_ref: artifactRef ? {
          uri: artifactRef.uri,
          mime: artifactRef.mime,
          bytes: artifactRef.bytes,
          sha256: artifactRef.sha256,
        } : null,
      });
    }
    if (name === "download") {
      return this.download(session, command, page, timeout);
    }
    if (name === "session.close") {
      await this.cleanup(session, false);
      return event(command, "session.closed", {});
    }
    throw new BrowserCoreError(`Unsupported command: ${name}`, { code: "invalid_request" });
  }

  async download(session, command, page, timeout) {
    const selector = String(command.payload.selector ?? "");
    if (!page?.waitForEvent) {
      return event(command, "download", { code: "engine_unsupported", quarantined: true });
    }
    const target = await this.resolveFrame(page, command.payload);
    const href = target?.locator ? await target.locator(selector).getAttribute("href") : "";
    if (href) {
      const url = new URL(href, page.url?.() || session.currentUrl || "http://127.0.0.1/").toString();
      await assertRemoteNavigable(url, session.policy);
    }
    if (href) {
      const url = new URL(href, page.url?.() || session.currentUrl || "http://127.0.0.1/").toString();
      let declaredLength = 0;
      try {
        declaredLength = await headContentLength(url, Math.min(timeout, 3000));
      } catch {
        declaredLength = 0;
      }
      if (declaredLength > MAX_DOWNLOAD_BYTES) {
        throw new BrowserCoreError("download exceeded 50 MiB", { code: "download_too_large" });
      }
    }
    const downloadPromise = page.waitForEvent("download", { timeout });
    await target.locator(selector).click({ timeout });
    const download = await downloadPromise;
    const suggested = path.basename(String(download.suggestedFilename?.() || "download.bin")).replace(/[^\w.-]/g, "_");
    const quarantine = path.join(session.ephemeralRoot || os.tmpdir(), "quarantine");
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(quarantine, { recursive: true });
    const dest = path.join(quarantine, suggested);
    const bytes = await readDownloadCapped(download, MAX_DOWNLOAD_BYTES);
    await writeFile(dest, bytes);
    let artifactRef = null;
    if (this.artifactStore) {
      artifactRef = await this.artifactStore.write({
        bytes,
        mime: "application/octet-stream",
        kind: "download",
        sessionId: session.id,
      });
    }
    return event(command, "download", {
      quarantined: true,
      filename: suggested,
      bytes: bytes.byteLength,
      artifact_ref: artifactRef ? {
        uri: artifactRef.uri,
        mime: artifactRef.mime,
        bytes: artifactRef.bytes,
        sha256: artifactRef.sha256,
      } : null,
    });
  }

  async cancelSession(session, command) {
    session.cancelRequested = true;
    try {
      await session.handle?.page?.close?.();
    } catch {
      // Closing the page is the abort path when the engine cannot cancel cleanly.
    }
    session.status = "interrupted";
    this.journal?.record(session);
    return event(command, "cancelled", {
      target_command_id: command.payload.target_command_id || "",
    });
  }

  async retrySession(session, command) {
    if (session.status !== "interrupted") {
      throw new BrowserCoreError("retry is only valid for interrupted sessions", { code: "invalid_request" });
    }
    const lastUrl = session.currentUrl;
    await this.cleanup(session, true);
    const restarted = await this.createSession({
      ...session.request.toWire(),
      session_id: session.id,
      request_id: command.requestId,
    });
    const next = this.sessions.get(session.id);
    if (lastUrl && next) {
      // retrySession already runs inside this session's serialized queue.
      // Calling dispatch() here would enqueue behind the current retry and deadlock.
      await this.dispatchCommand(BrowserCommand.fromWire({
        command_id: `${command.commandId}-revalidate`,
        session_id: session.id,
        request_id: command.requestId,
        name: "navigate",
        payload: { url: lastUrl },
      }), {});
    }
    return event(command, "session.retry", restarted.toWire());
  }

  async cleanup(session, crash) {
    const pid = session.handle?.pid;
    let dead = Boolean(session.handle?.dead);
    if (!dead && pid) {
      try { process.kill(pid, 0); } catch { dead = true; }
    }
    let timer;
    try {
      await this.closeEgressInterceptors(session);
      await Promise.race([
        Promise.resolve(session.handle?.close?.()),
        new Promise((resolve) => {
          timer = setTimeout(resolve, 2000);
          timer.unref?.();
        }),
      ]);
    } catch {
      // Continue deleting the ephemeral profile and resetting the supervisor.
    } finally {
      clearTimeout(timer);
    }
    if (crash) await this.supervisor.invalidateAfterCrash();
    if (session.ephemeralRoot) {
      await rm(session.ephemeralRoot, { recursive: true, force: true });
    }
    session.status = crash ? "interrupted" : "closed";
    this.journal?.record(session);
  }
}

export async function startBrowserRealService(options = {}) {
  const config = options.config || null;
  const host = config?.host ?? options.host ?? "127.0.0.1";
  const policyWire = (config?.policy ?? options.policy ?? {});
  const policy = policyWire instanceof BrowserPolicy ? policyWire : BrowserPolicy.fromWire(policyWire);
  if (config?.allowPublicBind) policy.bind.allow_public_bind = true;
  const service = new BrowserRealService({
    ...options,
    policy,
    grants: config?.grants ?? options.grants,
    artifactRoot: config?.artifactRoot ?? options.artifactRoot,
    profileRoot: config?.profileRoot ?? options.profileRoot,
    stateStore: config?.stateStore ?? options.stateStore,
  });
  service.policy.rejectPublicBind(host);
  if (options.engine) service.supervisor.engineOverride = options.engine;
  let server = null;
  let address = null;
  const transports = new Set();
  if (options.networkConfig || config) {
    if (!options.networkConfig) {
      throw new BrowserCoreError("TLS 1.3/mTLS NetworkConfig is required to listen", {
        code: "public_bind_rejected",
      });
    }
    const { TcpTransport, DurableReplayProtection, peerIdentityFromCertificate } = await import("@handoffkit/node");
    const replay = options.replay
      ?? (config?.replayStore
        ? new DurableReplayProtection(config.replayStore)
        : null);
    if (!replay) {
      throw new BrowserCoreError("durable replay store is required in service mode", {
        code: "invalid_request",
      });
    }
    service.replay = replay;
    server = await TcpTransport.startServer(async (transport) => {
      transports.add(transport);
      try {
        const identity = transport.authenticatedPeer;
        const certPath = options.networkConfig?.securityConfig?.certPath;
        const localFromFile = certPath ? peerIdentityFromCertificate(certPath) : null;
        const grantMap = options.networkConfig?.identityPolicy?.capabilitiesByFingerprint || service.grants;
        const localIdentity = identityWithGrants(
          transport.localCertificateIdentity || localFromFile,
          grantMap,
        );
        const sequences = connectionSequencer();
        for (;;) {
          let envelope;
          try {
            envelope = await transport.receive();
          } catch (error) {
            service.rememberStructuredError(error, "receive");
            const request = error?.envelope;
            if (request) {
              try {
                await sendTransportError(transport, request, error, localIdentity, sequences);
              } catch (sendError) {
                service.rememberStructuredError(sendError, "send");
              }
            }
            break;
          }
          try {
            const result = await service.handleEnvelope(envelope, identity, {
              transportValidated: true,
              localIdentity,
              responseSequence: sequences.next(),
            });
            await transport.send(result);
          } catch (error) {
            service.rememberStructuredError(error, "dispatch");
            try {
              await sendTransportError(transport, envelope, error, localIdentity, sequences);
            } catch (sendError) {
              service.rememberStructuredError(sendError, "send");
              break;
            }
          }
        }
      } finally {
        transports.delete(transport);
        forceCloseTransport(transport);
      }
    }, host, config?.port ?? options.port ?? 0, { config: options.networkConfig });
    address = server.address();
  }
  return {
    service,
    address,
    get capabilities() {
      return service.capabilities;
    },
    get firstError() {
      return service.firstTransportError;
    },
    async close() {
      for (const session of service.sessions.values()) {
        await service.cleanup(session, false);
      }
      await service.supervisor.closeOwned();
      if (!server) return;
      for (const transport of transports) {
        forceCloseTransport(transport);
      }
      transports.clear();
      server.closeAllConnections?.();
      await Promise.race([
        new Promise((resolve) => server.close(() => resolve())),
        new Promise((resolve) => {
          const timer = setTimeout(resolve, 1000);
          timer.unref?.();
        }),
      ]);
    },
  };
}
