export const HANDOFFKIT_BROWSER_CORE_VERSION: "1.20.0-alpha.1";
export const CONTRACT_VERSION: "1.20.0-alpha.1";
export const CONTRACT_FORMAT: "handoffkit.browser.core";
export const ERROR_CODES: readonly string[];
export const PRODUCTS: readonly string[];
export const SESSION_STATUSES: readonly string[];
export const CLAIM_STATUSES: readonly string[];
export const RESEARCH_STAGES: readonly string[];
export const COMMAND_NAMES: readonly string[];
export const EVENT_NAMES: readonly string[];
export const PLATFORM_SEARCH_PROVIDERS: readonly string[];
export const PROVIDER_ALIASES: Readonly<Record<string, string>>;
export const SENSITIVE_KEY_RE: RegExp;

export class BrowserCoreError extends Error {
  code: string;
  details: Record<string, unknown>;
  constructor(message: string, init?: { code?: string; details?: Record<string, unknown> });
}

export function asText(value: unknown, fallback?: string): string;
export function asBool(value: unknown, fallback?: boolean): boolean;
export function asInt(value: unknown, fallback?: number): number;
export function asObject(value: unknown): Record<string, unknown>;
export function asStringArray(value: unknown): string[];
export function requireErrorCode(code: unknown): string;
export function requireOneOf(value: unknown, allowed: readonly string[], field: string): string;
export function normalizeProviderName(raw: unknown): string;
export function isSha256Hex(value: unknown): boolean;
export function requireRfc3339(value: unknown, field: string): string;
export function redactSensitive(value: unknown, depth?: number): unknown;

export class BrowserError {
  contractVersion: string;
  code: string;
  message: string;
  retryable: boolean;
  details: Record<string, unknown>;
  requestId: string;
  commandId: string;
  sessionId: string;
  occurredAt: string;
  constructor(init?: Record<string, unknown>);
  toWire(): Record<string, unknown>;
  static fromWire(data?: Record<string, unknown>): BrowserError;
}

export class BrowserCapabilities {
  constructor(init?: Record<string, unknown>);
  toWire(): Record<string, unknown>;
  static fromWire(data?: Record<string, unknown>): BrowserCapabilities;
}

export class BrowserPolicy {
  constructor(init?: Record<string, unknown>);
  toWire(): Record<string, unknown>;
  static fromWire(data?: Record<string, unknown>): BrowserPolicy;
  rejectPublicBind(host: string): true;
  assertNetworkUrl(url: string): true;
  assertFilesystem(operation: "read" | "write" | "download" | string): true;
  restrictWith(peerPolicy?: Record<string, unknown> | BrowserPolicy): BrowserPolicy;
}

export function classifyNetworkTarget(url: string): {
  kind: "invalid" | "local" | "filesystem" | "loopback" | "private" | "public" | string;
  scheme: string;
  host: string;
};

export class BrowserSessionRequest {
  constructor(init?: Record<string, unknown>);
  toWire(): Record<string, unknown>;
  static fromWire(data?: Record<string, unknown>): BrowserSessionRequest;
}

export class BrowserSessionState {
  constructor(init?: Record<string, unknown>);
  toWire(): Record<string, unknown>;
  static fromWire(data?: Record<string, unknown>): BrowserSessionState;
}

export class BrowserCommand {
  constructor(init?: Record<string, unknown>);
  toWire(): Record<string, unknown>;
  static fromWire(data?: Record<string, unknown>): BrowserCommand;
}

export class BrowserEvent {
  constructor(init?: Record<string, unknown>);
  toWire(): Record<string, unknown>;
  static fromWire(data?: Record<string, unknown>): BrowserEvent;
}

export class SearchHit {
  constructor(init?: Record<string, unknown>);
  toWire(): Record<string, unknown>;
  static fromWire(data?: Record<string, unknown>): SearchHit;
}

export class SearchRequest {
  constructor(init?: Record<string, unknown>);
  toWire(): Record<string, unknown>;
  static fromWire(data?: Record<string, unknown>): SearchRequest;
}

export class SearchResult {
  constructor(init?: Record<string, unknown>);
  toWire(): Record<string, unknown>;
  static fromWire(data?: Record<string, unknown>): SearchResult;
}

export class ProviderTrace {
  constructor(init?: Record<string, unknown>);
  toWire(): Record<string, unknown>;
  static fromWire(data?: Record<string, unknown>): ProviderTrace;
}

export class PageSnapshot {
  constructor(init?: Record<string, unknown>);
  toWire(): Record<string, unknown>;
  static fromWire(data?: Record<string, unknown>): PageSnapshot;
}

export class DocumentRecord {
  constructor(init?: Record<string, unknown>);
  toWire(): Record<string, unknown>;
  static fromWire(data?: Record<string, unknown>): DocumentRecord;
}

export class ResearchClaim {
  constructor(init?: Record<string, unknown>);
  toWire(): Record<string, unknown>;
  static fromWire(data?: Record<string, unknown>): ResearchClaim;
}

export class ResearchJob {
  constructor(init?: Record<string, unknown>);
  toWire(): Record<string, unknown>;
  static fromWire(data?: Record<string, unknown>): ResearchJob;
}

export class ResearchProgress {
  constructor(init?: Record<string, unknown>);
  toWire(): Record<string, unknown>;
  static fromWire(data?: Record<string, unknown>): ResearchProgress;
}

export class ResearchResult {
  constructor(init?: Record<string, unknown>);
  toWire(): Record<string, unknown>;
  static fromWire(data?: Record<string, unknown>): ResearchResult;
}

export const CORE_MODELS: Record<string, { fromWire(data?: Record<string, unknown>): { toWire(): Record<string, unknown> } }>;
export function parseCoreModel(name: string, data: Record<string, unknown>): { toWire(): Record<string, unknown> };
