export const HK_CSP_VERSION: "1.0";
export const HANDOFFKIT_CSP_VERSION: string;
export const DEFAULT_CHANNEL_CAPACITY: number;
export const DEFAULT_MAX_MESSAGE_BYTES: number;
export const DEFAULT_MAX_NESTING_DEPTH: number;
export const MIN_MESSAGE_BYTES: number;
export const MAX_ERROR_MESSAGE_BYTES: number;
export const MAX_RETRY_ATTEMPTS: number;
export function validateTimestamp(value: string, fieldName?: string): number;
export function jsonDepth(value: unknown): number;
export function sanitizeErrorMessage(message: unknown): string;
export function validationErrorCode(error: unknown): string;

export const RuntimeMode: Readonly<{ CLASSIC: "classic"; SESSION: "session"; DISTRIBUTED: "distributed" }>;
export const OverflowPolicy: Readonly<{ BLOCK: "block"; REJECT: "reject" }>;
export type RuntimeModeValue = typeof RuntimeMode[keyof typeof RuntimeMode];
export type OverflowPolicyValue = typeof OverflowPolicy[keyof typeof OverflowPolicy];

export class CspError extends Error {}
export class ChannelClosedError extends CspError {}
export class BackpressureError extends CspError {}
export class DeadlineExceededError extends CspError {}
export class MessageTooLargeError extends CspError {}
export class DistributedRuntimeUnavailableError extends CspError {}
export class ProtocolVersionError extends CspError {}

export class Transport {
  send(envelope: MessageEnvelope): Promise<void>;
  receive(): Promise<MessageEnvelope>;
  close(): Promise<void>;
}

export class RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  constructor(init?: { maxAttempts?: number; baseDelayMs?: number; maxDelayMs?: number });
  toWire(): { max_attempts: number; base_delay_ms: number; max_delay_ms: number };
  static fromWire(value?: Record<string, unknown>): RetryPolicy;
}

export class SessionConfig {
  sessionId: string;
  runtimeMode: RuntimeModeValue;
  channelCapacity: number;
  maxMessageBytes: number;
  ackTimeoutMs: number;
  dedupCapacity: number;
  retryPolicy: RetryPolicy;
  deadline: string | null;
  metadata: Record<string, unknown>;
  constructor(init: {
    sessionId: string;
    runtimeMode?: RuntimeModeValue;
    channelCapacity?: number;
    maxMessageBytes?: number;
    ackTimeoutMs?: number;
    dedupCapacity?: number;
    retryPolicy?: RetryPolicy | Record<string, unknown>;
    deadline?: string | null;
    metadata?: Record<string, unknown>;
  });
  toWire(): Record<string, unknown>;
  static fromWire(value: Record<string, unknown>): SessionConfig;
}

export class ChannelConfig {
  name: string;
  capacity: number;
  overflowPolicy: OverflowPolicyValue;
  requiresAck: boolean;
  metadata: Record<string, unknown>;
  constructor(init: { name: string; capacity?: number; overflowPolicy?: OverflowPolicyValue; requiresAck?: boolean; metadata?: Record<string, unknown> });
  toWire(): Record<string, unknown>;
  static fromWire(value: Record<string, unknown>): ChannelConfig;
}

export interface MessageEnvelopeInit<T = unknown> {
  messageId: string;
  sessionId: string;
  channel: string;
  kind: string;
  source: string;
  sequence: number;
  payloadType: string;
  payload: T;
  protocolVersion?: string;
  target?: string | null;
  createdAt?: string;
  deadline?: string | null;
  correlationId?: string | null;
  causationId?: string | null;
  idempotencyKey?: string | null;
  attempt?: number;
  requiresAck?: boolean;
  metadata?: Record<string, unknown>;
}

export class MessageEnvelope<T = unknown> implements MessageEnvelopeInit<T> {
  messageId: string;
  sessionId: string;
  channel: string;
  kind: string;
  source: string;
  sequence: number;
  payloadType: string;
  payload: T;
  protocolVersion: string;
  target: string | null;
  createdAt: string;
  deadline: string | null;
  correlationId: string | null;
  causationId: string | null;
  idempotencyKey: string | null;
  attempt: number;
  requiresAck: boolean;
  metadata: Record<string, unknown>;
  constructor(init: MessageEnvelopeInit<T>);
  toWire(): Record<string, unknown>;
  toJSON(): Record<string, unknown>;
  toJSONString(space?: number): string;
  encodedSize(): number;
  validateWithLimits(options?: { maxMessageBytes?: number; maxNestingDepth?: number }): this;
  nextAttempt(): MessageEnvelope<T>;
  static fromWire<T = unknown>(value: Record<string, unknown>): MessageEnvelope<T>;
  static fromJSON<T = unknown>(value: string | Record<string, unknown>): MessageEnvelope<T>;
}

export class DeliveryAck {
  messageId: string;
  processedAt: string;
  metadata: Record<string, unknown>;
  constructor(init: { messageId: string; processedAt?: string; metadata?: Record<string, unknown> });
  toWire(): Record<string, unknown>;
}

export class DeliveryNack {
  messageId: string;
  code: string;
  message: string;
  retryable: boolean;
  processedAt: string;
  metadata: Record<string, unknown>;
  constructor(init: { messageId: string; code: string; message: string; retryable?: boolean; processedAt?: string; metadata?: Record<string, unknown> });
  toWire(): Record<string, unknown>;
}

export class ProcessError {
  constructor(init: Record<string, unknown>);
  toWire(): Record<string, unknown>;
  sanitized(): ProcessError;
}

export class ArtifactRef { constructor(value?: Record<string, unknown>); toWire(): Record<string, unknown>; toJSON(): Record<string, unknown>; }
export class WorkerCapabilities extends ArtifactRef {}
export class TrainingJob extends ArtifactRef {}
export class EvaluationJob extends ArtifactRef {}
export class JobProgress extends ArtifactRef {}
export class WorkerHeartbeat extends ArtifactRef {}
export class DistributedJob extends ArtifactRef {}
export class JobAssignment extends ArtifactRef {}

export interface DedupStore {
  claim(key: string): boolean;
  release(key: string): boolean;
  contains(key: string): boolean;
}

export class CspChannel<T = unknown> {
  config: ChannelConfig;
  readonly name: string;
  readonly size: number;
  closed: boolean;
  constructor(config: ChannelConfig | ConstructorParameters<typeof ChannelConfig>[0], options?: { maxMessageBytes?: number });
  send(envelope: MessageEnvelope<T> | Record<string, unknown>): Promise<void>;
  receive(): Promise<MessageEnvelope<T>>;
  tryReceive(): MessageEnvelope<T> | null;
  close(): void;
}

export function select(channels: Iterable<CspChannel>): Promise<[CspChannel, MessageEnvelope]>;

export class ProcessHandle {
  processId: string;
  readonly done: boolean;
  cancel(): void;
  wait(): Promise<unknown>;
}

export class ProcessContext {
  processId: string;
  signal: AbortSignal;
  readonly cancelled: boolean;
  waitCancelled(): Promise<void>;
  send(channel: string, envelope: MessageEnvelope): Promise<void>;
  receive(channel: string): Promise<MessageEnvelope>;
  select(channels: Iterable<string>): Promise<[string, MessageEnvelope]>;
  ack(envelope: MessageEnvelope, metadata?: Record<string, unknown>): DeliveryAck;
  nack(envelope: MessageEnvelope, options: { code: string; message: string; retryable?: boolean; metadata?: Record<string, unknown> }): DeliveryNack;
}

export class CspSession {
  config: SessionConfig;
  readonly sessionId: string;
  cancelled: boolean;
  closed: boolean;
  constructor(config: SessionConfig | ConstructorParameters<typeof SessionConfig>[0], options?: { dedupStore?: DedupStore | null });
  diagnostics(): Record<string, number | string | boolean>;
  channel(name: string, options?: { capacity?: number; requiresAck?: boolean }): CspChannel;
  send(channel: string, envelope: MessageEnvelope): Promise<void>;
  receive(channel: string): Promise<MessageEnvelope>;
  select(names: Iterable<string>): Promise<[string, MessageEnvelope]>;
  spawn(processId: string, handler: (context: ProcessContext) => unknown | Promise<unknown>): ProcessHandle;
  ack(envelope: MessageEnvelope, metadata?: Record<string, unknown>): DeliveryAck;
  nack(envelope: MessageEnvelope, options: { code: string; message: string; retryable?: boolean; metadata?: Record<string, unknown> }): DeliveryNack;
  sendWithAck(channel: string, envelope: MessageEnvelope): Promise<DeliveryAck>;
  wait(): Promise<unknown[]>;
  cancel(): void;
  close(): Promise<void>;
}

export class CspRuntime {
  mode: RuntimeModeValue;
  constructor(init?: { mode?: RuntimeModeValue; dedupStore?: DedupStore | null });
  createSession(init?: { sessionId?: string; config?: SessionConfig; dedupStore?: DedupStore | null }): CspSession;
  makeEnvelope<T = unknown>(init: MakeEnvelopeInit<T>): MessageEnvelope<T>;
}

export interface MakeEnvelopeInit<T = unknown> {
  sessionId: string;
  channel: string;
  source: string;
  payloadType: string;
  payload: T;
  sequence: number;
  target?: string | null;
  kind?: string;
  requiresAck?: boolean;
  idempotencyKey?: string | null;
}

export function makeEnvelope<T = unknown>(init: MakeEnvelopeInit<T>): MessageEnvelope<T>;

export class WebSocketTransport extends Transport {
  constructor(socket: WebSocket, options?: { maxMessageBytes?: number });
}

export const WorkerStatus: Readonly<{ ONLINE: "online"; SUSPECT: "suspect"; OFFLINE: "offline" }>;
export class WorkerRecord { readonly workerId: string; constructor(init: Record<string, unknown>); }
export class WorkerRegistry {
  constructor(init?: { suspectAfterMs?: number; offlineAfterMs?: number; clock?: () => number });
  register(capabilities: WorkerCapabilities | Record<string, unknown>): WorkerRecord;
  heartbeat(heartbeat: WorkerHeartbeat | Record<string, unknown>): boolean;
  markDisconnected(workerId: string): void;
  expire(): string[];
  reserve(requiredCapabilities?: string[]): WorkerRecord | null;
  release(workerId: string): void;
  get(workerId: string): WorkerRecord | null;
  list(): WorkerRecord[];
}
export class DistributedScheduler {
  constructor(registry: WorkerRegistry, init?: { maxAttempts?: number; leaseMs?: number; queueCapacity?: number; dedupCapacity?: number });
  submit(job: DistributedJob | Record<string, unknown>): boolean;
  schedule(): JobAssignment | null;
  complete(assignmentId: string): boolean;
  fail(assignmentId: string, init?: { retryable?: boolean }): boolean;
  recoverWorker(workerId: string): number;
  recoverExpired(init?: { now?: number }): number;
  snapshot(): { queued: number; assigned: number; completed: number; failed: number; seen_jobs: number };
}
export function heartbeatNow(workerId: string, init: { sequence: number; activeJobs: number; load: number; metadata?: Record<string, unknown> }): WorkerHeartbeat;

export const SecurityProfile: Readonly<{
  LOCAL: "local";
  STANDARD: "standard";
  HYBRID_PQ: "hybrid-pq";
  RESEARCH: "research";
}>;
export type SecurityProfileValue = typeof SecurityProfile[keyof typeof SecurityProfile];

export interface StructuredSecurityError {
  code: string;
  message: string;
  details: Record<string, unknown>;
}

export class SecurityError extends CspError {
  code: string;
  details: Record<string, unknown>;
  constructor(message: string, init?: { code?: string; details?: Record<string, unknown> });
  toWire(): StructuredSecurityError;
}

export class SecurityProfileUnavailableError extends SecurityError {
  constructor(message: string, details?: Record<string, unknown>);
}
export class SecurityProfileMismatchError extends SecurityError {
  constructor(message: string, details?: Record<string, unknown>);
}
export class AuthenticationError extends SecurityError {
  constructor(message: string, init?: { code?: string; details?: Record<string, unknown> });
}
export class AuthorizationError extends SecurityError {
  constructor(message: string, init?: { code?: string; details?: Record<string, unknown> });
}
export class ReplayDetectedError extends SecurityError {
  constructor(message: string, details?: Record<string, unknown>);
}
export class ArtifactSignatureError extends SecurityError {
  constructor(message: string, init?: { code?: string; details?: Record<string, unknown> });
}

export class SecurityConfig {
  profile: SecurityProfileValue;
  requireMtls: boolean;
  allowInsecureLoopback: boolean;
  trustDomain: string;
  caCertPath: string | null;
  certPath: string | null;
  keyPath: string | null;
  replayWindowSeconds: number;
  maxClockSkewSeconds: number;
  constructor(init?: Record<string, unknown>);
  toWire(): Record<string, unknown>;
  static fromWire(value?: Record<string, unknown>): SecurityConfig;
  validateListenAddress(host: string): void;
}

export class PeerIdentity {
  peerId: string;
  nodeId: string;
  workerId: string | null;
  trustDomain: string;
  credentialFingerprint: string;
  capabilities: string[];
  issuedAt: number;
  expiresAt: number;
  constructor(init?: Record<string, unknown>);
  isValidAt(timestampSeconds?: number): boolean;
  toWire(): Record<string, unknown>;
  static fromWire(value?: Record<string, unknown>): PeerIdentity;
}

export interface SignedArtifactWire {
  artifact_id: string;
  content_hash: string;
  signature: string;
  algorithm: "ed25519";
  signer_identity: string;
  key_fingerprint: string;
  created_at: number;
}

export class SignedArtifact {
  artifactId: string;
  contentHash: string;
  signature: string;
  algorithm: "ed25519";
  signerIdentity: string;
  keyFingerprint: string;
  createdAt: number;
  constructor(init: Record<string, unknown>);
  toWire(): SignedArtifactWire;
  canonicalPayload(): Uint8Array;
  static fromWire(value: Record<string, unknown>): SignedArtifact;
}

export class CertificateIdentityPolicy {
  trustDomain: string;
  capabilitiesByFingerprint: Map<string, readonly string[]>;
  revokedFingerprints: Set<string>;
  expectedPeerId: string | null;
  expectedNodeId: string | null;
  expectedWorkerId: string | null;
  allowedIssuerNames: readonly string[];
  requireAuthorizedFingerprint: boolean;
  constructor(init?: Record<string, unknown>);
}

export function normalizeFingerprint(value: string): string;
export function validateDeclaredPeerIdentity(
  authenticated: PeerIdentity,
  declared: PeerIdentity | Record<string, unknown>,
): void;

export class CapabilityPolicy {
  constructor(init?: { allowedOperations?: string[] });
  isOperationAuthorized(operation: string, peer?: PeerIdentity | null): boolean;
  authorizeJob(jobType: string, peer: PeerIdentity): void;
}

export class ReplayProtection {
  constructor(init?: { windowSeconds?: number; maxSkewSeconds?: number; maxSeenNonces?: number });
  checkAndRecord(sessionId: string, sequence: number, nonce?: string | null, createdAtTs?: number | null): void;
  pruneOldNonces(now?: number): void;
}

export interface CryptoCapabilities {
  runtime: string;
  contracts_only: boolean;
  tls13_supported: boolean;
  profiles_supported: SecurityProfileValue[];
  profiles_recognized: SecurityProfileValue[];
  digest_algorithms: string[];
  signature_algorithms: string[];
  hybrid_pq_group: string | null;
  hybrid_pq_supported: boolean;
}

export function getSupportedCryptoCapabilities(): CryptoCapabilities;
export function negotiateSecurityProfile(
  required: SecurityProfileValue,
  offered: SecurityProfileValue,
  supportedProfiles: SecurityProfileValue[],
): SecurityProfileValue;
export function assertSecurityProfileSupported(
  profile: SecurityProfileValue,
  capabilities?: CryptoCapabilities,
): void;
