import { smartTruncate } from "./util.js";

/** Typed page markdown payload for agent handoffs. */
export class PageMarkdown {
  constructor({
    url = "",
    title = "",
    markdown = "",
    excerpt = "",
    text = "",
    links = [],
    fetchedAt = "",
    format = "markdown",
    blocked = false,
    error = "",
    markdownChars = 0,
    success = true,
  } = {}) {
    this.url = url;
    this.title = title;
    this.markdown = markdown;
    this.excerpt = excerpt || makeExcerpt(markdown || text);
    this.text = text;
    this.links = Array.isArray(links) ? links : [];
    this.fetchedAt = fetchedAt || new Date().toISOString();
    this.format = format;
    this.blocked = Boolean(blocked);
    this.error = error || "";
    this.markdownChars = markdownChars || (markdown ? markdown.length : 0);
    this.success = Boolean(success) && !this.blocked && !this.error;
  }

  toDict() {
    return {
      success: this.success,
      url: this.url,
      title: this.title,
      markdown: this.markdown,
      excerpt: this.excerpt,
      text: this.text,
      links: this.links.map((l) =>
        typeof l === "object"
          ? { href: l.href ?? "", absolute: l.absolute ?? "", text: l.text ?? "" }
          : { href: String(l), absolute: String(l), text: "" },
      ),
      fetched_at: this.fetchedAt,
      format: this.format,
      blocked: this.blocked,
      error: this.error,
      markdown_chars: this.markdownChars,
      text_chars: this.text?.length ?? 0,
    };
  }

  static fromDict(data = {}) {
    return new PageMarkdown({
      url: data.url,
      title: data.title,
      markdown: data.markdown,
      excerpt: data.excerpt,
      text: data.text,
      links: data.links,
      fetchedAt: data.fetched_at ?? data.fetchedAt,
      format: data.format,
      blocked: data.blocked,
      error: data.error,
      markdownChars: data.markdown_chars ?? data.markdownChars,
      success: data.success,
    });
  }

  static fromExploreResult(result, { maxChars = 60000, format = "markdown" } = {}) {
    let markdown = result?.markdown ?? "";
    if (format === "readme") {
      markdown = toReadmeMarkdown({
        title: result?.title,
        url: result?.finalUrl || result?.startUrl,
        markdown,
        links: result?.links,
      });
    }
    markdown = smartTruncate(markdown, maxChars);
    return new PageMarkdown({
      url: result?.finalUrl || result?.startUrl || "",
      title: result?.title || "",
      markdown,
      text: result?.text || "",
      links: result?.links || [],
      format,
      error: result?.success ? "" : result?.error || "fetch failed",
      success: Boolean(result?.success),
      blocked: Boolean(result?.metadata?.blocked),
    });
  }
}

export function makeExcerpt(text, max = 320) {
  const clean = String(text ?? "")
    .replace(/^#+\s.*$/gm, "")
    .replace(/Source:\s+\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 3).trimEnd()}...`;
}

export function toReadmeMarkdown({ title = "", url = "", markdown = "", links = [] } = {}) {
  const body = String(markdown ?? "");
  const headings = [...body.matchAll(/^#{1,3}\s+(.+)$/gm)].map((m) => m[1].trim()).slice(0, 12);
  const lines = [];
  lines.push(`# ${title || "Untitled page"}`);
  lines.push("");
  if (url) {
    lines.push(`Source: ${url}`);
    lines.push("");
  }
  if (headings.length) {
    lines.push("## Contents");
    lines.push("");
    for (const h of headings) lines.push(`- ${h}`);
    lines.push("");
  }
  // strip duplicate leading title/source if already present
  let rest = body;
  rest = rest.replace(/^#\s+.*\n+/, "");
  rest = rest.replace(/^Source:\s+\S+\n+/, "");
  lines.push(rest.trim());
  if (links?.length && !rest.includes("## Links")) {
    lines.push("");
    lines.push("## Links");
    lines.push("");
    for (const l of links.slice(0, 40)) {
      const u = l.absolute || l.href || "";
      if (!u) continue;
      lines.push(`- [${l.text || u}](${u})`);
    }
  }
  return `${lines.join("\n").trim()}\n`;
}
