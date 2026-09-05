export { HANDOFFKIT_BROWSER_CORE_VERSION } from "@handoffkit/browser-core";

export const HANDOFFKIT_BROWSER_REAL_VERSION = "1.20.0-alpha.2";

export { detectChallenge, isDefaultUserProfile } from "./helpers.js";
export { BrowserRealClient, connectBrowserRealTls } from "./client.js";
export { BrowserRealService, startBrowserRealService } from "./service.js";
export { loadBrowserRealConfig, CONFIG_ENV } from "./config.js";
export { createGoogleBrowserSearch, parseGoogleOrganicResults } from "./google_search.js";
export { ArtifactStore } from "./artifacts.js";
export { resolveManagedProfile } from "./profiles.js";
export { wrapCommandEnvelope, wrapEventEnvelope, BROWSER_CONTROL_CHANNEL, BROWSER_CONTROL_OPERATION } from "./csp_bridge.js";
