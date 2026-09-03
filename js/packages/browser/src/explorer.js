import {
  ExplorePolicy,
  hostAllowed,
  normalizeHost,
  parseUrl,
  resultToDict,
  urlAllowed,
} from "./types.js";
import { extractPage } from "./html_extract.js";
import { MapTransport, TransportRequest } from "./transport.js";
import { detectSoftBlock } from "./util.js";

export class WebExplorer {
  constructor(transport = null, policy = null) {
    this.transport = transport ?? new MapTransport();
    this.policy = policy instanceof ExplorePolicy ? policy : new ExplorePolicy(policy ?? {});
  }

  setTransport(transport) {
    this.transport = transport ?? new MapTransport();
    return this;
  }

  setPolicy(policy) {
    this.policy = policy instanceof ExplorePolicy ? policy : new ExplorePolicy(policy ?? {});
    return this;
  }

  _makeRequest(url, policy) {
    return new TransportRequest({
      url,
      timeoutMs: policy.timeoutMs,
      maxBodyBytes: policy.maxBodyBytes,
      followRedirects: policy.followRedirects,
      maxRedirects: policy.maxRedirects,
      headers: {
        "User-Agent": policy.userAgent,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        ...policy.extraHeaders,
      },
    });
  }

  async _fetchOne(url, depth, policy) {
    const step = {
      stepIndex: 0,
      depth,
      url: String(url),
      finalUrl: "",
      status: 0,
      success: false,
      error: "",
      title: "",
      text: "",
      markdown: "",
      links: [],
      rawBodyBytes: 0,
      blockedLinks: [],
    };

    const parts = parseUrl(url);
    if (!parts.valid || !parts.host) {
      step.error = "invalid url";
      return step;
    }
    if (!hostAllowed(parts.host, policy)) {
      step.error = `host denied by policy: ${parts.host}`;
      return step;
    }
    if (!this.transport) {
      step.error = "no transport configured";
      return step;
    }

    const resp = await this.transport.get(this._makeRequest(url, policy));
    step.status = resp.status;
    step.finalUrl = resp.finalUrl || step.url;
    step.rawBodyBytes = resp.body?.length ?? 0;
    if (resp.error) {
      step.error = resp.error;
      return step;
    }
    const soft = detectSoftBlock(resp.body ?? "", resp.status);
    if (soft.blocked) {
      step.error = soft.reason;
      step.success = false;
      return step;
    }
    if (resp.status < 200 || resp.status >= 400) {
      step.error = `HTTP status ${resp.status}`;
    }
    const page = extractPage(step.finalUrl, resp.body ?? "", policy);
    step.title = page.title;
    step.text = page.text;
    step.markdown = page.markdown;
    step.links = page.links;

    const origin = normalizeHost(parts.host);
    for (const link of step.links) {
      if (!link.absolute) continue;
      if (!urlAllowed(link.absolute, policy, origin)) {
        step.blockedLinks.push(link.absolute);
      }
    }
    if (!step.error) step.success = true;
    return step;
  }

  async fetch(url, policyOverride = null) {
    const policy =
      policyOverride instanceof ExplorePolicy
        ? policyOverride
        : policyOverride
          ? new ExplorePolicy(policyOverride)
          : this.policy;

    const result = {
      success: false,
      startUrl: String(url),
      finalUrl: "",
      pagesFetched: 0,
      maxDepthReached: 0,
      title: "",
      text: "",
      markdown: "",
      links: [],
      steps: [],
      policy,
      error: "",
      metadata: {
        transport: this.transport?.name?.() ?? "none",
        mode: "fetch",
      },
    };

    const step = await this._fetchOne(url, 0, policy);
    step.stepIndex = 0;
    result.steps.push(step);
    if (step.success) {
      result.success = true;
      result.pagesFetched = 1;
      result.finalUrl = step.finalUrl;
      result.title = step.title;
      result.text = step.text;
      result.markdown = step.markdown;
      result.links = step.links;
    } else {
      result.error = step.error;
      result.finalUrl = step.finalUrl;
    }
    return result;
  }

  async explore(startUrl, policyOverride = null) {
    const policy =
      policyOverride instanceof ExplorePolicy
        ? policyOverride
        : policyOverride
          ? new ExplorePolicy(policyOverride)
          : this.policy;

    const result = {
      success: false,
      startUrl: String(startUrl),
      finalUrl: "",
      pagesFetched: 0,
      maxDepthReached: 0,
      title: "",
      text: "",
      markdown: "",
      links: [],
      steps: [],
      policy,
      error: "",
      metadata: {
        transport: this.transport?.name?.() ?? "none",
        mode: "explore",
      },
    };

    const startParts = parseUrl(startUrl);
    if (!startParts.valid || !startParts.host) {
      result.error = "invalid start_url";
      return result;
    }
    if (!hostAllowed(startParts.host, policy)) {
      result.error = `start host denied by policy: ${startParts.host}`;
      return result;
    }

    const originHost = normalizeHost(startParts.host);
    const visited = new Set();
    /** @type {Array<{ url: string, depth: number }>} */
    const queue = [{ url: String(startUrl), depth: 0 }];
    let stepIndex = 0;

    while (queue.length && result.pagesFetched < policy.maxPages) {
      const { url, depth } = queue.shift();
      if (visited.has(url)) continue;
      if (depth > policy.maxDepth) continue;
      visited.add(url);

      const step = await this._fetchOne(url, depth, policy);
      step.stepIndex = stepIndex++;
      result.steps.push(step);
      result.maxDepthReached = Math.max(result.maxDepthReached, depth);

      if (!step.success) continue;

      result.pagesFetched += 1;
      if (!result.finalUrl) {
        result.finalUrl = step.finalUrl;
        result.title = step.title;
        result.text = step.text;
        result.markdown = step.markdown;
      } else {
        if (step.text && result.text.length < policy.maxTextChars) {
          if (result.text) result.text += "\n\n";
          result.text += step.text;
          if (result.text.length > policy.maxTextChars) {
            result.text = `${result.text.slice(0, policy.maxTextChars)}...[truncated]`;
          }
        }
        if (step.markdown) {
          const mdCap = policy.maxMarkdownChars > 0 ? policy.maxMarkdownChars : policy.maxTextChars;
          if (result.markdown.length < mdCap) {
            if (result.markdown) result.markdown += "\n\n---\n\n";
            result.markdown += step.markdown;
            if (result.markdown.length > mdCap) {
              result.markdown = `${result.markdown.slice(0, mdCap)}\n\n...[truncated]\n`;
            }
          }
        }
      }
      result.links.push(...step.links);

      if (depth >= policy.maxDepth) continue;
      if (result.pagesFetched >= policy.maxPages) break;

      for (const link of step.links) {
        if (!link.absolute || visited.has(link.absolute)) continue;
        if (!urlAllowed(link.absolute, policy, originHost)) continue;
        if (visited.size + queue.length > policy.maxPages * 4) break;
        queue.push({ url: link.absolute, depth: depth + 1 });
      }
    }

    result.success = result.pagesFetched > 0;
    if (!result.success && !result.error) {
      if (result.steps.length) {
        result.error = result.steps[0].error || "no pages fetched successfully";
      } else {
        result.error = "explore produced no steps";
      }
    }
    result.metadata.visited = visited.size;
    return result;
  }
}

export async function webFetch(url, transport = null, policy = {}) {
  const explorer = new WebExplorer(transport);
  return explorer.fetch(url, policy);
}

export async function webExplore(startUrl, transport = null, policy = {}) {
  const explorer = new WebExplorer(transport);
  return explorer.explore(startUrl, policy);
}

export { resultToDict };
