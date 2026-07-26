/** @typedef {{ href: string, absolute: string, text: string }} ExtractedLink */

export const HANDOFFKIT_BROWSER_VERSION = "1.15.0";

export class ExplorePolicy {
  constructor({
    maxDepth = 1,
    maxPages = 8,
    timeoutMs = 15000,
    maxBodyBytes = 2 * 1024 * 1024,
    maxTextChars = 50000,
    maxLinksPerPage = 100,
    sameHostOnly = true,
    followRedirects = true,
    maxRedirects = 5,
    userAgent = "HandoffKit-Browser/1.0 (+https://github.com/DaosPath/handoffkit)",
    allowHosts = [],
    denyHosts = [],
    extraHeaders = {},
    extractText = true,
    extractLinks = true,
    extractTitle = true,
    stripScriptsStyles = true,
    emitMarkdown = true,
    maxMarkdownChars = 60000,
    // snake_case aliases
    max_depth,
    max_pages,
    timeout_ms,
    max_body_bytes,
    max_text_chars,
    max_links_per_page,
    same_host_only,
    follow_redirects,
    max_redirects,
    user_agent,
    allow_hosts,
    deny_hosts,
    extra_headers,
    extract_text,
    extract_links,
    extract_title,
    strip_scripts_styles,
    emit_markdown,
    max_markdown_chars,
  } = {}) {
    this.maxDepth = max_depth ?? maxDepth;
    this.maxPages = max_pages ?? maxPages;
    this.timeoutMs = timeout_ms ?? timeoutMs;
    this.maxBodyBytes = max_body_bytes ?? maxBodyBytes;
    this.maxTextChars = max_text_chars ?? maxTextChars;
    this.maxLinksPerPage = max_links_per_page ?? maxLinksPerPage;
    this.sameHostOnly = same_host_only ?? sameHostOnly;
    this.followRedirects = follow_redirects ?? followRedirects;
    this.maxRedirects = max_redirects ?? maxRedirects;
    this.userAgent = user_agent ?? userAgent;
    this.allowHosts = [...(allow_hosts ?? allowHosts)];
    this.denyHosts = [...(deny_hosts ?? denyHosts)];
    this.extraHeaders = { ...(extra_headers ?? extraHeaders) };
    this.extractText = extract_text ?? extractText;
    this.extractLinks = extract_links ?? extractLinks;
    this.extractTitle = extract_title ?? extractTitle;
    this.stripScriptsStyles = strip_scripts_styles ?? stripScriptsStyles;
    this.emitMarkdown = emit_markdown ?? emitMarkdown;
    this.maxMarkdownChars = max_markdown_chars ?? maxMarkdownChars;
  }

  toDict() {
    return {
      max_depth: this.maxDepth,
      max_pages: this.maxPages,
      timeout_ms: this.timeoutMs,
      max_body_bytes: this.maxBodyBytes,
      max_text_chars: this.maxTextChars,
      max_links_per_page: this.maxLinksPerPage,
      same_host_only: this.sameHostOnly,
      follow_redirects: this.followRedirects,
      max_redirects: this.maxRedirects,
      user_agent: this.userAgent,
      allow_hosts: [...this.allowHosts],
      deny_hosts: [...this.denyHosts],
      extra_headers: { ...this.extraHeaders },
      extract_text: this.extractText,
      extract_links: this.extractLinks,
      extract_title: this.extractTitle,
      strip_scripts_styles: this.stripScriptsStyles,
      emit_markdown: this.emitMarkdown,
      max_markdown_chars: this.maxMarkdownChars,
    };
  }

  static fromDict(data = {}) {
    return new ExplorePolicy(data);
  }
}

export function linkToDict(link) {
  return {
    href: link.href ?? "",
    absolute: link.absolute ?? "",
    text: link.text ?? "",
  };
}

export function stepToDict(step) {
  return {
    step_index: step.stepIndex ?? 0,
    depth: step.depth ?? 0,
    url: step.url ?? "",
    final_url: step.finalUrl ?? "",
    status: step.status ?? 0,
    success: Boolean(step.success),
    error: step.error ?? "",
    title: step.title ?? "",
    text: step.text ?? "",
    markdown: step.markdown ?? "",
    links: (step.links ?? []).map(linkToDict),
    raw_body_bytes: step.rawBodyBytes ?? 0,
    blocked_links: [...(step.blockedLinks ?? [])],
  };
}

export function resultToDict(result) {
  return {
    success: Boolean(result.success),
    start_url: result.startUrl ?? "",
    final_url: result.finalUrl ?? "",
    pages_fetched: result.pagesFetched ?? 0,
    max_depth_reached: result.maxDepthReached ?? 0,
    title: result.title ?? "",
    text: result.text ?? "",
    markdown: result.markdown ?? "",
    links: (result.links ?? []).map(linkToDict),
    steps: (result.steps ?? []).map(stepToDict),
    policy: (result.policy instanceof ExplorePolicy
      ? result.policy
      : new ExplorePolicy(result.policy ?? {})
    ).toDict(),
    error: result.error ?? "",
    metadata: { ...(result.metadata ?? {}) },
  };
}

export function normalizeHost(host) {
  let h = String(host ?? "").toLowerCase();
  while (h.endsWith(".")) h = h.slice(0, -1);
  const at = h.indexOf("@");
  if (at !== -1) h = h.slice(at + 1);
  const colon = h.indexOf(":");
  if (colon !== -1) h = h.slice(0, colon);
  return h;
}

function hostMatches(host, pattern) {
  if (!pattern) return false;
  const h = normalizeHost(host);
  const p = normalizeHost(pattern);
  if (h === p) return true;
  return h.length > p.length && h.endsWith(`.${p}`);
}

export function parseUrl(url) {
  const out = { scheme: "", host: "", path: "", query: "", valid: false };
  const s = String(url ?? "");
  if (!s) return out;
  const schemeEnd = s.indexOf("://");
  let hostStart = 0;
  if (schemeEnd !== -1) {
    out.scheme = s.slice(0, schemeEnd).toLowerCase();
    hostStart = schemeEnd + 3;
  } else if (s.startsWith("/")) {
    out.path = s;
    out.valid = true;
    return out;
  } else {
    out.scheme = "https";
  }
  if (hostStart >= s.length) return out;
  const pathPos = s.indexOf("/", hostStart);
  const queryPos = s.indexOf("?", hostStart);
  let hostEnd = s.length;
  if (pathPos !== -1) hostEnd = Math.min(hostEnd, pathPos);
  if (queryPos !== -1) hostEnd = Math.min(hostEnd, queryPos);
  out.host = normalizeHost(s.slice(hostStart, hostEnd));
  if (pathPos !== -1) {
    if (queryPos !== -1 && queryPos > pathPos) {
      out.path = s.slice(pathPos, queryPos);
      out.query = s.slice(queryPos + 1);
    } else {
      out.path = s.slice(pathPos);
    }
  } else if (queryPos !== -1) {
    out.path = "/";
    out.query = s.slice(queryPos + 1);
  } else {
    out.path = "/";
  }
  out.valid = Boolean(out.host) || out.path.startsWith("/");
  return out;
}

export function resolveUrl(base, href) {
  const raw = String(href ?? "").trim();
  if (!raw || raw.startsWith("#") || raw.toLowerCase().startsWith("javascript:")) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return raw;
  try {
    return new URL(raw, base || undefined).href;
  } catch {
    return "";
  }
}

export function hostAllowed(host, policy) {
  const h = normalizeHost(host);
  const p = policy instanceof ExplorePolicy ? policy : new ExplorePolicy(policy ?? {});
  for (const deny of p.denyHosts) {
    if (hostMatches(h, deny)) return false;
  }
  if (p.allowHosts.length === 0) return true;
  return p.allowHosts.some((allow) => hostMatches(h, allow));
}

export function urlAllowed(url, policy, originHost = "") {
  const parts = parseUrl(url);
  if (!parts.valid || !parts.host) return false;
  if (!hostAllowed(parts.host, policy)) return false;
  const p = policy instanceof ExplorePolicy ? policy : new ExplorePolicy(policy ?? {});
  if (p.sameHostOnly && originHost) {
    if (normalizeHost(parts.host) !== normalizeHost(originHost)) return false;
  }
  return parts.scheme === "http" || parts.scheme === "https";
}

export function policyFromArgs(args = {}) {
  if (args.policy && typeof args.policy === "object") {
    return ExplorePolicy.fromDict({ ...args, ...args.policy });
  }
  return ExplorePolicy.fromDict(args);
}
