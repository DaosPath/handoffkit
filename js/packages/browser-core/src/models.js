import {
  CLAIM_STATUSES,
  COMMAND_NAMES,
  CONTRACT_VERSION,
  EVENT_NAMES,
  PLATFORM_SEARCH_PROVIDERS,
  PRODUCTS,
  RESEARCH_STAGES,
  SESSION_STATUSES,
} from "./constants.js";
import {
  BrowserCoreError,
  asBool,
  asInt,
  asObject,
  asStringArray,
  asText,
  isSha256Hex,
  normalizeProviderName,
  requireErrorCode,
  requireOneOf,
  requireRfc3339,
} from "./wire.js";

function provenanceFrom(data = {}) {
  const source = asObject(data);
  return {
    provider: asText(source.provider),
    method: asText(source.method),
    redirects: asInt(source.redirects, 0),
    status: asInt(source.status, 0),
  };
}

export class BrowserError {
  constructor(init = {}) {
    const data = asObject(init);
    this.contractVersion = asText(data.contract_version ?? data.contractVersion, CONTRACT_VERSION);
    this.code = requireErrorCode(data.code);
    this.message = asText(data.message);
    this.retryable = asBool(data.retryable, false);
    this.details = { ...asObject(data.details) };
    this.requestId = asText(data.request_id ?? data.requestId);
    this.commandId = asText(data.command_id ?? data.commandId);
    this.sessionId = asText(data.session_id ?? data.sessionId);
    this.occurredAt = asText(data.occurred_at ?? data.occurredAt);
  }

  toWire() {
    return {
      contract_version: this.contractVersion,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      details: { ...this.details },
      request_id: this.requestId,
      command_id: this.commandId,
      session_id: this.sessionId,
      occurred_at: this.occurredAt,
    };
  }

  static fromWire(data = {}) {
    return new BrowserError(data);
  }
}

export class BrowserCapabilities {
  constructor(init = {}) {
    const data = asObject(init);
    this.contractVersion = asText(data.contract_version ?? data.contractVersion, CONTRACT_VERSION);
    this.product = requireOneOf(data.product || "core", PRODUCTS, "product");
    this.engine = asText(data.engine);
    this.engineReady = asBool(data.engine_ready ?? data.engineReady, false);
    this.searchProviders = asStringArray(data.search_providers ?? data.searchProviders);
    this.operations = asStringArray(data.operations);
    this.javascript = asBool(data.javascript, false);
    this.screenshots = asBool(data.screenshots, false);
    this.pdf = asBool(data.pdf, false);
    this.downloads = asBool(data.downloads, false);
    this.persistentProfile = asBool(data.persistent_profile ?? data.persistentProfile, false);
    this.localIndex = asBool(data.local_index ?? data.localIndex, false);
    this.probedAt = asText(data.probed_at ?? data.probedAt);
    this.probeResults = Array.isArray(data.probe_results ?? data.probeResults)
      ? (data.probe_results ?? data.probeResults).map((item) => ({ ...asObject(item) }))
      : [];
    if (this.product !== "real") {
      this.javascript = false;
      this.screenshots = false;
      this.pdf = false;
      this.downloads = false;
      this.persistentProfile = false;
      this.engineReady = false;
      this.engine = "";
      this.probedAt = "";
      this.probeResults = [];
    }
    if (this.product === "core") {
      this.localIndex = false;
    }
    if (this.engineReady && !this.probedAt) {
      throw new BrowserCoreError("engine_ready requires a completed probe timestamp", {
        code: "invalid_request",
        details: { field: "probed_at" },
      });
    }
  }

  toWire() {
    return {
      contract_version: this.contractVersion,
      product: this.product,
      engine: this.engine,
      engine_ready: this.engineReady,
      search_providers: [...this.searchProviders],
      operations: [...this.operations],
      javascript: this.javascript,
      screenshots: this.screenshots,
      pdf: this.pdf,
      downloads: this.downloads,
      persistent_profile: this.persistentProfile,
      local_index: this.localIndex,
      probed_at: this.probedAt,
      probe_results: this.probeResults.map((item) => ({ ...item })),
    };
  }

  static fromWire(data = {}) {
    return new BrowserCapabilities(data);
  }
}

function networkPolicyFrom(data = {}) {
  const source = asObject(data);
  return {
    allow_loopback: asBool(source.allow_loopback ?? source.allowLoopback, false),
    allow_private: asBool(source.allow_private ?? source.allowPrivate, false),
    allow_public: asBool(source.allow_public ?? source.allowPublic, true),
    allow_hosts: asStringArray(source.allow_hosts ?? source.allowHosts),
    deny_hosts: asStringArray(source.deny_hosts ?? source.denyHosts),
    max_redirects: asInt(source.max_redirects ?? source.maxRedirects, 5),
    max_body_bytes: asInt(source.max_body_bytes ?? source.maxBodyBytes, 2 * 1024 * 1024),
    max_decompress_bytes: asInt(source.max_decompress_bytes ?? source.maxDecompressBytes, 8 * 1024 * 1024),
    timeout_ms: asInt(source.timeout_ms ?? source.timeoutMs, 15000),
    respect_robots: asBool(source.respect_robots ?? source.respectRobots, true),
  };
}

export class BrowserPolicy {
  constructor(init = {}) {
    const data = asObject(init);
    this.contractVersion = asText(data.contract_version ?? data.contractVersion, CONTRACT_VERSION);
    this.network = networkPolicyFrom(data.network);
    const filesystem = asObject(data.filesystem);
    this.filesystem = {
      allow_read: asBool(filesystem.allow_read ?? filesystem.allowRead, false),
      allow_write: asBool(filesystem.allow_write ?? filesystem.allowWrite, false),
      download_dir: asText(filesystem.download_dir ?? filesystem.downloadDir),
      quarantine_downloads: asBool(filesystem.quarantine_downloads ?? filesystem.quarantineDownloads, true),
      max_download_bytes: asInt(filesystem.max_download_bytes ?? filesystem.maxDownloadBytes, 50 * 1024 * 1024),
    };
    const javascript = asObject(data.javascript);
    this.javascript = {
      allow_evaluate: asBool(javascript.allow_evaluate ?? javascript.allowEvaluate, false),
    };
    const credentials = asObject(data.credentials);
    this.credentials = {
      share_cookies: asBool(credentials.share_cookies ?? credentials.shareCookies, false),
      persistent_profile: asBool(credentials.persistent_profile ?? credentials.persistentProfile, false),
      profile_dir: asText(credentials.profile_dir ?? credentials.profileDir),
      reuse_user_profile: asBool(credentials.reuse_user_profile ?? credentials.reuseUserProfile, false),
    };
    if (this.credentials.reuse_user_profile || this.credentials.share_cookies) {
      throw new BrowserCoreError("Sharing cookies or reusing the operator browser profile is forbidden", {
        code: "profile_denied",
        details: { field: this.credentials.reuse_user_profile ? "credentials.reuse_user_profile" : "credentials.share_cookies" },
      });
    }
    const index = asObject(data.index);
    this.index = {
      enabled: asBool(index.enabled, false),
      max_documents: asInt(index.max_documents ?? index.maxDocuments, 10000),
      max_bytes: asInt(index.max_bytes ?? index.maxBytes, 256 * 1024 * 1024),
      retention_days: asInt(index.retention_days ?? index.retentionDays, 30),
      max_hosts: asInt(index.max_hosts ?? index.maxHosts, 256),
    };
    const bind = asObject(data.bind);
    this.bind = {
      allow_public_bind: asBool(bind.allow_public_bind ?? bind.allowPublicBind, false),
      require_tls: asBool(bind.require_tls ?? bind.requireTls, true),
      require_mtls: asBool(bind.require_mtls ?? bind.requireMtls, true),
    };
  }

  toWire() {
    return {
      contract_version: this.contractVersion,
      network: { ...this.network, allow_hosts: [...this.network.allow_hosts], deny_hosts: [...this.network.deny_hosts] },
      filesystem: { ...this.filesystem },
      javascript: { ...this.javascript },
      credentials: { ...this.credentials },
      index: { ...this.index },
      bind: { ...this.bind },
    };
  }

  static fromWire(data = {}) {
    return new BrowserPolicy(data);
  }

  rejectPublicBind(host) {
    const value = asText(host).trim().toLowerCase();
    const loopback = value === "127.0.0.1" || value === "localhost" || value === "::1";
    if (!loopback && !this.bind.allow_public_bind) {
      throw new BrowserCoreError(`Public bind rejected for ${host}`, {
        code: "public_bind_rejected",
        details: { host: value },
      });
    }
    if (!loopback && this.bind.allow_public_bind && (!this.bind.require_tls || !this.bind.require_mtls)) {
      throw new BrowserCoreError("Public bind requires TLS 1.3 and mTLS", {
        code: "public_bind_rejected",
        details: { host: value },
      });
    }
    return true;
  }

  assertNetworkUrl(url) {
    const target = classifyNetworkTarget(url);
    if (target.kind === "invalid") {
      throw new BrowserCoreError("URL is invalid", {
        code: "invalid_request",
        details: { url: asText(url) },
      });
    }
    if (target.kind === "filesystem") {
      this.assertFilesystem("read");
      return true;
    }
    if (target.kind === "local") return true;
    if (hostListed(target.host, this.network.deny_hosts)) {
      throw new BrowserCoreError(`Host denied: ${target.host}`, {
        code: "policy_denied",
        details: { host: target.host, class: target.kind },
      });
    }
    if (this.network.allow_hosts.length && !hostListed(target.host, this.network.allow_hosts)) {
      throw new BrowserCoreError(`Host not allowlisted: ${target.host}`, {
        code: "policy_denied",
        details: { host: target.host, class: target.kind },
      });
    }
    if (target.kind === "loopback" && !this.network.allow_loopback) {
      throw new BrowserCoreError("Loopback navigation is denied", {
        code: "policy_denied",
        details: { host: target.host, class: "loopback" },
      });
    }
    if (target.kind === "private" && !this.network.allow_private) {
      throw new BrowserCoreError("Private-network navigation is denied", {
        code: "policy_denied",
        details: { host: target.host, class: "private" },
      });
    }
    if (target.kind === "public" && !this.network.allow_public) {
      throw new BrowserCoreError("Public-network navigation is denied", {
        code: "policy_denied",
        details: { host: target.host, class: "public" },
      });
    }
    return true;
  }

  assertFilesystem(operation) {
    const op = asText(operation);
    if (op === "download") {
      if (this.filesystem.quarantine_downloads) return true;
      if (!this.filesystem.allow_write) {
        throw new BrowserCoreError("Downloads require write permission when quarantine is disabled", {
          code: "policy_denied",
          details: { operation: op, class: "filesystem" },
        });
      }
      return true;
    }
    if (op === "read" && !this.filesystem.allow_read) {
      throw new BrowserCoreError("Filesystem read is denied", {
        code: "policy_denied",
        details: { operation: op, class: "filesystem" },
      });
    }
    if (op === "write" && !this.filesystem.allow_write) {
      throw new BrowserCoreError("Filesystem write is denied", {
        code: "policy_denied",
        details: { operation: op, class: "filesystem" },
      });
    }
    if (op !== "read" && op !== "write" && op !== "download") {
      throw new BrowserCoreError("Unknown filesystem operation", {
        code: "invalid_request",
        details: { operation: op },
      });
    }
    return true;
  }

  restrictWith(peerPolicy) {
    const peer = peerPolicy instanceof BrowserPolicy ? peerPolicy : BrowserPolicy.fromWire(peerPolicy ?? {});
    const local = this.toWire();
    const remote = peer.toWire();
    local.network.allow_loopback = local.network.allow_loopback && remote.network.allow_loopback;
    local.network.allow_private = local.network.allow_private && remote.network.allow_private;
    local.network.allow_public = local.network.allow_public && remote.network.allow_public;
    local.network.max_redirects = Math.min(local.network.max_redirects, remote.network.max_redirects);
    local.network.timeout_ms = Math.min(local.network.timeout_ms, remote.network.timeout_ms);
    local.network.deny_hosts = [...new Set([...local.network.deny_hosts, ...remote.network.deny_hosts])];
    if (local.network.allow_hosts.length && remote.network.allow_hosts.length) {
      local.network.allow_hosts = local.network.allow_hosts.filter((host) => remote.network.allow_hosts.includes(host));
    } else if (!local.network.allow_hosts.length && remote.network.allow_hosts.length) {
      local.network.allow_hosts = [...remote.network.allow_hosts];
    }
    local.javascript.allow_evaluate = local.javascript.allow_evaluate && remote.javascript.allow_evaluate;
    local.filesystem.allow_read = local.filesystem.allow_read && remote.filesystem.allow_read;
    local.filesystem.allow_write = local.filesystem.allow_write && remote.filesystem.allow_write;
    local.filesystem.max_download_bytes = Math.min(
      local.filesystem.max_download_bytes,
      remote.filesystem.max_download_bytes,
    );
    return BrowserPolicy.fromWire(local);
  }
}

export function classifyNetworkTarget(url) {
  const raw = asText(url).trim();
  if (!raw) return { kind: "invalid", scheme: "", host: "" };
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return { kind: "invalid", scheme: "", host: "" };
  }
  const scheme = parsed.protocol.replace(/:$/, "").toLowerCase();
  if (scheme === "file") return { kind: "filesystem", scheme, host: "" };
  if (scheme === "data" || scheme === "about" || scheme === "blob") {
    return { kind: "local", scheme, host: "" };
  }
  if (scheme !== "http" && scheme !== "https") {
    return { kind: "invalid", scheme, host: "" };
  }
  const host = asText(parsed.hostname).replace(/^\[|\]$/g, "").toLowerCase();
  return { kind: classifyHostKind(host), scheme, host };
}

function classifyHostKind(host) {
  if (!host) return "invalid";
  if (host === "localhost" || host === "::1" || host === "0.0.0.0" || host === "::") return "loopback";
  if (host.startsWith("127.")) return "loopback";
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const parts = ipv4.slice(1).map(Number);
    if (parts.some((n) => n > 255)) return "invalid";
    const [a, b] = parts;
    if (a === 10) return "private";
    if (a === 192 && b === 168) return "private";
    if (a === 172 && b >= 16 && b <= 31) return "private";
    if (a === 169 && b === 254) return "private";
    if (a === 100 && b >= 64 && b <= 127) return "private";
    if (a >= 224) return "private";
    if (a === 0) return "loopback";
    return "public";
  }
  if (host.includes(":")) {
    const mapped = host.replace(/^:?ffff:/, "").replace(/^::ffff:/, "");
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(mapped) && mapped !== host) return classifyHostKind(mapped);
    const hexMapped = host.match(/^(?:::ffff:|:ffff:|ffff:)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
    if (hexMapped) {
      const hi = Number.parseInt(hexMapped[1], 16);
      const lo = Number.parseInt(hexMapped[2], 16);
      return classifyHostKind(`${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`);
    }
    if (host === "::" || host.startsWith("::ffff:0.") || host === "0:0:0:0:0:0:0:0") return "loopback";
    if (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:") || host.startsWith("ff")) {
      return "private";
    }
    return "public";
  }
  return "public";
}

function hostListed(host, patterns) {
  const value = asText(host).toLowerCase();
  for (const pattern of patterns) {
    const needle = asText(pattern).toLowerCase().replace(/^\*\./, "");
    if (!needle) continue;
    if (value === needle || value.endsWith(`.${needle}`)) return true;
  }
  return false;
}

export class BrowserSessionRequest {
  constructor(init = {}) {
    const data = asObject(init);
    this.contractVersion = asText(data.contract_version ?? data.contractVersion, CONTRACT_VERSION);
    this.requestId = asText(data.request_id ?? data.requestId);
    this.sessionId = asText(data.session_id ?? data.sessionId);
    this.product = requireOneOf(data.product || "lite", PRODUCTS, "product");
    this.headless = asBool(data.headless, true);
    this.persistentProfile = asBool(data.persistent_profile ?? data.persistentProfile, false);
    this.profileDir = asText(data.profile_dir ?? data.profileDir);
    this.profileId = asText(data.profile_id ?? data.profileId);
    this.issuedAt = requireRfc3339(data.issued_at ?? data.issuedAt, "issued_at");
    this.deadlineAt = requireRfc3339(data.deadline_at ?? data.deadlineAt, "deadline_at");
    this.policy = data.policy instanceof BrowserPolicy
      ? data.policy
      : BrowserPolicy.fromWire(data.policy ?? {});
    if (this.persistentProfile && !this.profileDir && !this.profileId) {
      throw new BrowserCoreError("Persistent profiles require an explicit isolated profile_dir", {
        code: "profile_denied",
        details: { field: "profile_dir" },
      });
    }
  }

  toWire() {
    const payload = {
      contract_version: this.contractVersion,
      request_id: this.requestId,
      session_id: this.sessionId,
      product: this.product,
      headless: this.headless,
      persistent_profile: this.persistentProfile,
      profile_dir: this.profileDir,
      issued_at: this.issuedAt,
      deadline_at: this.deadlineAt,
      policy: this.policy.toWire(),
    };
    if (this.profileId) payload.profile_id = this.profileId;
    return payload;
  }

  static fromWire(data = {}) {
    return new BrowserSessionRequest(data);
  }
}

export class BrowserSessionState {
  constructor(init = {}) {
    const data = asObject(init);
    this.contractVersion = asText(data.contract_version ?? data.contractVersion, CONTRACT_VERSION);
    this.sessionId = asText(data.session_id ?? data.sessionId);
    this.requestId = asText(data.request_id ?? data.requestId);
    this.status = requireOneOf(data.status || "pending", SESSION_STATUSES, "status");
    this.product = requireOneOf(data.product || "lite", PRODUCTS, "product");
    this.engine = asText(data.engine);
    this.headless = asBool(data.headless, true);
    this.persistentProfile = asBool(data.persistent_profile ?? data.persistentProfile, false);
    this.createdAt = asText(data.created_at ?? data.createdAt);
    this.updatedAt = asText(data.updated_at ?? data.updatedAt);
    this.currentUrl = asText(data.current_url ?? data.currentUrl);
    this.profileId = asText(data.profile_id ?? data.profileId);
    this.pageId = asText(data.page_id ?? data.pageId);
    this.error = data.error instanceof BrowserError
      ? data.error
      : BrowserError.fromWire(data.error ?? {});
  }

  toWire() {
    const payload = {
      contract_version: this.contractVersion,
      session_id: this.sessionId,
      request_id: this.requestId,
      status: this.status,
      product: this.product,
      engine: this.engine,
      headless: this.headless,
      persistent_profile: this.persistentProfile,
      created_at: this.createdAt,
      updated_at: this.updatedAt,
      current_url: this.currentUrl,
      error: this.error.toWire(),
    };
    if (this.profileId) payload.profile_id = this.profileId;
    if (this.pageId) payload.page_id = this.pageId;
    return payload;
  }

  static fromWire(data = {}) {
    return new BrowserSessionState(data);
  }
}

export class BrowserCommand {
  constructor(init = {}) {
    const data = asObject(init);
    this.contractVersion = asText(data.contract_version ?? data.contractVersion, CONTRACT_VERSION);
    this.commandId = asText(data.command_id ?? data.commandId);
    this.requestId = asText(data.request_id ?? data.requestId);
    this.sessionId = asText(data.session_id ?? data.sessionId);
    this.name = requireOneOf(data.name, COMMAND_NAMES, "name");
    this.issuedAt = requireRfc3339(data.issued_at ?? data.issuedAt, "issued_at");
    this.deadlineAt = requireRfc3339(data.deadline_at ?? data.deadlineAt, "deadline_at");
    this.idempotencyKey = asText(data.idempotency_key ?? data.idempotencyKey);
    this.profileId = asText(data.profile_id ?? data.profileId);
    this.pageId = asText(data.page_id ?? data.pageId);
    this.payload = { ...asObject(data.payload) };
    const frameName = asText(this.payload.frame_name ?? this.payload.frameName);
    const frameUrl = asText(this.payload.frame_url ?? this.payload.frameUrl);
    if (frameName && frameUrl) {
      throw new BrowserCoreError("frame_name and frame_url are mutually exclusive", {
        code: "invalid_request",
        details: { field: "payload.frame_name" },
      });
    }
    if (this.name === "cancel") {
      const target = asText(this.payload.target_command_id ?? this.payload.targetCommandId);
      if (target) this.payload.target_command_id = target;
    }
    if (!this.commandId) {
      throw new BrowserCoreError("command_id is required", { code: "invalid_request", details: { field: "command_id" } });
    }
  }

  toWire() {
    const payload = {
      contract_version: this.contractVersion,
      command_id: this.commandId,
      request_id: this.requestId,
      session_id: this.sessionId,
      name: this.name,
      issued_at: this.issuedAt,
      deadline_at: this.deadlineAt,
      idempotency_key: this.idempotencyKey,
      payload: { ...this.payload },
    };
    if (this.profileId) payload.profile_id = this.profileId;
    if (this.pageId) payload.page_id = this.pageId;
    return payload;
  }

  static fromWire(data = {}) {
    return new BrowserCommand(data);
  }
}

export class BrowserEvent {
  constructor(init = {}) {
    const data = asObject(init);
    this.contractVersion = asText(data.contract_version ?? data.contractVersion, CONTRACT_VERSION);
    this.eventId = asText(data.event_id ?? data.eventId);
    this.commandId = asText(data.command_id ?? data.commandId);
    this.requestId = asText(data.request_id ?? data.requestId);
    this.sessionId = asText(data.session_id ?? data.sessionId);
    this.name = requireOneOf(data.name, EVENT_NAMES, "name");
    this.occurredAt = requireRfc3339(data.occurred_at ?? data.occurredAt, "occurred_at");
    this.profileId = asText(data.profile_id ?? data.profileId);
    this.pageId = asText(data.page_id ?? data.pageId);
    this.payload = { ...asObject(data.payload) };
    if (!this.eventId) {
      throw new BrowserCoreError("event_id is required", { code: "invalid_request", details: { field: "event_id" } });
    }
  }

  toWire() {
    const payload = {
      contract_version: this.contractVersion,
      event_id: this.eventId,
      command_id: this.commandId,
      request_id: this.requestId,
      session_id: this.sessionId,
      name: this.name,
      occurred_at: this.occurredAt,
      payload: { ...this.payload },
    };
    if (this.profileId) payload.profile_id = this.profileId;
    if (this.pageId) payload.page_id = this.pageId;
    return payload;
  }

  static fromWire(data = {}) {
    return new BrowserEvent(data);
  }
}

export class SearchHit {
  constructor(init = {}) {
    const data = asObject(init);
    this.title = asText(data.title);
    this.url = asText(data.url);
    this.snippet = asText(data.snippet);
    this.score = asInt(data.score, 0);
    this.provider = asText(data.provider);
  }

  toWire() {
    return {
      title: this.title,
      url: this.url,
      snippet: this.snippet,
      score: this.score,
      provider: this.provider,
    };
  }

  static fromWire(data = {}) {
    return new SearchHit(data);
  }
}

export class ProviderTrace {
  constructor(init = {}) {
    const data = asObject(init);
    this.provider = asText(data.provider);
    this.attempted = asBool(data.attempted, false);
    this.used = asBool(data.used, false);
    this.resultCount = asInt(data.result_count ?? data.resultCount, 0);
    this.errorCode = data.error_code || data.errorCode
      ? requireErrorCode(data.error_code ?? data.errorCode)
      : "";
    this.fallbackReason = asText(data.fallback_reason ?? data.fallbackReason);
    this.startedAt = asText(data.started_at ?? data.startedAt);
    this.finishedAt = asText(data.finished_at ?? data.finishedAt);
    if (!this.used && this.attempted && this.fallbackReason === "" && this.errorCode === "") {
      // A skipped/failed attempt that continues the chain must record why.
      this.fallbackReason = "unspecified_fallback";
    }
  }

  toWire() {
    return {
      provider: this.provider,
      attempted: this.attempted,
      used: this.used,
      result_count: this.resultCount,
      error_code: this.errorCode,
      fallback_reason: this.fallbackReason,
      started_at: this.startedAt,
      finished_at: this.finishedAt,
    };
  }

  static fromWire(data = {}) {
    return new ProviderTrace(data);
  }
}

export class SearchRequest {
  constructor(init = {}) {
    const data = asObject(init);
    this.contractVersion = asText(data.contract_version ?? data.contractVersion, CONTRACT_VERSION);
    this.requestId = asText(data.request_id ?? data.requestId);
    this.sessionId = asText(data.session_id ?? data.sessionId);
    this.query = asText(data.query);
    this.maxResults = asInt(data.max_results ?? data.maxResults, 8);
    this.timeoutMs = asInt(data.timeout_ms ?? data.timeoutMs, 20000);
    this.strictProvider = asBool(data.strict_provider ?? data.strictProvider, false);
    const providers = data.providers ?? PLATFORM_SEARCH_PROVIDERS;
    this.providers = asStringArray(providers).map(normalizeProviderName).filter(Boolean);
    this.allowHosts = asStringArray(data.allow_hosts ?? data.allowHosts);
    this.denyHosts = asStringArray(data.deny_hosts ?? data.denyHosts);
    this.issuedAt = asText(data.issued_at ?? data.issuedAt);
  }

  toWire() {
    return {
      contract_version: this.contractVersion,
      request_id: this.requestId,
      session_id: this.sessionId,
      query: this.query,
      max_results: this.maxResults,
      timeout_ms: this.timeoutMs,
      strict_provider: this.strictProvider,
      providers: [...this.providers],
      allow_hosts: [...this.allowHosts],
      deny_hosts: [...this.denyHosts],
      issued_at: this.issuedAt,
    };
  }

  static fromWire(data = {}) {
    return new SearchRequest(data);
  }
}

export class SearchResult {
  constructor(init = {}) {
    const data = asObject(init);
    this.contractVersion = asText(data.contract_version ?? data.contractVersion, CONTRACT_VERSION);
    this.requestId = asText(data.request_id ?? data.requestId);
    this.success = asBool(data.success, false);
    this.query = asText(data.query);
    this.keywords = asText(data.keywords);
    this.results = (Array.isArray(data.results) ? data.results : []).map((item) =>
      item instanceof SearchHit ? item : SearchHit.fromWire(item),
    );
    this.count = asInt(data.count, this.results.length);
    this.strictProvider = asBool(data.strict_provider ?? data.strictProvider, false);
    this.providersRequested = asStringArray(data.providers_requested ?? data.providersRequested);
    this.providersUsed = asStringArray(data.providers_used ?? data.providersUsed);
    this.providerTrace = (Array.isArray(data.provider_trace ?? data.providerTrace)
      ? (data.provider_trace ?? data.providerTrace)
      : []).map((item) => (item instanceof ProviderTrace ? item : ProviderTrace.fromWire(item)));
    this.errors = asStringArray(data.errors);
    this.errorCode = data.error_code || data.errorCode ? requireErrorCode(data.error_code ?? data.errorCode) : "";
    this.error = asText(data.error);
    this.assertNoSilentFallback();
  }

  assertNoSilentFallback() {
    if (!this.strictProvider) return;
    const fallback = this.providerTrace.find((item) => item.fallbackReason);
    const used = this.providersUsed.filter((name) => name && name !== this.providersRequested[0]);
    if (fallback || used.length) {
      throw new BrowserCoreError("strict_provider forbids fallback", {
        code: "strict_provider_rejected",
        details: { providers_used: this.providersUsed },
      });
    }
  }

  toWire() {
    return {
      contract_version: this.contractVersion,
      request_id: this.requestId,
      success: this.success,
      query: this.query,
      keywords: this.keywords,
      results: this.results.map((item) => item.toWire()),
      count: this.count,
      strict_provider: this.strictProvider,
      providers_requested: [...this.providersRequested],
      providers_used: [...this.providersUsed],
      provider_trace: this.providerTrace.map((item) => item.toWire()),
      errors: [...this.errors],
      error_code: this.errorCode,
      error: this.error,
    };
  }

  static fromWire(data = {}) {
    return new SearchResult(data);
  }
}

export class PageSnapshot {
  constructor(init = {}) {
    const data = asObject(init);
    this.contractVersion = asText(data.contract_version ?? data.contractVersion, CONTRACT_VERSION);
    this.snapshotId = asText(data.snapshot_id ?? data.snapshotId);
    this.requestId = asText(data.request_id ?? data.requestId);
    this.sessionId = asText(data.session_id ?? data.sessionId);
    this.url = asText(data.url);
    this.finalUrl = asText(data.final_url ?? data.finalUrl);
    this.fetchedAt = asText(data.fetched_at ?? data.fetchedAt);
    this.sha256 = asText(data.sha256).toLowerCase();
    this.contentType = asText(data.content_type ?? data.contentType);
    this.title = asText(data.title);
    this.markdown = asText(data.markdown);
    this.provenance = provenanceFrom(data.provenance);
    this.appliedLimits = { ...asObject(data.applied_limits ?? data.appliedLimits) };
    if (this.sha256 && !isSha256Hex(this.sha256)) {
      throw new BrowserCoreError("sha256 must be a 64-character hex digest", {
        code: "invalid_request",
        details: { field: "sha256" },
      });
    }
  }

  toWire() {
    return {
      contract_version: this.contractVersion,
      snapshot_id: this.snapshotId,
      request_id: this.requestId,
      session_id: this.sessionId,
      url: this.url,
      final_url: this.finalUrl,
      fetched_at: this.fetchedAt,
      sha256: this.sha256,
      content_type: this.contentType,
      title: this.title,
      markdown: this.markdown,
      provenance: { ...this.provenance },
      applied_limits: { ...this.appliedLimits },
    };
  }

  static fromWire(data = {}) {
    return new PageSnapshot(data);
  }
}

export class DocumentRecord {
  constructor(init = {}) {
    const data = asObject(init);
    this.contractVersion = asText(data.contract_version ?? data.contractVersion, CONTRACT_VERSION);
    this.documentId = asText(data.document_id ?? data.documentId);
    this.sha256 = asText(data.sha256).toLowerCase();
    this.url = asText(data.url);
    this.finalUrl = asText(data.final_url ?? data.finalUrl);
    this.title = asText(data.title);
    this.host = asText(data.host);
    this.fetchedAt = asText(data.fetched_at ?? data.fetchedAt);
    this.indexedAt = asText(data.indexed_at ?? data.indexedAt);
    this.bytes = asInt(data.bytes, 0);
    this.contentType = asText(data.content_type ?? data.contentType);
    this.provenance = provenanceFrom(data.provenance);
    if (this.sha256 && !isSha256Hex(this.sha256)) {
      throw new BrowserCoreError("sha256 must be a 64-character hex digest", {
        code: "invalid_request",
        details: { field: "sha256" },
      });
    }
  }

  toWire() {
    return {
      contract_version: this.contractVersion,
      document_id: this.documentId,
      sha256: this.sha256,
      url: this.url,
      final_url: this.finalUrl,
      title: this.title,
      host: this.host,
      fetched_at: this.fetchedAt,
      indexed_at: this.indexedAt,
      bytes: this.bytes,
      content_type: this.contentType,
      provenance: { ...this.provenance },
    };
  }

  static fromWire(data = {}) {
    return new DocumentRecord(data);
  }
}

export class ResearchClaim {
  constructor(init = {}) {
    const data = asObject(init);
    this.claimId = asText(data.claim_id ?? data.claimId);
    this.statement = asText(data.statement);
    this.status = requireOneOf(data.status || "not_found", CLAIM_STATUSES, "status");
    this.quote = asText(data.quote);
    this.sourceSnapshotId = asText(data.source_snapshot_id ?? data.sourceSnapshotId);
    this.sourceUrl = asText(data.source_url ?? data.sourceUrl);
    this.derivedFrom = asStringArray(data.derived_from ?? data.derivedFrom);
    if (this.status === "supported") {
      if (!this.quote || !this.sourceUrl) {
        throw new BrowserCoreError("supported claims require a verbatim quote and source URL", {
          code: "invalid_request",
          details: { claim_id: this.claimId },
        });
      }
    }
    if (this.status === "derived" && this.derivedFrom.length < 2) {
      throw new BrowserCoreError("derived claims require two or more compatible claim ids", {
        code: "invalid_request",
        details: { claim_id: this.claimId },
      });
    }
    if (this.status === "not_found" && this.sourceUrl && !this.quote) {
      // not_found may name a searched URL only when it was actually attempted; quote stays empty.
    }
  }

  toWire() {
    return {
      claim_id: this.claimId,
      statement: this.statement,
      status: this.status,
      quote: this.quote,
      source_snapshot_id: this.sourceSnapshotId,
      source_url: this.sourceUrl,
      derived_from: [...this.derivedFrom],
    };
  }

  static fromWire(data = {}) {
    return new ResearchClaim(data);
  }
}

export class ResearchJob {
  constructor(init = {}) {
    const data = asObject(init);
    this.contractVersion = asText(data.contract_version ?? data.contractVersion, CONTRACT_VERSION);
    this.jobId = asText(data.job_id ?? data.jobId);
    this.requestId = asText(data.request_id ?? data.requestId);
    this.sessionId = asText(data.session_id ?? data.sessionId);
    this.query = asText(data.query);
    this.status = asText(data.status, "running");
    this.packVersion = asInt(data.pack_version ?? data.packVersion, 2);
    this.strictProvider = asBool(data.strict_provider ?? data.strictProvider, false);
    this.createdAt = asText(data.created_at ?? data.createdAt);
    this.updatedAt = asText(data.updated_at ?? data.updatedAt);
    this.checkpointId = asText(data.checkpoint_id ?? data.checkpointId);
    this.idempotencyKey = asText(data.idempotency_key ?? data.idempotencyKey);
  }

  toWire() {
    return {
      contract_version: this.contractVersion,
      job_id: this.jobId,
      request_id: this.requestId,
      session_id: this.sessionId,
      query: this.query,
      status: this.status,
      pack_version: this.packVersion,
      strict_provider: this.strictProvider,
      created_at: this.createdAt,
      updated_at: this.updatedAt,
      checkpoint_id: this.checkpointId,
      idempotency_key: this.idempotencyKey,
    };
  }

  static fromWire(data = {}) {
    return new ResearchJob(data);
  }
}

export class ResearchProgress {
  constructor(init = {}) {
    const data = asObject(init);
    this.contractVersion = asText(data.contract_version ?? data.contractVersion, CONTRACT_VERSION);
    this.jobId = asText(data.job_id ?? data.jobId);
    this.requestId = asText(data.request_id ?? data.requestId);
    this.stage = requireOneOf(data.stage || "plan", RESEARCH_STAGES, "stage");
    this.message = asText(data.message);
    this.pagesFetched = asInt(data.pages_fetched ?? data.pagesFetched, 0);
    this.pagesTarget = asInt(data.pages_target ?? data.pagesTarget, 0);
    this.occurredAt = asText(data.occurred_at ?? data.occurredAt);
  }

  toWire() {
    return {
      contract_version: this.contractVersion,
      job_id: this.jobId,
      request_id: this.requestId,
      stage: this.stage,
      message: this.message,
      pages_fetched: this.pagesFetched,
      pages_target: this.pagesTarget,
      occurred_at: this.occurredAt,
    };
  }

  static fromWire(data = {}) {
    return new ResearchProgress(data);
  }
}

export class ResearchResult {
  constructor(init = {}) {
    const data = asObject(init);
    this.contractVersion = asText(data.contract_version ?? data.contractVersion, CONTRACT_VERSION);
    this.jobId = asText(data.job_id ?? data.jobId);
    this.requestId = asText(data.request_id ?? data.requestId);
    this.packVersion = asInt(data.pack_version ?? data.packVersion, 2);
    this.success = asBool(data.success, false);
    this.query = asText(data.query);
    this.queries = asStringArray(data.queries);
    this.candidates = (Array.isArray(data.candidates) ? data.candidates : []).map((item) =>
      item instanceof SearchHit ? item : SearchHit.fromWire(item),
    );
    this.selectedUrls = asStringArray(data.selected_urls ?? data.selectedUrls);
    this.snapshots = (Array.isArray(data.snapshots) ? data.snapshots : []).map((item) =>
      item instanceof PageSnapshot ? item : PageSnapshot.fromWire(item),
    );
    this.claims = (Array.isArray(data.claims) ? data.claims : []).map((item) =>
      item instanceof ResearchClaim ? item : ResearchClaim.fromWire(item),
    );
    this.contradictions = Array.isArray(data.contradictions)
      ? data.contradictions.map((item) => ({ ...asObject(item) }))
      : [];
    this.citations = Array.isArray(data.citations)
      ? data.citations.map((item) => ({ title: asText(item.title), url: asText(item.url) }))
      : [];
    this.error = data.error instanceof BrowserError
      ? data.error
      : BrowserError.fromWire(data.error ?? {});
    this.assertCitationsAreGrounded();
  }

  assertCitationsAreGrounded() {
    const snapshotUrls = new Set(this.snapshots.map((item) => item.finalUrl || item.url).filter(Boolean));
    const selected = new Set(this.selectedUrls);
    for (const citation of this.citations) {
      if (!citation.url) {
        throw new BrowserCoreError("citations cannot be empty", { code: "invalid_request" });
      }
      if (!snapshotUrls.has(citation.url) && !selected.has(citation.url)) {
        throw new BrowserCoreError("citation URL was not fetched or selected", {
          code: "invalid_request",
          details: { url: citation.url },
        });
      }
    }
  }

  toWire() {
    return {
      contract_version: this.contractVersion,
      job_id: this.jobId,
      request_id: this.requestId,
      pack_version: this.packVersion,
      success: this.success,
      query: this.query,
      queries: [...this.queries],
      candidates: this.candidates.map((item) => item.toWire()),
      selected_urls: [...this.selectedUrls],
      snapshots: this.snapshots.map((item) => item.toWire()),
      claims: this.claims.map((item) => item.toWire()),
      contradictions: this.contradictions.map((item) => ({ ...item })),
      citations: this.citations.map((item) => ({ ...item })),
      error: this.error.toWire(),
    };
  }

  static fromWire(data = {}) {
    return new ResearchResult(data);
  }
}

export const CORE_MODELS = Object.freeze({
  BrowserError,
  BrowserCapabilities,
  BrowserPolicy,
  BrowserSessionRequest,
  BrowserSessionState,
  BrowserCommand,
  BrowserEvent,
  SearchRequest,
  SearchResult,
  SearchHit,
  ResearchJob,
  ResearchProgress,
  ResearchResult,
  ResearchClaim,
  PageSnapshot,
  DocumentRecord,
  ProviderTrace,
});

export function parseCoreModel(name, data) {
  const Model = CORE_MODELS[name];
  if (!Model) {
    throw new BrowserCoreError(`Unknown core model: ${name}`, { code: "invalid_request" });
  }
  return Model.fromWire(data);
}
