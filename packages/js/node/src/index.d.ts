export * from "@handoffkit/core";
import { ContextDocument, MemoryStore, RunTrace } from "@handoffkit/core";
import {
  CapabilityPolicy,
  CertificateIdentityPolicy,
  MessageEnvelope,
  PeerIdentity,
  ReplayProtection,
  SignedArtifact,
  Transport,
} from "@handoffkit/csp";
import { ChildProcessWithoutNullStreams } from "node:child_process";
import { KeyObject } from "node:crypto";
import { Readable, Writable } from "node:stream";

export class FileTraceStore {
  root: string;
  constructor(init?: { root?: string });
  save(trace: RunTrace | Record<string, unknown>, name?: string): Promise<string>;
  load(nameOrPath: string): Promise<RunTrace>;
  list(): Promise<string[]>;
}

export function writeReportFiles(
  report: { toJSON?: () => unknown; toMarkdown?: () => string } | unknown,
  name: string,
  outputDir?: string,
): Promise<{ jsonPath: string; markdownPath: string }>;

export function loadReportJSON(path: string): Promise<unknown>;

export function readContractInventory(contractsRoot: string): Promise<{
  fixtures: string[];
  schemas: string[];
}>;

export function buildNodeContractParityReport(init?: {
  runtime?: string;
  version?: string;
  contractsRoot?: string;
  expectedFixtures?: string[];
  expectedSchemas?: string[];
}): Promise<import("@handoffkit/core").ContractParityReport>;

export class ProjectIndexer {
  root: string;
  allowedExtensions: Set<string>;
  maxFileSize: number;
  maxFiles: number;
  constructor(init?: {
    root?: string;
    allowedExtensions?: string[];
    maxFileSize?: number;
    maxFiles?: number;
  });
  index(): ContextDocument[];
}

export class JsonMemoryStore extends MemoryStore {
  filePath: string;
  constructor(filePath: string);
}

export class NodeStdioTransport extends Transport {
  readable: Readable;
  writable: Writable;
  maxMessageBytes: number;
  constructor(init: { readable: Readable; writable: Writable; maxMessageBytes?: number });
  send(envelope: MessageEnvelope | Record<string, unknown>): Promise<void>;
  receive(): Promise<MessageEnvelope>;
  close(): Promise<void>;
}

export class SubprocessStdioTransport extends NodeStdioTransport {
  child: ChildProcessWithoutNullStreams;
  stderr: Readable;
  constructor(child: ChildProcessWithoutNullStreams, options?: { maxMessageBytes?: number });
  static spawn(
    argv: string[],
    options?: { cwd?: string; env?: NodeJS.ProcessEnv; maxMessageBytes?: number },
  ): SubprocessStdioTransport;
}

export class FileDedupStore {
  constructor(filePath: string, options?: { capacity?: number; maxLogBytes?: number });
  claim(key: string): boolean;
  release(key: string): boolean;
  contains(key: string): boolean;
  readonly size: number;
}

export class NetworkConfig {
  securityConfig: import("@handoffkit/csp").SecurityConfig;
  identityPolicy: CertificateIdentityPolicy | null;
  capabilityPolicy: CapabilityPolicy | null;
  replayProtection: ReplayProtection;
  constructor(init?: {
    maxMessageBytes?: number;
    connectTimeoutMs?: number;
    ioTimeoutMs?: number;
    maxAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    securityConfig?: import("@handoffkit/csp").SecurityConfig | Record<string, unknown>;
    identityPolicy?: CertificateIdentityPolicy | Record<string, unknown> | null;
    capabilityPolicy?: CapabilityPolicy | Record<string, unknown> | null;
    replayProtection?: ReplayProtection | Record<string, unknown>;
  });
}
export class LengthDelimitedTransport extends Transport {
  authenticatedPeer: PeerIdentity | null;
  constructor(socket: import("node:net").Socket, options?: { config?: NetworkConfig });
  close(): Promise<void>;
}
export class TcpTransport extends LengthDelimitedTransport {
  static connect(host: string, port: number, options?: {
    config?: NetworkConfig;
    servername?: string;
    /** Accepted only for the local profile; secure profiles reject overrides. */
    tlsOptions?: import("node:tls").ConnectionOptions;
  }): Promise<TcpTransport>;
  static startServer(
    callback: (transport: TcpTransport) => void | Promise<void>,
    host: string,
    port: number,
    options?: {
      config?: NetworkConfig;
      /** Accepted only for the local profile; secure profiles reject overrides. */
      tlsOptions?: import("node:tls").TlsOptions;
    },
  ): Promise<import("node:net").Server>;
  static connectWithRetry(host: string, port: number, options?: { config?: NetworkConfig }): Promise<TcpTransport>;
}
export class UnixSocketTransport extends LengthDelimitedTransport {
  static connect(path: string, options?: { config?: NetworkConfig }): Promise<UnixSocketTransport>;
}

export const HYBRID_PQ_GROUP: "X25519MLKEM768";
export class FileKeyStore {
  caCertPath: string | null;
  certPath: string | null;
  keyPath: string | null;
  closed: boolean;
  constructor(init?: { caCertPath?: string; certPath?: string; keyPath?: string });
  getCaCertificate(): string | null;
  getCertificate(): string | null;
  getPrivateKey(): string | null;
  close(): void;
}
export function detectHybridPqSupport(): boolean;
export function getSupportedNodeCryptoCapabilities(): {
  runtime: "node";
  contracts_only: false;
  provider: string;
  tls13_supported: boolean;
  profiles_supported: import("@handoffkit/csp").SecurityProfileValue[];
  profiles_recognized: import("@handoffkit/csp").SecurityProfileValue[];
  digest_algorithms: string[];
  signature_algorithms: string[];
  hybrid_pq_group: string | null;
  hybrid_pq_supported: boolean;
};
export function buildTlsOptions(
  securityConfig: import("@handoffkit/csp").SecurityConfig,
  isServer?: boolean,
  options?: { servername?: string },
): import("node:tls").ConnectionOptions & import("node:tls").TlsOptions;

export function certificateFingerprint(certificate: string | Buffer): string;
export function artifactPublicKeyFingerprint(key: string | Buffer | KeyObject): string;

export class ArtifactSigningCredential {
  signerIdentity: string;
  publicKey: KeyObject;
  validFrom: number;
  validUntil: number;
  revoked: boolean;
  fingerprint: string;
  constructor(init: {
    signerIdentity?: string;
    signer_identity?: string;
    publicKey?: string | Buffer | KeyObject;
    public_key?: string | Buffer | KeyObject;
    validFrom?: number;
    valid_from?: number;
    validUntil?: number;
    valid_until?: number;
    revoked?: boolean;
  });
}

export class ArtifactTrustPolicy {
  credentials: Map<string, ArtifactSigningCredential>;
  allowedAlgorithms: Set<string>;
  maxFutureSkewSeconds: number;
  constructor(
    credentials?: Array<ArtifactSigningCredential | ConstructorParameters<typeof ArtifactSigningCredential>[0]>,
    options?: { allowedAlgorithms?: string[]; maxFutureSkewSeconds?: number },
  );
}

export class ArtifactSigner {
  privateKey: KeyObject;
  signerIdentity: string;
  keyFingerprint: string;
  constructor(privateKey: string | Buffer | KeyObject, signerIdentity: string);
  sign(
    artifactId: string,
    data: Uint8Array,
    options?: { createdAt?: number },
  ): SignedArtifact;
}

export function verifySignedArtifact(
  data: Uint8Array,
  signedArtifact: SignedArtifact | Record<string, unknown>,
  policy: ArtifactTrustPolicy,
  options?: { now?: number },
): boolean;
