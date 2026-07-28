export const HK_CSP_VERSION: "1.0";
export const HANDOFFKIT_CSP_VERSION: string;
export const DEFAULT_CHANNEL_CAPACITY: number;
export const DEFAULT_MAX_MESSAGE_BYTES: number;

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
}

export class ArtifactRef { constructor(value?: Record<string, unknown>); toWire(): Record<string, unknown>; toJSON(): Record<string, unknown>; }
export class WorkerCapabilities extends ArtifactRef {}
export class TrainingJob extends ArtifactRef {}
export class EvaluationJob extends ArtifactRef {}
export class JobProgress extends ArtifactRef {}

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
  constructor(config: SessionConfig | ConstructorParameters<typeof SessionConfig>[0]);
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
  constructor(init?: { mode?: RuntimeModeValue });
  createSession(init?: { sessionId?: string; config?: SessionConfig }): CspSession;
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
