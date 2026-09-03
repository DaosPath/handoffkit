import type { Tool, ToolRegistry } from "@handoffkit/core";

export declare const HANDOFFKIT_BROWSER_VERSION: string;

export interface ExtractedLink {
  href: string;
  absolute: string;
  text: string;
}

export declare class ExplorePolicy {
  maxDepth: number;
  maxPages: number;
  timeoutMs: number;
  maxBodyBytes: number;
  maxTextChars: number;
  maxLinksPerPage: number;
  sameHostOnly: boolean;
  followRedirects: boolean;
  maxRedirects: number;
  userAgent: string;
  allowHosts: string[];
  denyHosts: string[];
  extraHeaders: Record<string, string>;
  extractText: boolean;
  extractLinks: boolean;
  extractTitle: boolean;
  stripScriptsStyles: boolean;
  emitMarkdown: boolean;
  maxMarkdownChars: number;
  constructor(init?: Record<string, unknown>);
  toDict(): Record<string, unknown>;
  static fromDict(data?: Record<string, unknown>): ExplorePolicy;
}

export declare function parseUrl(url: string): {
  scheme: string;
  host: string;
  path: string;
  query: string;
  valid: boolean;
};
export declare function resolveUrl(base: string, href: string): string;
export declare function normalizeHost(host: string): string;
export declare function hostAllowed(host: string, policy: ExplorePolicy | Record<string, unknown>): boolean;
export declare function urlAllowed(
  url: string,
  policy: ExplorePolicy | Record<string, unknown>,
  originHost?: string,
): boolean;
export declare function policyFromArgs(args?: Record<string, unknown>): ExplorePolicy;
export declare function resultToDict(result: ExploreResult): Record<string, unknown>;
export declare function linkToDict(link: ExtractedLink): Record<string, unknown>;
export declare function stepToDict(step: ExploreStep): Record<string, unknown>;

export declare class TransportRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  timeoutMs: number;
  maxBodyBytes: number;
  followRedirects: boolean;
  maxRedirects: number;
  constructor(init?: Record<string, unknown>);
}

export declare class TransportResponse {
  status: number;
  finalUrl: string;
  contentType: string;
  body: string;
  headers: Record<string, string>;
  error: string;
  constructor(init?: Record<string, unknown>);
  ok(): boolean;
  toDict(): Record<string, unknown>;
}

export interface WebTransport {
  name(): string;
  get(request: TransportRequest | Record<string, unknown>): Promise<TransportResponse>;
}

export declare class MapTransport implements WebTransport {
  constructor(pages?: Record<string, string | { body?: string; status?: number; contentType?: string }>);
  name(): string;
  setPage(url: string, body: string, status?: number, contentType?: string): this;
  setError(url: string, error: string): this;
  clear(): this;
  get(request: TransportRequest | Record<string, unknown>): Promise<TransportResponse>;
}

export declare class HttpTransport implements WebTransport {
  constructor(opts?: { fetchImpl?: typeof fetch | null; name?: string; retries?: number; baseDelayMs?: number });
  name(): string;
  get(request: TransportRequest | Record<string, unknown>): Promise<TransportResponse>;
}

export declare function makeTransport(kind?: string, opts?: Record<string, unknown>): WebTransport;
export declare function defaultTransport(preferLive?: boolean): WebTransport;
export declare function makeFixtureMapTransport(): MapTransport;

export declare function decodeHtmlEntities(input: string): string;
export declare function extractTitle(html: string): string;
export declare function extractText(html: string, stripScriptsStyles?: boolean, maxChars?: number): string;
export declare function extractLinks(html: string, baseUrl?: string, maxLinks?: number): ExtractedLink[];
export declare function preferMainContent(html: string): string;
export declare function htmlTableToMarkdown(html: string): string;
export declare function extractJsonLd(html: string): unknown[];
export declare function extractPageMetadata(html: string, url?: string): {
  title: string;
  description: string;
  canonical: string;
  charset: string;
  json_ld: unknown[];
};
export declare const PLATFORM_SEARCH_PROVIDERS: readonly string[];
export declare function htmlToMarkdown(html: string, opts?: Record<string, unknown>): string;
export declare function pageHtmlToMarkdown(
  url: string,
  html: string,
  policy?: ExplorePolicy | Record<string, unknown>,
): string;
export declare function extractPage(
  url: string,
  html: string,
  policy?: ExplorePolicy | Record<string, unknown>,
): {
  url: string;
  title: string;
  text: string;
  markdown: string;
  links: ExtractedLink[];
  rawBodyBytes: number;
};

export interface ExploreStep {
  stepIndex: number;
  depth: number;
  url: string;
  finalUrl: string;
  status: number;
  success: boolean;
  error: string;
  title: string;
  text: string;
  markdown: string;
  links: ExtractedLink[];
  rawBodyBytes: number;
  blockedLinks: string[];
  errorCode?: string;
  relevance?: number;
}

export interface ExploreResult {
  success: boolean;
  startUrl: string;
  finalUrl: string;
  pagesFetched: number;
  maxDepthReached: number;
  title: string;
  text: string;
  markdown: string;
  links: ExtractedLink[];
  steps: ExploreStep[];
  policy: ExplorePolicy;
  error: string;
  metadata: Record<string, unknown>;
}

export declare class WebExplorer {
  constructor(transport?: WebTransport | null, policy?: ExplorePolicy | Record<string, unknown> | null);
  setTransport(transport: WebTransport | null): this;
  setPolicy(policy: ExplorePolicy | Record<string, unknown>): this;
  fetch(url: string, policyOverride?: ExplorePolicy | Record<string, unknown> | null): Promise<ExploreResult>;
  explore(startUrl: string, policyOverride?: ExplorePolicy | Record<string, unknown> | null): Promise<ExploreResult>;
}

export declare function webFetch(
  url: string,
  transport?: WebTransport | null,
  policy?: ExplorePolicy | Record<string, unknown>,
): Promise<ExploreResult>;
export declare function webExplore(
  startUrl: string,
  transport?: WebTransport | null,
  policy?: ExplorePolicy | Record<string, unknown>,
): Promise<ExploreResult>;

export interface SearchHit {
  title: string;
  url: string;
  score?: number;
  snippet?: string;
  source?: string;
  queries?: string[];
  rank?: number;
}

export interface UserBrowserSearchOptions {
  maxResults?: number;
  max_results?: number;
  timeoutMs?: number;
  timeout_ms?: number;
  signal?: AbortSignal;
}

export interface UserBrowserPageOptions extends UserBrowserSearchOptions {
  maxBodyBytes?: number;
  max_body_bytes?: number;
  maxTextChars?: number;
  max_text_chars?: number;
  maxMarkdownChars?: number;
  max_markdown_chars?: number;
  maxLinksPerPage?: number;
  max_links_per_page?: number;
  maxQueries?: number;
  max_queries?: number;
  maxResultsPerQuery?: number;
  max_results_per_query?: number;
  concurrency?: number;
  query?: string;
  skipActionLinks?: boolean;
  skip_action_links?: boolean;
  [key: string]: unknown;
}

export interface UserBrowserPage {
  success: boolean;
  url: string;
  finalUrl: string;
  status: number;
  title: string;
  text: string;
  markdown: string;
  links: ExtractedLink[];
  errorCode: string;
  error: string;
  metadata: Record<string, unknown>;
}

export interface UserBrowserBridge {
  search(
    query: string,
    options?: UserBrowserSearchOptions,
  ): Promise<SearchHit[] | { results: SearchHit[]; error_code?: string; error?: string }> | SearchHit[] | { results: SearchHit[]; error_code?: string; error?: string };
  fetch?(
    url: string,
    options?: UserBrowserPageOptions,
  ): Promise<Record<string, unknown> | UserBrowserPage> | Record<string, unknown> | UserBrowserPage;
  open?(
    url: string,
    options?: UserBrowserPageOptions,
  ): Promise<Record<string, unknown> | UserBrowserPage> | Record<string, unknown> | UserBrowserPage;
}

export interface DefaultBrowserBridgeOptions {
  endpoint?: string;
  url?: string;
  bridgeUrl?: string;
  bridge_url?: string;
  token?: string;
  authToken?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  timeout_ms?: number;
  maxResponseBytes?: number;
  max_response_bytes?: number;
}

export interface SearchResult {
  success: boolean;
  query: string;
  keywords: string;
  results: SearchHit[];
  count: number;
  providers_requested: string[];
  providers_used: string[];
  provider_trace?: Array<Record<string, unknown>>;
  strict_provider?: boolean;
  errors: string[];
  provider_codes: string[];
  error_code: string;
  engine: string;
  error?: string;
}

export declare const DEFAULT_SEARCH_PROVIDERS: readonly [
  "google_browser",
  "project_index",
  "google_http",
  "duckduckgo",
  "wikipedia",
];
export declare const SUPPORTED_SEARCH_PROVIDERS: readonly string[];
export declare const USER_BROWSER_PROVIDER: "user_browser";
export declare const DEFAULT_BROWSER_PROVIDER: "default_browser";
export declare const DEFAULT_BROWSER_BRIDGE_ENV: "HANDOFFKIT_DEFAULT_BROWSER_BRIDGE_URL";
export declare const DEFAULT_BROWSER_TOKEN_ENV: "HANDOFFKIT_DEFAULT_BROWSER_BRIDGE_TOKEN";
export declare class UserBrowserBridgeError extends Error {
  code: string;
}
export declare class DefaultBrowserBridgeError extends Error {
  code: string;
}
export declare function isUserBrowserBridge(bridge: unknown): bridge is UserBrowserBridge;
export declare function isUserBrowserPageBridge(bridge: unknown): bridge is UserBrowserBridge;
export declare function searchUserBrowser(
  bridge: UserBrowserBridge | null | undefined,
  query: string,
  options?: UserBrowserSearchOptions,
): Promise<{ hits: SearchHit[]; error_code: string; error: string }>;
export declare function searchUserBrowserMany(
  bridge: UserBrowserBridge | null | undefined,
  queries: string | string[],
  options?: UserBrowserPageOptions,
): Promise<{
  success: boolean;
  queries: string[];
  hits: SearchHit[];
  count: number;
  query_results: unknown[];
  errors: string[];
  error_codes: string[];
  error_code: string;
  error: string;
  metadata: Record<string, unknown>;
}>;
export declare function fetchUserBrowserPage(
  bridge: UserBrowserBridge | null | undefined,
  url: string,
  options?: UserBrowserPageOptions,
): Promise<UserBrowserPage>;
export declare function exploreUserBrowser(
  bridge: UserBrowserBridge | null | undefined,
  startUrls: string | string[],
  options?: ExplorePolicy | UserBrowserPageOptions | Record<string, unknown>,
): Promise<ExploreResult>;
export declare function createDefaultBrowserBridge(options?: DefaultBrowserBridgeOptions): UserBrowserBridge & {
  provider: "default_browser";
  endpoint: string;
  configured: boolean;
  error: string;
};
export declare function isDefaultBrowserBridge(bridge: unknown): bridge is UserBrowserBridge & { provider: "default_browser" };
export declare function searchDefaultBrowser(
  bridge: UserBrowserBridge | null | undefined,
  query: string,
  options?: UserBrowserSearchOptions,
): Promise<{ hits: SearchHit[]; error_code: string; error: string }>;
export declare function searchDefaultBrowserMany(
  bridge: UserBrowserBridge | null | undefined,
  queries: string | string[],
  options?: UserBrowserPageOptions,
): Promise<Record<string, unknown>>;
export declare function fetchDefaultBrowserPage(
  bridge: UserBrowserBridge | null | undefined,
  url: string,
  options?: UserBrowserPageOptions,
): Promise<UserBrowserPage>;
export declare function exploreDefaultBrowser(
  bridge: UserBrowserBridge | null | undefined,
  startUrls: string | string[],
  options?: ExplorePolicy | UserBrowserPageOptions | Record<string, unknown>,
): Promise<ExploreResult>;

export declare function webSearch(query: string, opts?: Record<string, unknown>): Promise<SearchResult>;
export declare function searchGoogle(
  transport: WebTransport,
  query: string,
  maxResults?: number,
  timeoutMs?: number,
): Promise<SearchHit[]>;
export declare function multiSearch(
  transport: WebTransport,
  query: string,
  maxResults?: number,
  timeoutMs?: number,
  providers?: string[],
  userBrowser?: UserBrowserBridge | null,
): Promise<SearchHit[]>;
export declare function keywordCompress(query: string, maxWords?: number): string;
export declare function urlEncodeComponent(s: string): string;
export declare function urlDecodeBasic(input: string): string;

export declare class PageMarkdown {
  url: string;
  title: string;
  markdown: string;
  excerpt: string;
  text: string;
  links: ExtractedLink[];
  fetchedAt: string;
  format: string;
  blocked: boolean;
  error: string;
  markdownChars: number;
  success: boolean;
  constructor(init?: Record<string, unknown>);
  toDict(): Record<string, unknown>;
  static fromDict(data?: Record<string, unknown>): PageMarkdown;
  static fromExploreResult(result: ExploreResult, opts?: { maxChars?: number; format?: string }): PageMarkdown;
}

export declare function makeExcerpt(text: string, max?: number): string;
export declare function toReadmeMarkdown(opts: {
  title?: string;
  url?: string;
  markdown?: string;
  links?: ExtractedLink[];
}): string;

export declare class ResearchPack {
  enabled: boolean;
  used: boolean;
  queries: string[];
  urls_fetched: string[];
  markdown_context: string;
  pages: PageMarkdown[];
  citations: Array<{ title: string; url: string }>;
  steps: unknown[];
  pages_ok: number;
  tool_calls: number;
  error: string;
  transport: string;
  mode: string;
  metadata: Record<string, unknown>;
  constructor(init?: Record<string, unknown>);
  toDict(): Record<string, unknown>;
  toAgentMarkdown(opts?: { maxChars?: number }): string;
  promptSection(): string;
}

export declare function gatherWebResearch(config?: Record<string, unknown>): Promise<ResearchPack>;
export declare function gatherDeepWebResearch(config?: Record<string, unknown>): Promise<ResearchPack>;
export declare function researchPromptSection(research: ResearchPack | Record<string, unknown>): string;
export declare function extractUrlsFromText(text: string): string[];
export declare function makeSearchQueryFromTask(task: string, maxChars?: number): string;
export declare function makeResearchQueries(opts?: {
  query?: string;
  task?: string;
  maxSubQueries?: number;
  max_sub_queries?: number;
}): string[];

export declare class BrowserCache {
  constructor(opts?: { root?: string; ttlMs?: number });
  get(url: string): Promise<Record<string, unknown> | null>;
  set(url: string, payload?: Record<string, unknown>): Promise<boolean>;
}
export declare function defaultCacheRoot(): string;

export declare function hostScore(url: string): number;
export declare function rankSearchHits(
  hits?: SearchHit[],
  opts?: { allowHosts?: string[]; denyHosts?: string[] },
): Array<SearchHit & { score: number }>;
export declare function filterUrlsByHosts(
  urls: string[],
  opts?: { allowHosts?: string[]; denyHosts?: string[] },
): string[];

export declare function detectSoftBlock(body?: string, status?: number): { blocked: boolean; reason: string };
export declare function smartTruncate(markdown: string, maxChars?: number): string;
export declare function mapWithConcurrency<T, R>(
  items: T[],
  maxParallel: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]>;
export declare function canonicalUrl(url: string): string;
export declare function withRetries<T>(
  fn: (attempt: number) => Promise<T>,
  opts?: { retries?: number; baseDelayMs?: number; retryOn?: ((value: T) => boolean) | null },
): Promise<T>;

export declare function createBrowserAgentKit(options?: Record<string, unknown>): {
  transport: WebTransport;
  policy: ExplorePolicy;
  registry: ToolRegistry;
  explorer: WebExplorer;
  cache: BrowserCache | null;
  defaults: Record<string, unknown>;
  tools: Tool[];
  search: (query: string, opts?: Record<string, unknown>) => Promise<SearchResult>;
  searchMany: (queries: string | string[], opts?: Record<string, unknown>) => Promise<Record<string, unknown>>;
  fetchMarkdown: (url: string, opts?: Record<string, unknown>) => Promise<PageMarkdown>;
  gather: (config?: Record<string, unknown>) => Promise<ResearchPack>;
  deepGather: (config?: Record<string, unknown>) => Promise<ResearchPack>;
  ResearchPack: typeof ResearchPack;
};

export declare function registerBrowserTools(registry: ToolRegistry, transport?: WebTransport | null, defaults?: Record<string, unknown>): ToolRegistry;
export declare function registerWebExplorerTools(registry: ToolRegistry, transport?: WebTransport | null, defaults?: Record<string, unknown>): ToolRegistry;
export declare function makeWebSearchTool(defaultTransportRef?: WebTransport | null, defaults?: Record<string, unknown>): Tool;
export declare function makeWebFetchTool(defaultTransportRef?: WebTransport | null): Tool;
export declare function makeWebExploreTool(defaultTransportRef?: WebTransport | null): Tool;
export declare function makeHtmlToMarkdownTool(defaultTransportRef?: WebTransport | null): Tool;
export declare function makeWebFetchMarkdownTool(defaultTransportRef?: WebTransport | null): Tool;
export declare function makeWebResearchTool(defaultTransportRef?: WebTransport | null, defaults?: Record<string, unknown>): Tool;
export declare function makeDeepWebResearchTool(defaultTransportRef?: WebTransport | null, defaults?: Record<string, unknown>): Tool;
export declare function parseRobotsTxt(text: string, userAgent?: string): Array<Record<string, unknown>>;
export declare function isRobotsAllowed(text: string, url: string, userAgent?: string): boolean;
export declare const PROJECT_INDEX_DISCLAIMER: string;
export declare class ProjectWebIndex {
  constructor(options?: Record<string, unknown>);
  open(): Promise<ProjectWebIndex>;
  ingest(record: Record<string, unknown>): Promise<Record<string, unknown>>;
  search(query: string, options?: Record<string, unknown>): Promise<Record<string, unknown>>;
  integrityCheck(): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}
export declare function finalizeResearchPackV2(pack: ResearchPack): ResearchPack;
export declare function writeResearchCheckpoint(root: string, pack: ResearchPack | Record<string, unknown>, extras?: Record<string, unknown>): Promise<Record<string, unknown>>;
export declare function runFixtureGrounding(corpus: Record<string, unknown>): Record<string, unknown>;
export declare function scoreGroundingRun(corpus: Record<string, unknown>, answers: Record<string, unknown>): Record<string, unknown>;
export declare function liveGroundingOracle(corpus: Record<string, unknown>, pages: unknown): Record<string, Record<string, unknown>>;
export declare function scoreLiveGroundingRun(corpus: Record<string, unknown>, answers: Record<string, unknown>, pages: unknown, options?: Record<string, unknown>): Record<string, unknown>;
export declare function judgeModelAnswer(transcript: Record<string, unknown>): Record<string, unknown>;
