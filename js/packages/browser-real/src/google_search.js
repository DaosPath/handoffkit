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

// ASCII case-insensitive comparison (what a non-unicode /i regex does).
function lowerAscii(code) {
  return code >= 65 && code <= 90 ? code + 32 : code;
}

function matchesAt(text, index, needle) {
  if (index < 0 || index + needle.length > text.length) return false;
  for (let k = 0; k < needle.length; k += 1) {
    if (lowerAscii(text.charCodeAt(index + k)) !== needle.charCodeAt(k)) return false;
  }
  return true;
}

function isWordChar(ch) {
  return ch !== undefined && /[A-Za-z0-9_]/.test(ch);
}

function isQuote(ch) {
  return ch === '"' || ch === "'";
}

// Sorted positions of every occurrence, queried by binary search, so lookups
// stay O(log n) whatever order the scanner asks in.
function positionsOf(text, predicate) {
  const out = [];
  for (let i = 0; i < text.length; i += 1) if (predicate(i)) out.push(i);
  return out;
}

function nextFrom(positions, index) {
  let lo = 0;
  let hi = positions.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (positions[mid] < index) lo = mid + 1;
    else hi = mid;
  }
  return lo < positions.length ? positions[lo] : -1;
}

/**
 * Linear-time scanner equivalent to iterating
 * /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi with exec(), which is
 * polynomial on inputs such as many repetitions of 'href="!"'. Yields
 * [href, inner] pairs in the same order with the same captures.
 */
function* anchorMatches(text) {
  const gts = positionsOf(text, (i) => text[i] === ">");
  const quotes = positionsOf(text, (i) => isQuote(text[i]));
  const closes = positionsOf(text, (i) => text[i] === "<" && matchesAt(text, i, "</a>"));
  let pos = 0;
  while (pos < text.length) {
    const s = text.indexOf("<", pos);
    if (s === -1) return;
    if (!matchesAt(text, s, "<a") || isWordChar(text[s + 2])) {
      pos = s + 1;
      continue;
    }
    // [^>]* before href= cannot cross the first ">" after "<a".
    const gt = nextFrom(gts, s + 2);
    if (gt === -1) return; // no ">" left: no later match is possible either
    const close = nextFrom(closes, gt + 1);
    if (close === -1) return; // no "</a>" left: no later match is possible either
    const candidates = [];
    for (let h = s + 2; h < gt; h += 1) {
      if (text[h] === "h" || text[h] === "H") {
        if (matchesAt(text, h, "href=") && isQuote(text[h + 5])) candidates.push(h);
      }
    }
    let found = null;
    // The greedy [^>]* tries the last href= first. Only the last one's value can
    // run past the tag's first ">"; every earlier value ends before the next
    // href= quote, so its closing ">" is `gt` and its "</a>" is `close`.
    for (let c = candidates.length - 1; c >= 0 && !found; c -= 1) {
      const valueStart = candidates[c] + 6;
      const valueEnd = nextFrom(quotes, valueStart);
      if (valueEnd === -1 || valueEnd === valueStart) continue;
      const tagEnd = c === candidates.length - 1 ? nextFrom(gts, valueEnd + 1) : gt;
      if (tagEnd === -1) continue;
      const closeAt = c === candidates.length - 1 ? nextFrom(closes, tagEnd + 1) : close;
      if (closeAt === -1) continue;
      found = { href: text.slice(valueStart, valueEnd), inner: text.slice(tagEnd + 1, closeAt), end: closeAt + 4 };
    }
    if (found) {
      yield [found.href, found.inner];
      pos = found.end;
    } else {
      // Every later "<a" before `gt` sees a subset of these candidates with the
      // same outcomes, so it cannot match either.
      pos = gt + 1;
    }
  }
}

// Linear-time equivalent of value.replace(/<[^>]+>/g, " ").
function stripTags(value) {
  let out = "";
  let last = 0;
  let i = value.indexOf("<");
  while (i !== -1) {
    const gt = value.indexOf(">", i + 1);
    if (gt === -1) break; // no ">" left: nothing further can match
    if (gt > i + 1) {
      out += `${value.slice(last, i)} `;
      last = gt + 1;
      i = value.indexOf("<", last);
    } else {
      i = value.indexOf("<", i + 1);
    }
  }
  return out + value.slice(last);
}

export function parseGoogleOrganicResults(html, maxResults = 8) {
  const hits = [];
  const seen = new Set();
  for (const [rawHref, inner] of anchorMatches(String(html ?? ""))) {
    if (hits.length >= maxResults) break;
    const href = organicHref(rawHref);
    if (!href || seen.has(href)) continue;
    const title = stripTags(String(inner ?? "")).replace(/\s+/g, " ").trim();
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
