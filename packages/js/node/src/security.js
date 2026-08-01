import fs from "node:fs";
import {
  X509Certificate,
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as cryptoSign,
  verify as cryptoVerify,
} from "node:crypto";
import tls from "node:tls";
import {
  AuthenticationError,
  ArtifactSignatureError,
  PeerIdentity,
  SecurityError,
  SecurityProfile,
  SecurityProfileUnavailableError,
  SignedArtifact,
  normalizeFingerprint,
} from "@handoffkit/csp";

export const HYBRID_PQ_GROUP = "X25519MLKEM768";

export class FileKeyStore {
  constructor(options = {}) {
    this.caCertPath = options.caCertPath || null;
    this.certPath = options.certPath || null;
    this.keyPath = options.keyPath || null;
    this.closed = false;
  }

  read(path, { privateKey = false } = {}) {
    if (this.closed) {
      throw new SecurityError("KeyStore is closed.", { code: "keystore_closed" });
    }
    if (!path || !fs.existsSync(path)) return null;
    const stats = fs.lstatSync(path);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new SecurityError(
        "KeyStore paths must reference regular non-symlink files.",
        { code: "keystore_path_unsafe", details: { path } },
      );
    }
    if (privateKey && process.platform !== "win32" && (stats.mode & 0o077) !== 0) {
      throw new SecurityError(
        "Private key file grants group or other permissions.",
        {
          code: "insecure_key_permissions",
          details: { path, mode: `0o${(stats.mode & 0o777).toString(8)}` },
        },
      );
    }
    return fs.readFileSync(path, "utf8");
  }

  getCaCertificate() {
    return this.read(this.caCertPath);
  }

  getCertificate() {
    return this.read(this.certPath);
  }

  getPrivateKey() {
    return this.read(this.keyPath, { privateKey: true });
  }

  close() {
    this.closed = true;
  }
}

export function certificateFingerprint(certificate) {
  let raw = certificate;
  if (typeof certificate === "string" && !certificate.includes("BEGIN CERTIFICATE")) {
    raw = fs.readFileSync(certificate);
  }
  return normalizeFingerprint(new X509Certificate(raw).fingerprint256);
}

export function artifactPublicKeyFingerprint(keyValue) {
  const key = typeof keyValue === "string" || Buffer.isBuffer(keyValue)
    ? createPublicKey(keyValue)
    : keyValue.type === "public" ? keyValue : createPublicKey(keyValue);
  const jwk = key.export({ format: "jwk" });
  if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || typeof jwk.x !== "string") {
    throw new TypeError("artifact signing credential must contain an Ed25519 public key");
  }
  const raw = Buffer.from(jwk.x, "base64url");
  return `sha256:${createHash("sha256").update(raw).digest("hex")}`;
}

export class ArtifactSigningCredential {
  constructor({
    signerIdentity,
    signer_identity: signerIdentityWire,
    publicKey,
    public_key: publicKeyWire,
    validFrom = 0,
    valid_from: validFromWire = 0,
    validUntil = 0,
    valid_until: validUntilWire = 0,
    revoked = false,
  } = {}) {
    this.signerIdentity = signerIdentity || signerIdentityWire || "";
    this.publicKey = createPublicKey(publicKey || publicKeyWire);
    this.validFrom = Number(validFrom || validFromWire);
    this.validUntil = Number(validUntil || validUntilWire);
    this.revoked = Boolean(revoked);
    if (!this.signerIdentity) throw new TypeError("signerIdentity must not be empty");
    this.fingerprint = artifactPublicKeyFingerprint(this.publicKey);
  }
}

export class ArtifactTrustPolicy {
  constructor(credentials = [], {
    allowedAlgorithms = ["ed25519"],
    maxFutureSkewSeconds = 10,
  } = {}) {
    this.credentials = new Map(credentials.map((credentialValue) => {
      const credential = credentialValue instanceof ArtifactSigningCredential
        ? credentialValue
        : new ArtifactSigningCredential(credentialValue);
      return [credential.fingerprint, credential];
    }));
    this.allowedAlgorithms = new Set(allowedAlgorithms);
    this.maxFutureSkewSeconds = maxFutureSkewSeconds;
  }
}

export class ArtifactSigner {
  constructor(privateKeyValue, signerIdentity) {
    this.privateKey = createPrivateKey(privateKeyValue);
    this.signerIdentity = signerIdentity;
    if (!signerIdentity) throw new TypeError("signerIdentity must not be empty");
    this.keyFingerprint = artifactPublicKeyFingerprint(this.privateKey);
  }

  sign(artifactId, data, { createdAt = Math.floor(Date.now() / 1000) } = {}) {
    const content = Buffer.from(data);
    const unsigned = new SignedArtifact({
      artifact_id: artifactId,
      content_hash: createHash("sha256").update(content).digest("hex"),
      signature: "",
      algorithm: "ed25519",
      signer_identity: this.signerIdentity,
      key_fingerprint: this.keyFingerprint,
      created_at: createdAt,
    });
    const signature = cryptoSign(null, Buffer.from(unsigned.canonicalPayload()), this.privateKey)
      .toString("base64");
    return new SignedArtifact({ ...unsigned.toWire(), signature });
  }
}

export function verifySignedArtifact(data, signedArtifactValue, policy, {
  now = Math.floor(Date.now() / 1000),
} = {}) {
  const artifact = signedArtifactValue instanceof SignedArtifact
    ? signedArtifactValue
    : SignedArtifact.fromWire(signedArtifactValue);
  if (!policy.allowedAlgorithms.has(artifact.algorithm)) {
    throw new ArtifactSignatureError(
      "Artifact signature algorithm is not allowlisted.",
      { code: "artifact_algorithm_unsupported" },
    );
  }
  const contentHash = createHash("sha256").update(Buffer.from(data)).digest("hex");
  if (contentHash !== artifact.contentHash) {
    throw new ArtifactSignatureError(
      "Artifact content does not match the signed SHA-256 digest.",
      { code: "artifact_integrity_mismatch" },
    );
  }
  const credential = policy.credentials.get(artifact.keyFingerprint);
  if (!credential) {
    throw new ArtifactSignatureError(
      "Artifact signer key is not trusted.",
      { code: "artifact_signer_untrusted" },
    );
  }
  if (artifact.signerIdentity !== credential.signerIdentity) {
    throw new ArtifactSignatureError(
      "Artifact signer identity does not match local key policy.",
      { code: "artifact_signer_mismatch" },
    );
  }
  if (credential.revoked) {
    throw new ArtifactSignatureError(
      "Artifact signer key is revoked.",
      { code: "artifact_signer_revoked" },
    );
  }
  if ((credential.validFrom && now < credential.validFrom)
    || (credential.validUntil && now > credential.validUntil)) {
    throw new ArtifactSignatureError(
      "Artifact signer credential is outside its validity window.",
      { code: "artifact_signer_expired" },
    );
  }
  if (artifact.createdAt > now + policy.maxFutureSkewSeconds
    || (credential.validFrom && artifact.createdAt < credential.validFrom)
    || (credential.validUntil && artifact.createdAt > credential.validUntil)) {
    throw new ArtifactSignatureError(
      "Artifact signature timestamp is outside the accepted window.",
      { code: "artifact_timestamp_invalid" },
    );
  }
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
    .test(artifact.signature)) {
    throw new ArtifactSignatureError(
      "Artifact signature is not valid base64.",
      { code: "artifact_signature_invalid" },
    );
  }
  const signature = Buffer.from(artifact.signature, "base64");
  if (signature.length !== 64 || !cryptoVerify(
    null,
    Buffer.from(artifact.canonicalPayload()),
    credential.publicKey,
    signature,
  )) {
    throw new ArtifactSignatureError(
      "Artifact signature verification failed.",
      { code: "artifact_signature_invalid" },
    );
  }
  return true;
}

export function authenticateTlsSocket(socket, policy) {
  if (!socket?.encrypted) {
    throw new AuthenticationError(
      "Secure network transport requires an authenticated TLS socket.",
      { code: "tls_required" },
    );
  }
  if (!socket.authorized) {
    throw new AuthenticationError(
      "TLS peer certificate was not authorized by the active trust store.",
      {
        code: "peer_certificate_untrusted",
        details: { authorization_error: socket.authorizationError || null },
      },
    );
  }
  if (socket.getProtocol() !== "TLSv1.3") {
    throw new AuthenticationError(
      "Authenticated transport did not negotiate TLS 1.3.",
      { code: "tls_version_mismatch", details: { negotiated_version: socket.getProtocol() } },
    );
  }
  const certificate = socket.getPeerCertificate(true);
  if (!certificate?.raw) {
    throw new AuthenticationError(
      "TLS peer did not present a certificate.",
      { code: "peer_certificate_missing" },
    );
  }
  const issuedAt = Math.floor(Date.parse(certificate.valid_from) / 1000);
  const expiresAt = Math.floor(Date.parse(certificate.valid_to) / 1000);
  const now = Date.now() / 1000;
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || now < issuedAt || now > expiresAt) {
    throw new AuthenticationError(
      "TLS peer certificate is outside its validity period.",
      { code: "credential_expired", details: { issued_at: issuedAt, expires_at: expiresAt } },
    );
  }
  const issuerName = canonicalIssuerName(certificate.issuer);
  if (policy.allowedIssuerNames.length > 0 && !policy.allowedIssuerNames.includes(issuerName)) {
    throw new AuthenticationError(
      "TLS peer certificate issuer is not allowed by local policy.",
      { code: "issuer_not_allowed", details: { issuer: issuerName } },
    );
  }
  const identityUris = parseSubjectAltName(certificate.subjectaltname)
    .filter(({ type }) => type === "URI")
    .map(({ value }) => value)
    .filter((value) => value.startsWith("spiffe://"));
  if (identityUris.length !== 1) {
    throw new AuthenticationError(
      "TLS peer certificate must contain exactly one HK-CSP identity URI SAN.",
      { code: "identity_san_invalid", details: { identity_uri_count: identityUris.length } },
    );
  }
  const parsed = parseIdentityUri(identityUris[0]);
  if (parsed.trustDomain !== policy.trustDomain) {
    throw new AuthenticationError(
      "TLS peer trust domain does not match local policy.",
      {
        code: "trust_domain_mismatch",
        details: { expected: policy.trustDomain, actual: parsed.trustDomain },
      },
    );
  }
  const expected = {
    peer_id: policy.expectedPeerId,
    node_id: policy.expectedNodeId,
    worker_id: policy.expectedWorkerId,
  };
  const actual = {
    peer_id: parsed.peerId,
    node_id: parsed.nodeId,
    worker_id: parsed.workerId,
  };
  const mismatches = Object.entries(expected)
    .filter(([name, value]) => value !== null && value !== actual[name])
    .map(([name]) => name);
  if (mismatches.length > 0) {
    throw new AuthenticationError(
      "Certificate identity does not match local peer expectations.",
      { code: "certificate_identity_mismatch", details: { fields: mismatches } },
    );
  }
  const fingerprint = normalizeFingerprint(certificate.fingerprint256);
  if (policy.revokedFingerprints.has(fingerprint)) {
    throw new AuthenticationError(
      "TLS peer credential is revoked by local policy.",
      { code: "credential_revoked", details: { credential_fingerprint: fingerprint } },
    );
  }
  const grants = policy.capabilitiesByFingerprint.get(fingerprint);
  if (!grants && policy.requireAuthorizedFingerprint) {
    throw new AuthenticationError(
      "TLS peer credential is not authorized by local policy.",
      { code: "credential_not_authorized", details: { credential_fingerprint: fingerprint } },
    );
  }
  return new PeerIdentity({
    peer_id: parsed.peerId,
    node_id: parsed.nodeId,
    worker_id: parsed.workerId,
    trust_domain: parsed.trustDomain,
    credential_fingerprint: fingerprint,
    capabilities: [...(grants || [])],
    issued_at: issuedAt,
    expires_at: expiresAt,
  });
}

function parseIdentityUri(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch (error) {
    throw new AuthenticationError(
      "TLS peer identity URI SAN has an invalid format.",
      { code: "identity_san_invalid" },
    );
  }
  const parts = parsed.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (
    parsed.protocol !== "spiffe:"
    || !parsed.hostname
    || ![4, 6].includes(parts.length)
    || parts[0] !== "peer"
    || parts[2] !== "node"
    || (parts.length === 6 && parts[4] !== "worker")
  ) {
    throw new AuthenticationError(
      "TLS peer identity URI SAN has an invalid format.",
      { code: "identity_san_invalid" },
    );
  }
  return {
    trustDomain: parsed.hostname,
    peerId: parts[1],
    nodeId: parts[3],
    workerId: parts.length === 6 ? parts[5] : null,
  };
}

function parseSubjectAltName(value = "") {
  return String(value).split(/,\s*/).map((entry) => {
    const separator = entry.indexOf(":");
    return separator < 0
      ? { type: "", value: entry }
      : { type: entry.slice(0, separator), value: entry.slice(separator + 1) };
  });
}

function canonicalIssuerName(issuer = {}) {
  if (typeof issuer === "string") return issuer;
  return Object.entries(issuer).map(([name, value]) => `${name}=${value}`).join(",");
}

export function detectHybridPqSupport() {
  try {
    tls.createSecureContext({
      minVersion: "TLSv1.3",
      maxVersion: "TLSv1.3",
      ecdhCurve: HYBRID_PQ_GROUP,
    });
    return true;
  } catch {
    return false;
  }
}

export function getSupportedNodeCryptoCapabilities() {
  let tls13Supported = false;
  try {
    tls.createSecureContext({ minVersion: "TLSv1.3", maxVersion: "TLSv1.3" });
    tls13Supported = true;
  } catch {
    tls13Supported = false;
  }
  const hybridPqSupported = tls13Supported && detectHybridPqSupport();
  const profilesSupported = [SecurityProfile.LOCAL];
  if (tls13Supported) profilesSupported.push(SecurityProfile.STANDARD);
  if (hybridPqSupported) profilesSupported.push(SecurityProfile.HYBRID_PQ);
  return {
    runtime: "node",
    contracts_only: false,
    provider: `OpenSSL ${process.versions.openssl || "unknown"}`,
    tls13_supported: tls13Supported,
    profiles_supported: profilesSupported,
    profiles_recognized: Object.values(SecurityProfile),
    digest_algorithms: ["sha256"],
    signature_algorithms: ["ed25519"],
    hybrid_pq_group: hybridPqSupported ? HYBRID_PQ_GROUP : null,
    hybrid_pq_supported: hybridPqSupported,
  };
}

export function buildTlsOptions(securityConfig, isServer = false, { servername } = {}) {
  if (!securityConfig || securityConfig.profile === SecurityProfile.LOCAL) {
    return null;
  }

  const capabilities = getSupportedNodeCryptoCapabilities();
  if (!capabilities.profiles_supported.includes(securityConfig.profile)) {
    throw new SecurityProfileUnavailableError(
      `Security profile '${securityConfig.profile}' is unavailable in the active Node TLS provider.`,
      {
        profile: securityConfig.profile,
        provider: capabilities.provider,
        required_group: securityConfig.profile === SecurityProfile.HYBRID_PQ
          ? HYBRID_PQ_GROUP
          : null,
      },
    );
  }

  const options = {
    minVersion: "TLSv1.3",
    maxVersion: "TLSv1.3",
  };

  if (securityConfig.profile === SecurityProfile.HYBRID_PQ) {
    options.ecdhCurve = HYBRID_PQ_GROUP;
  }

  const keyStore = new FileKeyStore({
    caCertPath: securityConfig.caCertPath,
    certPath: securityConfig.certPath,
    keyPath: securityConfig.keyPath,
  });

  let ca;
  let cert;
  let key;
  try {
    ca = keyStore.getCaCertificate();
    cert = keyStore.getCertificate();
    key = keyStore.getPrivateKey();
  } finally {
    keyStore.close();
  }

  if (ca) options.ca = [ca];
  if (cert) options.cert = cert;
  if (key) options.key = key;

  if (Boolean(cert) !== Boolean(key)) {
    throw new Error("certPath and keyPath must be configured together.");
  }
  if (isServer && (!cert || !key)) {
    throw new Error("TLS server requires certPath and keyPath.");
  }

  if (securityConfig.requireMtls) {
    if (isServer) {
      options.requestCert = true;
      options.rejectUnauthorized = true;
      if (!ca) {
        throw new Error("requireMtls=true on server requires caCertPath.");
      }
    } else {
      if (!cert || !key) {
        throw new Error("requireMtls=true on client requires certPath and keyPath.");
      }
    }
  }

  if (!isServer) {
    options.rejectUnauthorized = true;
    if (servername) options.servername = servername;
  }

  return options;
}
