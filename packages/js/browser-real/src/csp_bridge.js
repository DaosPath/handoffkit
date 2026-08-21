import { randomBytes, randomUUID } from "node:crypto";

import { makeEnvelope, MessageEnvelope, normalizeFingerprint, ReplayDetectedError } from "@handoffkit/csp";
import { BrowserCommand, BrowserCoreError, BrowserEvent } from "@handoffkit/browser-core";

export const BROWSER_CONTROL_CHANNEL = "browser.control";
export const BROWSER_CONTROL_OPERATION = "browser:control";

export function cryptographicNonce() {
  return randomBytes(16).toString("hex");
}

export function identityFingerprint(identity) {
  return identity?.credentialFingerprint
    || identity?.credential_fingerprint
    || identity?.fingerprint
    || identity?.certificateFingerprint
    || "";
}

export function identityPeerId(identity) {
  return identity?.peerId || identity?.peer_id || "";
}

export function identityWire(identity) {
  if (!identity) return null;
  if (typeof identity.toWire === "function") return identity.toWire();
  if (typeof identity.to_dict === "function") return identity.to_dict();
  return {
    peer_id: identityPeerId(identity),
    node_id: identity.nodeId || identity.node_id || "",
    worker_id: identity.workerId ?? identity.worker_id ?? null,
    trust_domain: identity.trustDomain || identity.trust_domain || "",
    credential_fingerprint: identityFingerprint(identity),
    capabilities: [...(identity.capabilities || [])],
    issued_at: Number(identity.issuedAt || identity.issued_at || 0),
    expires_at: Number(identity.expiresAt || identity.expires_at || 0),
  };
}

/**
 * Source is the SPIFFE peer_id from the certificate SAN when present.
 * Fingerprint-only identities remain an explicit test fallback, not TLS interoperability.
 */
export function sourceFromCertificate(identity) {
  const peerId = identityPeerId(identity);
  if (peerId) return peerId;
  const fingerprint = identityFingerprint(identity);
  if (!fingerprint) {
    throw new BrowserCoreError("certificate authentication is required", { code: "unauthorized" });
  }
  return `cert:${fingerprint}`;
}

export function grantKeys(fingerprint) {
  if (!fingerprint) return ["*"];
  return [normalizeFingerprint(fingerprint), fingerprint, "*"];
}

function secureMetadata(identity, extra = {}) {
  const nonce = cryptographicNonce();
  const wire = identityWire(identity);
  return {
    nonce,
    security_nonce: nonce,
    operation: BROWSER_CONTROL_OPERATION,
    certificate_fingerprint: identityFingerprint(identity),
    ...(wire ? { peer_identity: wire } : {}),
    ...extra,
  };
}

export function wrapCommandEnvelope({ command, sessionId, sequence, identity, deadline = null }) {
  const wire = command instanceof BrowserCommand ? command.toWire() : command;
  const envelope = makeEnvelope({
    sessionId: sessionId || wire.session_id || randomUUID(),
    channel: BROWSER_CONTROL_CHANNEL,
    source: sourceFromCertificate(identity),
    payloadType: "browser.command",
    payload: wire,
    sequence,
    kind: "request",
    idempotencyKey: wire.idempotency_key || null,
  });
  envelope.deadline = deadline;
  envelope.metadata = secureMetadata(identity, {
    command_name: wire.name || "",
  });
  return envelope;
}

export function wrapEventEnvelope({ event, request, identity, sequence }) {
  const wire = event instanceof BrowserEvent ? event.toWire() : event;
  const envelope = makeEnvelope({
    sessionId: request.sessionId,
    channel: BROWSER_CONTROL_CHANNEL,
    source: sourceFromCertificate(identity),
    payloadType: "browser.event",
    payload: wire,
    sequence,
    kind: "response",
  });
  envelope.correlationId = request.messageId;
  envelope.metadata = secureMetadata(identity, {
    command_name: request.metadata?.command_name || "",
  });
  return envelope;
}

export function decodeEnvelope(raw) {
  const envelope = raw instanceof MessageEnvelope ? raw : MessageEnvelope.fromWire(raw);
  if (envelope.channel !== BROWSER_CONTROL_CHANNEL) {
    throw new BrowserCoreError("unexpected CSP channel", {
      code: "invalid_request",
      details: { channel: envelope.channel },
    });
  }
  if (envelope.kind !== "request" && envelope.kind !== "response") {
    throw new BrowserCoreError("CSP kind must be request or response", {
      code: "invalid_request",
      details: { kind: envelope.kind },
    });
  }
  return envelope;
}

export function assertEnvelopeSource(envelope, identity) {
  const fingerprint = identityFingerprint(identity);
  const peerId = identityPeerId(identity);
  if (!fingerprint && !peerId) {
    throw new BrowserCoreError("certificate authentication is required", { code: "unauthorized" });
  }
  const allowed = new Set([
    peerId,
    fingerprint ? `cert:${fingerprint}` : "",
    fingerprint ? `cert:${normalizeFingerprint(fingerprint)}` : "",
  ].filter(Boolean));
  if (!allowed.has(envelope.source)) {
    throw new BrowserCoreError("envelope source does not match the certificate", { code: "unauthorized" });
  }
}

export function checkTransportReplay(replay, envelope, identity) {
  const nonce = envelope.metadata?.security_nonce || envelope.metadata?.nonce;
  if (!nonce) {
    throw new BrowserCoreError("cryptographic nonce is required", { code: "replay_detected" });
  }
  const createdAtTs = Date.parse(envelope.createdAt) / 1000;
  const fingerprint = identityFingerprint(identity);
  const scope = `${fingerprint || identityPeerId(identity)}:${envelope.sessionId}`;
  try {
    replay.checkAndRecord(scope, envelope.sequence, nonce, createdAtTs, {
      source: envelope.source,
      fingerprint,
    });
  } catch (error) {
    if (error instanceof ReplayDetectedError || String(error?.code ?? "").includes("replay")) {
      throw new BrowserCoreError(String(error.message), { code: "replay_detected" });
    }
    throw error;
  }
}

export function connectionSequencer() {
  let next = 0;
  return {
    next() {
      next += 1;
      return next;
    },
  };
}

export function identityWithGrants(identity, grants) {
  if (!identity) return identity;
  const fingerprint = identityFingerprint(identity);
  let caps = [...(identity.capabilities || [])];
  if (grants && fingerprint) {
    const found = grants.get(normalizeFingerprint(fingerprint)) || grants.get(fingerprint);
    if (found) caps = [...found];
  }
  const wire = { ...identityWire(identity), capabilities: caps };
  return {
    ...identity,
    capabilities: caps,
    peerId: wire.peer_id,
    credentialFingerprint: wire.credential_fingerprint,
    toWire() {
      return wire;
    },
  };
}
