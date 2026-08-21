import { detectChallenge } from "./helpers.js";

const AD_RE = /\/aclk\?|googleadservices|doubleclick|\/pagead\/|\/ads(?:\/|$)|sponsored/i;

function organicHref(href) {
  let parsed;
  try {
    parsed = new URL(String(href ?? ""), "https://www.google.com/");
  } catch {
    return "";
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "";

  // Google result pages contain internal navigation and /url redirectors.
  // Follow only an explicit target; never expose a Google URL as an organic hit.
  const host = parsed.hostname.toLowerCase();
  if (host === "google.com" || host.endsWith(".google.com")) {
    const target = parsed.searchParams.get("q") || parsed.searchParams.get("url");
    return target ? organicHref(target) : "";
  }
  if (AD_RE.test(parsed.href)) return "";
  parsed.hash = "";
  return parsed.href;
}

export function parseGoogleOrganicResults(html, maxResults = 8) {
  const hits = [];
  const seen = new Set();
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = re.exec(String(html ?? ""))) && hits.length < maxResults) {
    const href = organicHref(match[1]);
    if (!href || seen.has(href)) continue;
    const title = String(match[2] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!title) continue;
    seen.add(href);
    hits.push({ title, url: href, snippet: "", provider: "google_browser" });
  }
  return hits;
}

export function createGoogleBrowserSearch(client) {
  return async function googleBrowserSearch(query, options = {}) {
    const sessionId = options.sessionId || options.session_id;
    if (!sessionId) {
      return {
        hits: [],
        error_code: "provider_unavailable",
        error: "google_browser requires an explicit Browser Real session",
      };
    }
    const encoded = encodeURIComponent(String(query ?? ""));
    const navigated = await client.dispatch({
      command_id: options.commandId || `google-browser-${Date.now()}`,
      session_id: sessionId,
      name: "navigate",
      payload: { url: `https://www.google.com/search?q=${encoded}&hl=en` },
    });
    if (navigated?.payload?.code === "provider_challenge" || detectChallenge(navigated?.payload?.html || "")) {
      return { hits: [], error_code: "provider_challenge", error: "google returned a challenge page" };
    }
    const snapshot = await client.dispatch({
      command_id: options.htmlCommandId || `google-browser-dom-${Date.now()}`,
      session_id: sessionId,
      name: "snapshot.dom",
      payload: {},
    });
    const html = snapshot?.payload?.html || "";
    if (detectChallenge(html)) {
      return { hits: [], error_code: "provider_challenge", error: "google returned a challenge page" };
    }
    return { hits: parseGoogleOrganicResults(html, options.maxResults || 8), error_code: "" };
  };
}
