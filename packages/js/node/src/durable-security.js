import {
  closeSync,
  fchmodSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

import { ReplayProtection, SecurityError } from "@handoffkit/csp";

export const DURABLE_REPLAY_FORMAT_VERSION = 1;
const DURABLE_REPLAY_KIND = "handoffkit.security.replay";
export const DURABLE_REVOCATION_FORMAT_VERSION = 1;
const DURABLE_REVOCATION_KIND = "handoffkit.security.revocations";
const REVOCATION_KINDS = new Set([
  "certificate_fingerprint",
  "signer_fingerprint",
  "peer_id",
  "issuer",
  "trust_domain",
]);

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function checksum(payload) {
  return `sha256:${createHash("sha256").update(canonicalJson(payload)).digest("hex")}`;
}

function stateError(message, code, details = {}) {
  return new SecurityError(message, { code, details });
}

class VersionedStateFile {
  constructor(filePath, { maxFileBytes }) {
    this.path = path.resolve(filePath);
    this.maxFileBytes = maxFileBytes;
    if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes < 1024) {
      throw new TypeError("maxFileBytes must be an integer of at least 1024");
    }
    this.parent = path.dirname(this.path);
    mkdirSync(this.parent, { recursive: true, mode: 0o700 });
    const parentStat = lstatSync(this.parent);
    if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
      throw stateError(
        "Durable security state parent must be a regular directory.",
        "security_state_path_unsafe",
        { name: path.basename(this.path) },
      );
    }
    if (this.exists()) this.validateExistingPath();
  }

  exists() {
    try {
      lstatSync(this.path);
      return true;
    } catch (error) {
      if (error?.code === "ENOENT") return false;
      throw error;
    }
  }

  validateExistingPath() {
    const info = lstatSync(this.path);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw stateError(
        "Durable security state must be a regular non-symlink file.",
        "security_state_path_unsafe",
        { name: path.basename(this.path) },
      );
    }
    if (process.platform !== "win32" && (info.mode & 0o077) !== 0) {
      throw stateError(
        "Durable security state grants group or other permissions.",
        "security_state_permissions",
        { name: path.basename(this.path) },
      );
    }
    if (info.size > this.maxFileBytes) this.quarantine("state exceeds configured byte limit");
  }

  load() {
    if (!this.exists()) return null;
    this.validateExistingPath();
    let value;
    try {
      value = JSON.parse(readFileSync(this.path, "utf8"));
    } catch (error) {
      this.quarantine(`state cannot be decoded: ${error?.name || "Error"}`);
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      this.quarantine("state root is not an object");
    }
    const { checksum: actualChecksum, ...payload } = value;
    if (typeof actualChecksum !== "string" || actualChecksum !== checksum(payload)) {
      this.quarantine("state checksum mismatch");
    }
    return value;
  }

  commit(payload) {
    const envelope = { ...payload, checksum: checksum(payload) };
    const encoded = Buffer.from(`${canonicalJson(envelope)}\n`, "utf8");
    if (encoded.length > this.maxFileBytes) {
      throw stateError(
        "Durable security state exceeds configured byte limit.",
        "security_state_limit",
        { limit_bytes: this.maxFileBytes },
      );
    }
    const temporary = path.join(
      this.parent,
      `.${path.basename(this.path)}.tmp-${randomUUID()}`,
    );
    let descriptor = null;
    let replaced = false;
    try {
      descriptor = openSync(temporary, "wx", 0o600);
      if (process.platform !== "win32") fchmodSync(descriptor, 0o600);
      writeSync(descriptor, encoded);
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = null;
      renameSync(temporary, this.path);
      replaced = true;
      if (process.platform !== "win32") {
        const directoryDescriptor = openSync(this.parent, "r");
        try {
          fsyncSync(directoryDescriptor);
        } finally {
          closeSync(directoryDescriptor);
        }
      }
    } catch (error) {
      if (replaced) {
        throw stateError(
          "Durable replay state committed but directory sync was uncertain.",
          "replay_state_durability_uncertain",
          { reason: error?.code || error?.name || "Error" },
        );
      }
      throw stateError(
        "Durable security state write failed before commit.",
        "security_state_write_failed",
        { reason: error?.code || error?.name || "Error" },
      );
    } finally {
      if (descriptor !== null) closeSync(descriptor);
      try {
        unlinkSync(temporary);
      } catch (error) {
        if (error?.code !== "ENOENT") {
          // The valid primary state remains authoritative. Orphans are ignored on load.
        }
      }
    }
  }

  quarantine(reason) {
    const target = `${this.path}.corrupt-${Math.floor(Date.now() / 1000)}-${randomUUID().slice(0, 12)}`;
    try {
      renameSync(this.path, target);
    } catch (error) {
      throw stateError(
        "Durable security state is invalid and could not be quarantined.",
        "security_state_quarantine_failed",
        { name: path.basename(this.path), reason: error?.code || error?.name || "Error" },
      );
    }
    throw stateError(
      "Durable security state is invalid and was quarantined.",
      "security_state_corrupt",
      { name: path.basename(this.path), reason, quarantine: path.basename(target) },
    );
  }
}

function replayContext(value, existing = null) {
  const source = value || existing;
  if (!source) {
    throw stateError(
      "Durable replay state requires authenticated context.",
      "replay_context_missing",
    );
  }
  const result = {
    peer_id: source.peerId || source.peer_id,
    session_id: source.sessionId || source.session_id,
    credential_fingerprint: source.credentialFingerprint || source.credential_fingerprint,
    security_profile: source.securityProfile || source.security_profile,
  };
  for (const [name, item] of Object.entries(result)) {
    if (typeof item !== "string" || item.length === 0) {
      throw new TypeError(`${name} must not be empty`);
    }
  }
  return result;
}

export class DurableReplayProtection extends ReplayProtection {
  constructor(filePath, options = {}) {
    super(options);
    this.maxScopes = options.maxScopes ?? options.max_scopes ?? 10_000;
    this.stateTtlSeconds = options.stateTtlSeconds ?? options.state_ttl_seconds ?? 86_400;
    const maxFileBytes = options.maxFileBytes ?? options.max_file_bytes ?? 4 * 1024 * 1024;
    if (!Number.isSafeInteger(this.maxScopes) || this.maxScopes < 1) {
      throw new TypeError("maxScopes must be a positive integer");
    }
    if (!Number.isSafeInteger(this.stateTtlSeconds)
      || this.stateTtlSeconds < this.windowSeconds) {
      throw new TypeError("stateTtlSeconds must cover the replay window");
    }
    this.stateFile = new VersionedStateFile(filePath, { maxFileBytes });
    this.generation = 0;
    this.records = new Map();
    this.load();
  }

  status() {
    return {
      format: DURABLE_REPLAY_KIND,
      format_version: DURABLE_REPLAY_FORMAT_VERSION,
      generation: this.generation,
      scopes: this.records.size,
      nonces: this.seenNonces.size,
    };
  }

  checkAndRecord(sessionId, sequence, nonce = null, createdAtTs = null, context = null) {
    const now = Date.now() / 1000;
    this.compactInMemory(now);
    if (!this.records.has(sessionId) && this.records.size >= this.maxScopes) {
      throw stateError(
        "Durable replay scope capacity is exhausted.",
        "replay_state_capacity",
        { max_scopes: this.maxScopes },
      );
    }

    const previousSequences = new Map(this.lastSequences);
    const previousNonces = new Map(this.seenNonces);
    const previousRecords = new Map(
      [...this.records].map(([scope, record]) => [scope, structuredClone(record)]),
    );
    const previousGeneration = this.generation;

    super.checkAndRecord(sessionId, sequence, nonce, createdAtTs, context);
    const authenticated = replayContext(context, this.records.get(sessionId));
    const nonces = [...this.seenNonces.entries()]
      .filter(([key]) => key.startsWith(`${sessionId}\0`))
      .map(([key, seenAt]) => ({ seen_at: Math.floor(seenAt), value: key.slice(sessionId.length + 1) }))
      .sort((left, right) => left.seen_at - right.seen_at || left.value.localeCompare(right.value));
    this.records.set(sessionId, {
      credential_fingerprint: authenticated.credential_fingerprint,
      expires_at: Math.floor(now) + this.stateTtlSeconds,
      last_sequence: sequence,
      nonces,
      peer_id: authenticated.peer_id,
      scope: sessionId,
      security_profile: authenticated.security_profile,
      session_id: authenticated.session_id,
      updated_at: Math.floor(now),
    });
    this.generation += 1;
    try {
      this.persist();
    } catch (error) {
      if (error?.code === "replay_state_durability_uncertain") throw error;
      this.lastSequences = previousSequences;
      this.seenNonces = previousNonces;
      this.records = previousRecords;
      this.generation = previousGeneration;
      throw error;
    }
  }

  compact({ now = Date.now() / 1000 } = {}) {
    if (this.compactInMemory(now)) {
      this.generation += 1;
      this.persist();
    }
  }

  compactInMemory(now) {
    const beforeRecords = this.records.size;
    const beforeNonces = this.seenNonces.size;
    this.pruneOldNonces(now);
    for (const [scope, record] of this.records.entries()) {
      if (record.expires_at <= Math.floor(now)) {
        this.records.delete(scope);
        this.lastSequences.delete(scope);
        for (const key of this.seenNonces.keys()) {
          if (key.startsWith(`${scope}\0`)) this.seenNonces.delete(key);
        }
      }
    }
    for (const [scope, record] of this.records.entries()) {
      record.nonces = [...this.seenNonces.entries()]
        .filter(([key]) => key.startsWith(`${scope}\0`))
        .map(([key, seenAt]) => ({ seen_at: Math.floor(seenAt), value: key.slice(scope.length + 1) }))
        .sort((left, right) => left.seen_at - right.seen_at || left.value.localeCompare(right.value));
    }
    return beforeRecords !== this.records.size || beforeNonces !== this.seenNonces.size;
  }

  payload() {
    return {
      format: DURABLE_REPLAY_KIND,
      format_version: DURABLE_REPLAY_FORMAT_VERSION,
      generation: this.generation,
      records: [...this.records.keys()].sort().map((scope) => this.records.get(scope)),
    };
  }

  persist() {
    this.stateFile.commit(this.payload());
  }

  load() {
    const value = this.stateFile.load();
    if (value === null) return;
    if (value.format !== DURABLE_REPLAY_KIND) this.stateFile.quarantine("unexpected state format");
    if (value.format_version !== DURABLE_REPLAY_FORMAT_VERSION) {
      this.stateFile.quarantine("unsupported state format version");
    }
    if (!Number.isSafeInteger(value.generation) || value.generation < 0
      || !Array.isArray(value.records)) {
      this.stateFile.quarantine("invalid state metadata");
    }
    if (value.records.length > this.maxScopes) {
      this.stateFile.quarantine("state exceeds configured scope capacity");
    }
    const required = [
      "credential_fingerprint",
      "expires_at",
      "last_sequence",
      "nonces",
      "peer_id",
      "scope",
      "security_profile",
      "session_id",
      "updated_at",
    ];
    const records = new Map();
    const sequences = new Map();
    const nonces = new Map();
    try {
      for (const record of value.records) {
        if (!record || typeof record !== "object" || Array.isArray(record)
          || JSON.stringify(Object.keys(record).sort()) !== JSON.stringify(required)) {
          throw new TypeError("record fields are invalid");
        }
        replayContext(record);
        if (typeof record.scope !== "string" || record.scope.length === 0 || records.has(record.scope)) {
          throw new TypeError("record scope is invalid or duplicated");
        }
        for (const name of ["expires_at", "last_sequence", "updated_at"]) {
          if (!Number.isSafeInteger(record[name]) || record[name] < 0) {
            throw new TypeError(`record ${name} is invalid`);
          }
        }
        if (!Array.isArray(record.nonces)) throw new TypeError("record nonces are invalid");
        for (const entry of record.nonces) {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)
            || JSON.stringify(Object.keys(entry).sort()) !== JSON.stringify(["seen_at", "value"])
            || !Number.isSafeInteger(entry.seen_at) || entry.seen_at < 0
            || typeof entry.value !== "string" || entry.value.length === 0) {
            throw new TypeError("nonce entry is invalid");
          }
          const key = `${record.scope}\0${entry.value}`;
          if (nonces.has(key)) throw new TypeError("nonce entry is duplicated");
          nonces.set(key, entry.seen_at);
        }
        records.set(record.scope, structuredClone(record));
        sequences.set(record.scope, record.last_sequence);
      }
    } catch (error) {
      this.stateFile.quarantine(error.message || "invalid state record");
    }
    if (nonces.size > this.maxSeenNonces) {
      this.stateFile.quarantine("state exceeds configured nonce capacity");
    }
    this.generation = value.generation;
    this.records = records;
    this.lastSequences = sequences;
    this.seenNonces = nonces;
    this.compactInMemory(Date.now() / 1000);
  }
}

export function normalizeRevocationValue(kind, value) {
  let normalized = String(value ?? "").trim();
  if (!REVOCATION_KINDS.has(kind)) throw new TypeError(`unsupported revocation kind: ${kind}`);
  if (!normalized) throw new TypeError("revocation value must not be empty");
  if (kind === "certificate_fingerprint" || kind === "signer_fingerprint") {
    normalized = normalized.toLowerCase().replaceAll(":", "");
    if (normalized.startsWith("sha256")) normalized = normalized.slice("sha256".length);
    if (!/^[a-f0-9]{64}$/.test(normalized)) {
      throw new TypeError("revocation fingerprint must be a SHA-256 fingerprint");
    }
    return `sha256:${normalized}`;
  }
  return kind === "trust_domain" ? normalized.toLowerCase() : normalized;
}

export class RevocationEntry {
  constructor({
    kind,
    value,
    reason,
    revokedAt,
    revoked_at: revokedAtWire,
    effectiveAt,
    effective_at: effectiveAtWire,
    expiresAt = 0,
    expires_at: expiresAtWire = 0,
  } = {}) {
    this.kind = kind;
    this.value = normalizeRevocationValue(kind, value);
    this.reason = String(reason ?? "");
    this.revokedAt = Number(revokedAt ?? revokedAtWire);
    this.effectiveAt = Number(effectiveAt ?? effectiveAtWire ?? this.revokedAt);
    this.expiresAt = Number(expiresAt || expiresAtWire);
    if (!this.reason.trim()) throw new TypeError("revocation reason must not be empty");
    for (const [name, timestamp] of Object.entries({
      revokedAt: this.revokedAt,
      effectiveAt: this.effectiveAt,
      expiresAt: this.expiresAt,
    })) {
      if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
        throw new TypeError(`${name} must be a non-negative integer`);
      }
    }
    if (this.expiresAt && this.expiresAt <= this.effectiveAt) {
      throw new TypeError("expiresAt must be later than effectiveAt");
    }
    Object.freeze(this);
  }

  toWire() {
    return {
      effective_at: this.effectiveAt,
      expires_at: this.expiresAt,
      kind: this.kind,
      reason: this.reason,
      revoked_at: this.revokedAt,
      value: this.value,
    };
  }
}

export class DurableRevocationPolicy {
  constructor(filePath, options = {}) {
    this.maxEntries = options.maxEntries ?? options.max_entries ?? 10_000;
    const maxFileBytes = options.maxFileBytes ?? options.max_file_bytes ?? 4 * 1024 * 1024;
    if (!Number.isSafeInteger(this.maxEntries) || this.maxEntries < 1) {
      throw new TypeError("maxEntries must be a positive integer");
    }
    this.stateFile = new VersionedStateFile(filePath, { maxFileBytes });
    this.generation = 0;
    this.entries = new Map();
    this.reload();
  }

  status({ now = Math.floor(Date.now() / 1000) } = {}) {
    return {
      format: DURABLE_REVOCATION_KIND,
      format_version: DURABLE_REVOCATION_FORMAT_VERSION,
      generation: this.generation,
      entries: this.entries.size,
      active: [...this.entries.values()].filter((entry) => this.isActive(entry, now)).length,
    };
  }

  revoke(entryValue) {
    const entry = entryValue instanceof RevocationEntry
      ? entryValue
      : new RevocationEntry(entryValue);
    const candidate = new Map(this.entries);
    candidate.set(this.entryKey(entry.kind, entry.value), entry);
    if (candidate.size > this.maxEntries) {
      throw stateError(
        "Durable revocation capacity is exhausted.",
        "revocation_state_capacity",
        { max_entries: this.maxEntries },
      );
    }
    const generation = this.generation + 1;
    try {
      this.persist(candidate, generation);
    } catch (error) {
      if (error?.code === "replay_state_durability_uncertain") {
        this.entries = candidate;
        this.generation = generation;
        throw stateError(
          "Durable revocation state committed but directory sync was uncertain.",
          "revocation_state_durability_uncertain",
        );
      }
      throw error;
    }
    this.entries = candidate;
    this.generation = generation;
  }

  remove(kind, value) {
    const key = this.entryKey(kind, normalizeRevocationValue(kind, value));
    if (!this.entries.has(key)) return false;
    const candidate = new Map(this.entries);
    candidate.delete(key);
    const generation = this.generation + 1;
    this.persist(candidate, generation);
    this.entries = candidate;
    this.generation = generation;
    return true;
  }

  isRevoked(kind, value, { now = Math.floor(Date.now() / 1000) } = {}) {
    const normalized = normalizeRevocationValue(kind, value);
    const entry = this.entries.get(this.entryKey(kind, normalized));
    return Boolean(entry && this.isActive(entry, now));
  }

  reload() {
    const value = this.stateFile.load();
    if (value === null) {
      this.generation = 0;
      this.entries = new Map();
      return;
    }
    const required = ["checksum", "entries", "format", "format_version", "generation"];
    if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(required)) {
      this.stateFile.quarantine("revocation state fields are invalid");
    }
    if (value.format !== DURABLE_REVOCATION_KIND) {
      this.stateFile.quarantine("unexpected revocation state format");
    }
    if (value.format_version !== DURABLE_REVOCATION_FORMAT_VERSION) {
      this.stateFile.quarantine("unsupported revocation state format version");
    }
    if (!Number.isSafeInteger(value.generation) || value.generation < 0
      || !Array.isArray(value.entries)) {
      this.stateFile.quarantine("invalid revocation state metadata");
    }
    if (value.entries.length > this.maxEntries) {
      this.stateFile.quarantine("revocation state exceeds configured capacity");
    }
    const entries = new Map();
    try {
      for (const raw of value.entries) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)
          || JSON.stringify(Object.keys(raw).sort()) !== JSON.stringify([
            "effective_at", "expires_at", "kind", "reason", "revoked_at", "value",
          ])) {
          throw new TypeError("revocation entry fields are invalid");
        }
        const entry = new RevocationEntry(raw);
        const key = this.entryKey(entry.kind, entry.value);
        if (entries.has(key)) throw new TypeError("revocation entry is duplicated");
        entries.set(key, entry);
      }
    } catch (error) {
      this.stateFile.quarantine(error.message || "invalid revocation entry");
    }
    this.generation = value.generation;
    this.entries = entries;
  }

  persist(entries, generation) {
    this.stateFile.commit({
      format: DURABLE_REVOCATION_KIND,
      format_version: DURABLE_REVOCATION_FORMAT_VERSION,
      generation,
      entries: [...entries.keys()].sort().map((key) => entries.get(key).toWire()),
    });
  }

  entryKey(kind, value) {
    return `${kind}\0${value}`;
  }

  isActive(entry, now) {
    return entry.effectiveAt <= now && (!entry.expiresAt || now < entry.expiresAt);
  }
}
