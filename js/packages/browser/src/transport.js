/**
 * Injectable web transport. MapTransport for offline tests; HttpTransport for live fetch.
 */

export class TransportResponse {
  constructor({
    status = 0,
    finalUrl = "",
    contentType = "",
    body = "",
    headers = {},
    error = "",
    final_url,
    content_type,
  } = {}) {
    this.status = status;
    this.finalUrl = final_url ?? finalUrl;
    this.contentType = content_type ?? contentType;
    this.body = body;
    this.headers = { ...headers };
    this.error = error;
  }

  ok() {
    return !this.error && this.status >= 200 && this.status < 400;
  }

  toDict() {
    return {
      status: this.status,
      final_url: this.finalUrl,
      content_type: this.contentType,
      body: this.body,
      headers: { ...this.headers },
      error: this.error,
    };
  }
}

export class TransportRequest {
  constructor({
    url = "",
    method = "GET",
    headers = {},
    timeoutMs = 15000,
    maxBodyBytes = 2 * 1024 * 1024,
    followRedirects = true,
    maxRedirects = 5,
    timeout_ms,
    max_body_bytes,
    follow_redirects,
    max_redirects,
  } = {}) {
    this.url = url;
    this.method = method;
    this.headers = { ...headers };
    this.timeoutMs = timeout_ms ?? timeoutMs;
    this.maxBodyBytes = max_body_bytes ?? maxBodyBytes;
    this.followRedirects = follow_redirects ?? followRedirects;
    this.maxRedirects = max_redirects ?? maxRedirects;
  }
}

/** Offline / fixture transport. */
export class MapTransport {
  constructor(pages = {}) {
    this._pages = new Map();
    this._errors = new Map();
    for (const [url, value] of Object.entries(pages)) {
      if (typeof value === "string") this.setPage(url, value);
      else this.setPage(url, value.body ?? "", value.status ?? 200, value.contentType);
    }
  }

  name() {
    return "map";
  }

  setPage(url, body, status = 200, contentType = "text/html; charset=utf-8") {
    this._pages.set(url, { body: String(body ?? ""), status, contentType });
    this._errors.delete(url);
    return this;
  }

  setError(url, error) {
    this._errors.set(url, String(error ?? "transport error"));
    this._pages.delete(url);
    return this;
  }

  clear() {
    this._pages.clear();
    this._errors.clear();
    return this;
  }

  async get(request) {
    const req = request instanceof TransportRequest ? request : new TransportRequest(request);
    const url = req.url;
    if (this._errors.has(url)) {
      return new TransportResponse({ error: this._errors.get(url), finalUrl: url });
    }
    const page = this._pages.get(url);
    if (!page) {
      return new TransportResponse({
        status: 404,
        finalUrl: url,
        error: `map transport: no page for ${url}`,
      });
    }
    let body = page.body;
    if (req.maxBodyBytes > 0 && body.length > req.maxBodyBytes) {
      body = body.slice(0, req.maxBodyBytes);
    }
    return new TransportResponse({
      status: page.status,
      finalUrl: url,
      contentType: page.contentType,
      body,
      headers: { "content-type": page.contentType },
    });
  }
}

/** Live HTTP via native fetch (or inject fetchImpl). */
export class HttpTransport {
  constructor({ fetchImpl = null, name: transportName = "http", retries = 2, baseDelayMs = 300 } = {}) {
    this._fetch = fetchImpl;
    this._name = transportName;
    this._retries = Math.max(0, Number(retries) || 0);
    this._baseDelayMs = Math.max(0, Number(baseDelayMs) || 0);
  }

  name() {
    return this._name;
  }

  async get(request) {
    const req = request instanceof TransportRequest ? request : new TransportRequest(request);
    const fetchFn = this._fetch ?? globalThis.fetch;
    if (typeof fetchFn !== "function") {
      return new TransportResponse({
        error: "HttpTransport requires global fetch or fetchImpl",
        finalUrl: req.url,
      });
    }

    let last = null;
    for (let attempt = 0; attempt <= this._retries; attempt++) {
      last = await this._once(fetchFn, req);
      const retryable =
        last.error?.includes("timeout") ||
        last.status === 429 ||
        last.status === 503 ||
        last.status === 502 ||
        last.status === 504;
      if (!retryable || attempt >= this._retries) return last;
      const delay = this._baseDelayMs * 2 ** attempt;
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    }
    return last;
  }

  async _once(fetchFn, req) {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer =
      controller && req.timeoutMs > 0
        ? setTimeout(() => controller.abort(), req.timeoutMs)
        : null;

    try {
      const headers = {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        ...req.headers,
      };
      const response = await fetchFn(req.url, {
        method: req.method || "GET",
        headers,
        redirect: req.followRedirects ? "follow" : "manual",
        signal: controller?.signal,
      });
      const contentType = response.headers?.get?.("content-type") ?? "";
      let body = await response.text();
      if (req.maxBodyBytes > 0 && body.length > req.maxBodyBytes) {
        body = body.slice(0, req.maxBodyBytes);
      }
      const outHeaders = {};
      if (response.headers && typeof response.headers.forEach === "function") {
        response.headers.forEach((value, key) => {
          outHeaders[key] = value;
        });
      }
      return new TransportResponse({
        status: response.status,
        finalUrl: response.url || req.url,
        contentType,
        body,
        headers: outHeaders,
      });
    } catch (error) {
      const message =
        error?.name === "AbortError"
          ? `timeout after ${req.timeoutMs}ms`
          : error instanceof Error
            ? error.message
            : String(error);
      return new TransportResponse({ error: message, finalUrl: req.url });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

export function makeTransport(kind = "http", opts = {}) {
  const key = String(kind ?? "http").toLowerCase();
  if (key === "map" || key === "stub" || key === "offline" || key === "fixture") {
    if (key === "fixture") return makeFixtureMapTransport();
    return new MapTransport();
  }
  if (key === "http" || key === "live" || key === "https") {
    return new HttpTransport(opts);
  }
  throw new TypeError(`unknown transport kind: ${kind}`);
}

export function defaultTransport(preferLive = true) {
  return preferLive ? new HttpTransport() : new MapTransport();
}

export function makeFixtureMapTransport() {
  const map = new MapTransport();
  const index = `<!DOCTYPE html>
<html><head><title>Fixture Home</title></head>
<body>
<h1>Welcome to Fixture</h1>
<p>Home page for offline web explorer tests. Alpha &amp; beta notes.</p>
<script>secret_should_not_appear();</script>
<a href="/about.html">About Us</a>
<a href="/docs/guide.html">Guide</a>
<a href="https://evil.example/block-me">External Evil</a>
</body></html>`;
  const about = `<html><head><title>About Fixture</title></head>
<body><p>About page content with more detail.</p>
<a href="/">Home</a>
<a href="/docs/guide.html">Guide</a>
</body></html>`;
  const guide = `<html><head><title>Guide</title></head>
<body><h2>User Guide</h2><p>Step one: configure ExplorePolicy. Step two: inject WebTransport.</p>
<a href="/">Home</a>
</body></html>`;
  map.setPage("https://fixture.local/", index);
  map.setPage("https://fixture.local/index.html", index);
  map.setPage("https://fixture.local/about.html", about);
  map.setPage("https://fixture.local/docs/guide.html", guide);
  map.setPage("https://fixture.local/missing.html", "", 404);
  map.setError("https://fixture.local/boom", "simulated transport failure");
  return map;
}
