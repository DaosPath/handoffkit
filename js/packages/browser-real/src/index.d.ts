export const HANDOFFKIT_BROWSER_CORE_VERSION: string;
export const HANDOFFKIT_BROWSER_REAL_VERSION: "1.20.0-alpha.1";
export const CONFIG_ENV: "HANDOFFKIT_BROWSER_REAL_CONFIG";
export const BROWSER_CONTROL_CHANNEL: "browser.control";
export const BROWSER_CONTROL_OPERATION: "browser:control";
export function wrapCommandEnvelope(input: Record<string, unknown>): Record<string, unknown>;
export function wrapEventEnvelope(input: Record<string, unknown>): Record<string, unknown>;
export function isDefaultUserProfile(profileDir: string): boolean;
export function detectChallenge(text: string): boolean;
export function loadBrowserRealConfig(source?: string): Record<string, unknown>;
export function parseGoogleOrganicResults(html: string, maxResults?: number): Array<{
  title: string;
  url: string;
  snippet: string;
  provider: "google_browser";
}>;
export function createGoogleBrowserSearch(client: BrowserRealClient): (query: string, options?: Record<string, unknown>) => Promise<Record<string, unknown>>;
export class BrowserRealService {
  constructor(options?: Record<string, unknown>);
  capabilities: { engineReady?: boolean; toWire(): Record<string, unknown> };
  dispatch(command: Record<string, unknown>): Promise<Record<string, unknown>>;
}
export class BrowserRealClient {
  constructor(target: {
    dispatch?(command: Record<string, unknown>): Promise<unknown>;
    send?(value: unknown): Promise<void>;
    receive?(): Promise<{ payload?: Record<string, unknown> }>;
    destroy?(error?: Error | null): void;
    close?(options?: { force?: boolean }): Promise<void>;
    authenticatedPeer?: { peerId?: string; credentialFingerprint?: string } | null;
  }, options?: {
    identity?: { fingerprint?: string; peerId?: string };
    sequences?: { next: () => number };
  });
  transport: unknown;
  lastRequestMessageId: string;
  lastResponseCorrelationId: string;
  readonly authenticatedPeer: { peerId?: string; credentialFingerprint?: string } | null;
  dispatch(command: Record<string, unknown>): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}
export function connectBrowserRealTls(options: {
  host: string;
  port: number;
  networkConfig: unknown;
  identity?: { fingerprint?: string };
  sequences?: { next: () => number };
}): Promise<BrowserRealClient>;
export function startBrowserRealService(options?: Record<string, unknown>): Promise<{
  service: BrowserRealService;
  address: unknown;
  readonly capabilities: { engineReady?: boolean; toWire(): Record<string, unknown> };
  readonly firstError: {
    where: string;
    code: string;
    message: string;
    details: Record<string, unknown>;
    at: string;
  } | null;
  close(): Promise<void>;
}>;
