/** Shared helpers for robustness + readable truncation. */

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function detectSoftBlock(body = "", status = 0) {
  const text = String(body ?? "").slice(0, 8000).toLowerCase();
  if (status === 403 || status === 429 || status === 503) {
    if (
      text.includes("cf-browser-verification") ||
      text.includes("just a moment") ||
      text.includes("attention required") ||
      text.includes("cloudflare") ||
      text.includes("access denied") ||
      text.includes("captcha") ||
      text.includes("enable javascript")
    ) {
      return { blocked: true, reason: `soft_block_status_${status}` };
    }
    if (status === 403 || status === 429) {
      return { blocked: true, reason: `http_${status}` };
    }
  }
  if (
    text.includes("cf-browser-verification") ||
    text.includes("checking your browser") ||
    (text.includes("captcha") && text.includes("cloudflare"))
  ) {
    return { blocked: true, reason: "challenge_page" };
  }
  return { blocked: false, reason: "" };
}

/** Prefer keeping heading structure when truncating markdown. */
export function smartTruncate(markdown, maxChars = 60000) {
  const md = String(markdown ?? "");
  if (!maxChars || md.length <= maxChars) return md;
  const cut = md.slice(0, maxChars);
  const lastHeading = Math.max(cut.lastIndexOf("\n## "), cut.lastIndexOf("\n# "));
  const lastPara = cut.lastIndexOf("\n\n");
  let end = maxChars;
  if (lastHeading > maxChars * 0.5) end = lastHeading;
  else if (lastPara > maxChars * 0.6) end = lastPara;
  return `${cut.slice(0, end).trimEnd()}\n\n...[truncated]\n`;
}

export async function mapWithConcurrency(items, maxParallel, worker) {
  const list = Array.isArray(items) ? items : [];
  const limit = Math.max(1, Math.min(list.length || 1, Math.floor(Number(maxParallel) || 1)));
  const results = new Array(list.length);
  let cursor = 0;
  const runners = Array.from({ length: limit }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= list.length) return;
      results[index] = await worker(list[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

export function canonicalUrl(url) {
  try {
    const u = new URL(String(url));
    u.hash = "";
    // strip common tracking params
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_)/i.test(key)) u.searchParams.delete(key);
    }
    let href = u.href;
    if (href.endsWith("/") && u.pathname !== "/") href = href.slice(0, -1);
    return href;
  } catch {
    return String(url ?? "");
  }
}

export async function withRetries(fn, { retries = 2, baseDelayMs = 250, retryOn = null } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const value = await fn(attempt);
      if (retryOn && retryOn(value) && attempt < retries) {
        await sleep(baseDelayMs * 2 ** attempt);
        continue;
      }
      return value;
    } catch (error) {
      lastError = error;
      if (attempt >= retries) break;
      await sleep(baseDelayMs * 2 ** attempt);
    }
  }
  throw lastError;
}
