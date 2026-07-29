/**
 * Browser-safe HK-CSP security profiles, identity, authorization, and replay protection.
 */

export const SecurityProfile = Object.freeze({
  LOCAL: "local",
  STANDARD: "standard",
  HYBRID_PQ: "hybrid-pq",
  RESEARCH: "research",
});

export class SecurityConfig {
  constructor(options = {}) {
    this.profile = options.profile || SecurityProfile.LOCAL;
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
    if ((host === "0.0.0.0" || host === "::") && this.allowInsecureLoopback) {
      throw new Error("allow_insecure_loopback cannot be used with public bind (0.0.0.0)");
    }
    const isLoopback = host === "127.0.0.1" || host === "localhost" || host === "::1";
    if (this.profile === SecurityProfile.LOCAL) {
      if (!isLoopback && !this.allowInsecureLoopback) {
        throw new Error(
          `Profile 'local' cannot listen on non-loopback interface '${host}' without allowInsecureLoopback=true`
        );
      }
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

export class CapabilityPolicy {
  constructor(options = {}) {
    this.allowedOperations = options.allowedOperations ? new Set(options.allowedOperations) : null;
  }

  isOperationAuthorized(operation, peer = null) {
    if (this.allowedOperations !== null && !this.allowedOperations.has(operation)) {
      return false;
    }
    if (peer && peer.capabilities && peer.capabilities.length > 0) {
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
      throw new Error(`Peer identity '${peer.peerId}' has expired or is invalid.`);
    }
    const op = `job:${jobType}`;
    if (!this.isOperationAuthorized(op, peer) && !this.isOperationAuthorized(jobType, peer)) {
      throw new Error(`Peer '${peer.peerId}' is not authorized to execute job type '${jobType}'.`);
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
        throw new Error(`Message timestamp is older than replay window (${this.windowSeconds}s).`);
      }
      if (createdAtTs > now + this.maxSkewSeconds) {
        throw new Error(`Message timestamp is in the future beyond max clock skew (${this.maxSkewSeconds}s).`);
      }
    }

    if (this.lastSequences.has(sessionId)) {
      const last = this.lastSequences.get(sessionId);
      if (sequence <= last) {
        throw new Error(`Sequence ${sequence} is not strictly monotonic for session ${sessionId} (last: ${last}).`);
      }
    }
    this.lastSequences.set(sessionId, sequence);

    if (nonce) {
      this.pruneOldNonces(now);
      if (this.seenNonces.has(nonce)) {
        throw new Error(`Duplicate nonce detected: ${nonce}`);
      }
      if (this.seenNonces.size >= this.maxSeenNonces) {
        const oldestKey = this.seenNonces.keys().next().value;
        this.seenNonces.delete(oldestKey);
      }
      this.seenNonces.set(nonce, now);
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
    tls13_supported: true,
    profiles_supported: ["local", "standard", "hybrid-pq", "research"],
    digest_algorithms: ["sha256", "sha384", "sha512"],
    signature_algorithms: ["ed25519", "ecdsa-p256"],
    hybrid_pq_supported: true,
  };
}
