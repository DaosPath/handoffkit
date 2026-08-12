export { HANDOFFKIT_BROWSER_VERSION, ExplorePolicy, parseUrl, resolveUrl, hostAllowed, urlAllowed, normalizeHost, policyFromArgs, resultToDict, linkToDict, stepToDict } from "./types.js";

export {
  TransportRequest,
  TransportResponse,
  MapTransport,
  HttpTransport,
  makeTransport,
  defaultTransport,
  makeFixtureMapTransport,
} from "./transport.js";

export {
  decodeHtmlEntities,
  extractTitle,
  extractText,
  extractLinks,
  htmlToMarkdown,
  pageHtmlToMarkdown,
  extractPage,
  preferMainContent,
} from "./html_extract.js";

export { WebExplorer, webFetch, webExplore } from "./explorer.js";

export {
  webSearch,
  multiSearch,
  DEFAULT_SEARCH_PROVIDERS,
  SUPPORTED_SEARCH_PROVIDERS,
  keywordCompress,
  urlEncodeComponent,
  urlDecodeBasic,
} from "./search.js";

export {
  USER_BROWSER_PROVIDER,
  UserBrowserBridgeError,
  isUserBrowserBridge,
  searchUserBrowser,
} from "./user_browser.js";

export {
  gatherWebResearch,
  gatherDeepWebResearch,
  researchPromptSection,
  extractUrlsFromText,
  makeSearchQueryFromTask,
  makeResearchQueries,
  ResearchPack,
} from "./research.js";

export {
  registerBrowserTools,
  registerWebExplorerTools,
  makeWebSearchTool,
  makeWebFetchTool,
  makeWebExploreTool,
  makeHtmlToMarkdownTool,
  makeWebFetchMarkdownTool,
  makeWebResearchTool,
  makeDeepWebResearchTool,
} from "./tools.js";

export { createBrowserAgentKit } from "./kit.js";
export { PageMarkdown, makeExcerpt, toReadmeMarkdown } from "./page.js";
export { BrowserCache, defaultCacheRoot } from "./cache.js";
export { hostScore, rankSearchHits, filterUrlsByHosts } from "./rank.js";
export {
  detectSoftBlock,
  smartTruncate,
  mapWithConcurrency,
  canonicalUrl,
  withRetries,
} from "./util.js";
