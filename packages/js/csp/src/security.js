/**
 * Browser-safe HK-CSP security profiles, identity, authorization, and replay protection.
 */

import { CspError } from "./contracts.js";

export const SecurityProfile = Object.freeze({
  LOCAL: "local",
  STANDARD: "standard",
  HYBRID_PQ: "hybrid-pq",
  RESEARCH: "research",
});

const RECOGNIZED_PROFILES = Object.freeze(Object.values(SecurityProfile));

export function negotiateSecurityProfile(required, offered, supportedProfiles) {
  if (!RECOGNIZED_PROFILES.includes(required) || !RECOGNIZED_PROFILES.includes(offered)) {
    throw new SecurityProfileUnavailableError(
      "A security profile is not recognized by this runtime.",
      { required, offered },
    );
  }
  if (required !== offered) {
    throw new SecurityProfileMismatchError(
      "Required and offered security profiles do not match.",
      { required, offered },
    );
  }
  if (!supportedProfiles.includes(required)) {
    throw new SecurityProfileUnavailableError(
      "The exact security profile has no active provider.",
      { profile: required },
    );
  }
  return required;
}

export class SecurityError extends CspError {
  constructor(message, { code = "security_error", details = {} } = {}) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.details = { ...details };
  }

  toWire() {
    return { code: this.code, message: this.message, details: { ...this.details } };
  }
}

export class SecurityProfileUnavailableError extends SecurityError {
  constructor(message, details = {}) {
    super(message, { code: "security_profile_unavailable", details });
  }
}

export class SecurityProfileMismatchError extends SecurityError {
  constructor(message, details = {}) {
    super(message, { code: "security_profile_mismatch", details });
  }
}

export class AuthenticationError extends SecurityError {
  constructor(message, { code = "authentication_failed", details = {} } = {}) {
    super(message, { code, details });
  }
}

export class AuthorizationError extends SecurityError {
  constructor(message, { code = "authorization_denied", details = {} } = {}) {
    super(message, { code, details });
  }
}

export class ReplayDetectedError extends SecurityError {
  constructor(message, { code = "replay_detected", details = {} } = {}) {
    super(message, { code, details });
  }
}

export class ArtifactSignatureError extends SecurityError {
  constructor(message, { code = "artifact_signature_invalid", details = {} } = {}) {
    super(message, { code, details });
  }
}

export class SecurityConfig {
  constructor(options = {}) {
    this.profile = options.profile || SecurityProfile.LOCAL;
    if (!RECOGNIZED_PROFILES.includes(this.profile)) {
      throw new TypeError(`invalid_profile: ${this.profile}`);
    }
    this.requireMtls = Boolean(options.requireMtls || options.require_mtls);
    this.allowInsecureLoopback = Boolean(options.allowInsecureLoopback || options.allow_insecure_loopback);
    this.trustDomain = options.trustDomain || options.trust_domain || "handoffkit.internal";
    this.caCertPath = options.caCertPath || options.ca_cert_path || null;
    this.certPath = options.certPath || options.cert_path || null;
    this.keyPath = options.keyPath || options.key_path || null;
    this.replayWindowSeconds = options.replayWindowSeconds || options.replay_window_seconds || 300;
    this.maxClockSkewSeconds = options.maxClockSkewSeconds || options.max_clock_skew_seconds || 10;
  }

  toWire() {
    return {
      profile: this.profile,
      require_mtls: this.requireMtls,
      allow_insecure_loopback: this.allowInsecureLoopback,
      trust_domain: this.trustDomain,
      replay_window_seconds: this.replayWindowSeconds,
      max_clock_skew_seconds: this.maxClockSkewSeconds,
    };
  }

  static fromWire(data = {}) {
    return new SecurityConfig(data);
  }

  validateListenAddress(host) {
    const isLoopback = host === "127.0.0.1" || host === "localhost" || host === "::1";
    if (
      (this.profile === SecurityProfile.LOCAL || this.profile === SecurityProfile.RESEARCH)
      && !isLoopback
    ) {
      throw new Error(`Profile '${this.profile}' cannot listen on non-loopback interface '${host}'`);
    }
  }
}

export class PeerIdentity {
  constructor(data = {}) {
    this.peerId = data.peerId || data.peer_id || "";
    this.nodeId = data.nodeId || data.node_id || "";
    this.workerId = data.workerId || data.worker_id || null;
    this.trustDomain = data.trustDomain || data.trust_domain || "handoffkit.internal";
    this.credentialFingerprint = data.credentialFingerprint || data.credential_fingerprint || "";
    this.capabilities = Array.isArray(data.capabilities) ? [...data.capabilities] : [];
    this.issuedAt = Number(data.issuedAt || data.issued_at || 0);
    this.expiresAt = Number(data.expiresAt || data.expires_at || 0);
  }

  isValidAt(timestampSeconds) {
    const ts = timestampSeconds !== undefined ? timestampSeconds : Math.floor(Date.now() / 1000);
    if (this.expiresAt > 0 && ts > this.expiresAt) return false;
    if (this.issuedAt > 0 && ts < this.issuedAt - 60) return false;
    return true;
  }

  toWire() {
    return {
      peer_id: this.peerId,
      node_id: this.nodeId,
      worker_id: this.workerId,
      trust_domain: this.trustDomain,
      credential_fingerprint: this.credentialFingerprint,
      capabilities: this.capabilities,
      issued_at: this.issuedAt,
      expires_at: this.expiresAt,
    };
  }

  static fromWire(data = {}) {
    return new PeerIdentity(data);
  }
}

export class SignedArtifact {
  constructor(data = {}) {
    this.artifactId = data.artifactId || data.artifact_id || "";
    this.contentHash = data.contentHash || data.content_hash || "";
    this.signature = data.signature || "";
    this.algorithm = data.algorithm || "";
    this.signerIdentity = data.signerIdentity || data.signer_identity || "";
    this.keyFingerprint = normalizeFingerprint(
      data.keyFingerprint || data.key_fingerprint || "",
    );
    this.createdAt = Number(data.createdAt ?? data.created_at ?? -1);
    if (!this.artifactId || !this.signerIdentity) {
      throw new TypeError("artifact_id and signer_identity must not be empty");
    }
    if (this.algorithm !== "ed25519") {
      throw new TypeError(`unsupported artifact signature algorithm: ${this.algorithm}`);
    }
    if (!/^[0-9a-f]{64}$/.test(this.contentHash)) {
      throw new TypeError("content_hash must be a lowercase SHA-256 hex digest");
    }
    if (!/^sha256:[0-9a-f]{64}$/.test(this.keyFingerprint)) {
      throw new TypeError("key_fingerprint must contain a SHA-256 digest");
    }
    if (!Number.isSafeInteger(this.createdAt) || this.createdAt < 0) {
      throw new TypeError("created_at must be a non-negative safe integer");
    }
  }

  toWire() {
    return {
      artifact_id: this.artifactId,
      content_hash: this.contentHash,
      signature: this.signature,
      algorithm: this.algorithm,
      signer_identity: this.signerIdentity,
      key_fingerprint: this.keyFingerprint,
      created_at: this.createdAt,
    };
  }

  canonicalPayload() {
    const canonical = JSON.stringify({
      algorithm: this.algorithm,
      artifact_id: this.artifactId,
      content_hash: this.contentHash,
      created_at: this.createdAt,
      key_fingerprint: this.keyFingerprint,
      signer_identity: this.signerIdentity,
    });
    return new TextEncoder().encode(canonical);
  }

  static fromWire(data = {}) {
    return new SignedArtifact(data);
  }
}

export class CertificateIdentityPolicy {
  constructor(options = {}) {
    this.trustDomain = options.trustDomain || options.trust_domain || "";
    if (!this.trustDomain) throw new TypeError("trustDomain must not be empty");
    const grants = options.capabilitiesByFingerprint || options.capabilities_by_fingerprint || {};
    const entries = grants instanceof Map ? grants.entries() : Object.entries(grants);
    this.capabilitiesByFingerprint = new Map(
      [...entries].map(([fingerprint, capabilities]) => [
        normalizeFingerprint(fingerprint),
        Object.freeze([...capabilities]),
      ]),
    );
    this.revokedFingerprints = new Set(
      [...(options.revokedFingerprints || options.revoked_fingerprints || [])]
        .map(normalizeFingerprint),
    );
    this.expectedPeerId = options.expectedPeerId || options.expected_peer_id || null;
    this.expectedNodeId = options.expectedNodeId || options.expected_node_id || null;
    this.expectedWorkerId = options.expectedWorkerId || options.expected_worker_id || null;
    this.allowedIssuerNames = Object.freeze([
      ...(options.allowedIssuerNames || options.allowed_issuer_names || []),
    ]);
    this.requireAuthorizedFingerprint = options.requireAuthorizedFingerprint
      ?? options.require_authorized_fingerprint
      ?? true;
  }
}

export function normalizeFingerprint(value) {
  let normalized = String(value || "").trim().toLowerCase().replaceAll(":", "");
  if (normalized.startsWith("sha256")) normalized = normalized.slice("sha256".length);
  return `sha256:${normalized}`;
}

export function validateDeclaredPeerIdentity(authenticated, declaredValue) {
  const declared = declaredValue instanceof PeerIdentity
    ? declaredValue
    : PeerIdentity.fromWire(declaredValue);
  const comparisons = {
    peer_id: [authenticated.peerId, declared.peerId],
    node_id: [authenticated.nodeId, declared.nodeId],
    worker_id: [authenticated.workerId, declared.workerId],
    trust_domain: [authenticated.trustDomain, declared.trustDomain],
    credential_fingerprint: [
      authenticated.credentialFingerprint,
      normalizeFingerprint(declared.credentialFingerprint),
    ],
    capabilities: [authenticated.capabilities, declared.capabilities],
  };
  const mismatches = Object.entries(comparisons)
    .filter(([, [expected, actual]]) => JSON.stringify(expected) !== JSON.stringify(actual))
    .map(([name]) => name);
  if (mismatches.length > 0) {
    throw new AuthenticationError(
      "Declared peer identity does not match the authenticated certificate identity.",
      { code: "declared_identity_mismatch", details: { fields: mismatches } },
    );
  }
}

export class CapabilityPolicy {
  constructor(options = {}) {
    this.allowedOperations = options.allowedOperations ? new Set(options.allowedOperations) : null;
  }

  isOperationAuthorized(operation, peer = null) {
    if (this.allowedOperations !== null && !this.allowedOperations.has(operation)) {
      return false;
    }
    if (peer) {
      if (peer.capabilities.includes("*") || peer.capabilities.includes(operation)) {
        return true;
      }
      const prefix = operation.split(":")[0] + ":*";
      if (peer.capabilities.includes(prefix)) {
        return true;
      }
      return false;
    }
    return true;
  }

  authorizeJob(jobType, peer) {
    if (!peer.isValidAt()) {
      throw new AuthenticationError(`Peer identity '${peer.peerId}' has expired or is invalid.`);
    }
    const op = `job:${jobType}`;
    if (!this.isOperationAuthorized(op, peer) && !this.isOperationAuthorized(jobType, peer)) {
      throw new AuthorizationError(
        `Peer '${peer.peerId}' is not authorized to execute job type '${jobType}'.`,
      );
    }
  }
}

export class ReplayProtection {
  constructor(options = {}) {
    this.windowSeconds = options.windowSeconds || 300;
    this.maxSkewSeconds = options.maxSkewSeconds || 10;
    this.maxSeenNonces = options.maxSeenNonces || 10000;
    this.seenNonces = new Map();
    this.lastSequences = new Map();
  }

  checkAndRecord(sessionId, sequence, nonce = null, createdAtTs = null) {
    const now = Date.now() / 1000;
    if (createdAtTs !== null) {
      if (createdAtTs < now - this.windowSeconds) {
        throw new ReplayDetectedError(
          `Message timestamp is older than replay window (${this.windowSeconds}s).`,
          { code: "replay_timestamp_stale" },
        );
      }
      if (createdAtTs > now + this.maxSkewSeconds) {
        throw new ReplayDetectedError(
          `Message timestamp is in the future beyond max clock skew (${this.maxSkewSeconds}s).`,
          { code: "replay_timestamp_future" },
        );
      }
    }

    if (this.lastSequences.has(sessionId)) {
      const last = this.lastSequences.get(sessionId);
      if (sequence <= last) {
        throw new ReplayDetectedError(
          `Sequence ${sequence} is not strictly monotonic for session ${sessionId} (last: ${last}).`,
          { code: "replay_sequence" },
        );
      }
    }

    const nonceKey = nonce ? `${sessionId}\0${nonce}` : null;
    if (nonce) {
      this.pruneOldNonces(now);
      if (this.seenNonces.has(nonceKey)) {
        throw new ReplayDetectedError(
          `Duplicate nonce detected: ${nonce}`,
          { code: "replay_nonce" },
        );
      }
    }

    this.lastSequences.set(sessionId, sequence);
    if (nonceKey) {
      if (this.seenNonces.size >= this.maxSeenNonces) {
        const oldestKey = this.seenNonces.keys().next().value;
        this.seenNonces.delete(oldestKey);
      }
      this.seenNonces.set(nonceKey, now);
    }
  }

  pruneOldNonces(now = Date.now() / 1000) {
    const cutoff = now - this.windowSeconds;
    for (const [nonce, ts] of this.seenNonces.entries()) {
      if (ts < cutoff) {
        this.seenNonces.delete(nonce);
      }
    }
  }
}

export function getSupportedCryptoCapabilities() {
  return {
    runtime: "browser-contracts",
    contracts_only: true,
    tls13_supported: false,
    profiles_supported: [SecurityProfile.LOCAL],
    profiles_recognized: [...RECOGNIZED_PROFILES],
    digest_algorithms: [],
    signature_algorithms: [],
    hybrid_pq_group: null,
    hybrid_pq_supported: false,
  };
}

export function assertSecurityProfileSupported(profile, capabilities = getSupportedCryptoCapabilities()) {
  if (!capabilities.profiles_supported.includes(profile)) {
    throw new SecurityProfileUnavailableError(
      `Security profile '${profile}' is unavailable in this runtime.`,
      { profile, runtime: capabilities.runtime || "unknown" },
    );
  }
}
