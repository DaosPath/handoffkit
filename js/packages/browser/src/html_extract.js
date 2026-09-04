import { ExplorePolicy, resolveUrl } from "./types.js";

function lower(s) {
  return String(s ?? "").toLowerCase();
}

function collapseWs(s) {
  let out = "";
  let sp = false;
  for (const c of String(s ?? "")) {
    if (c === "\r") continue;
    if (c === "\n" || c === "\t" || c === " ") {
      if (!sp && out) {
        out += " ";
        sp = true;
      }
      continue;
    }
    out += c;
    sp = false;
  }
  return out.trimEnd();
}

function stripTagsRegion(html, tag) {
  const open = `<${tag}`;
  const close = `</${tag}>`;
  let s = String(html ?? "");
  let low = lower(s);
  let pos = 0;
  while (true) {
    const start = low.indexOf(open, pos);
    if (start === -1) break;
    if (start + open.length < low.length) {
      const next = low[start + open.length];
      if (next !== ">" && next !== " " && next !== "\t" && next !== "\n" && next !== "\r" && next !== "/") {
        pos = start + 1;
        continue;
      }
    }
    let end = low.indexOf(close, start);
    if (end === -1) {
      s = s.slice(0, start);
      low = low.slice(0, start);
      break;
    }
    end += close.length;
    s = s.slice(0, start) + s.slice(end);
    low = low.slice(0, start) + low.slice(end);
    pos = start;
  }
  return s;
}

// Remove common advertising/consent chrome before article selection. This is
// intentionally selector-free and bounded: it only targets container tags
// whose id/class/role/aria-label explicitly names ad or promotional UI.
function stripMarkedNoise(html) {
  let s = String(html ?? "");
  const markerRe = /(?:^|[\s_-])(?:ad|ads|advert|advertisement|sponsored|promoted|promo|commercial|cookie|consent|newsletter|subscribe|paywall|popup|modal|banner)(?:$|[\s_-])/i;
  const re = /<(div|section|aside|span|form|li|table)\b([^>]*)>[\s\S]*?<\/\1>/gi;
  // Nested ad containers are common; a few passes remove inner and outer
  // wrappers without trying to implement a full HTML parser.
  for (let i = 0; i < 3; i++) {
    const next = s.replace(re, (whole, _tag, attrs) =>
      markerRe.test(String(attrs ?? "").replace(/[\"']/g, " ")) ? "" : whole,
    );
    if (next === s) break;
    s = next;
  }
  return s;
}

export function decodeHtmlEntities(input) {
  const s = String(input ?? "");
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== "&") {
      out += s[i];
      continue;
    }
    const semi = s.indexOf(";", i + 1);
    if (semi === -1 || semi - i > 32) {
      out += "&";
      continue;
    }
    const ent = s.slice(i + 1, semi);
    const low = lower(ent);
    if (low === "amp") out += "&";
    else if (low === "lt") out += "<";
    else if (low === "gt") out += ">";
    else if (low === "quot") out += '"';
    else if (low === "apos" || low === "#39") out += "'";
    else if (low === "nbsp") out += " ";
    else if (ent.startsWith("#")) {
      let code = 0;
      try {
        if (ent[1] === "x" || ent[1] === "X") code = Number.parseInt(ent.slice(2), 16);
        else code = Number.parseInt(ent.slice(1), 10);
      } catch {
        code = 0;
      }
      if (code > 0 && code < 128) out += String.fromCharCode(code);
      else if (code >= 128) out += "?";
      else {
        out += `&${ent};`;
        i = semi;
        continue;
      }
    } else {
      out += `&${ent};`;
      i = semi;
      continue;
    }
    i = semi;
  }
  return out;
}

export function htmlTableToMarkdown(html) {
  const source = String(html ?? "");
  const rows = [];
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRe.exec(source)) !== null) {
    const cells = [];
    const cellRe = /<(td|th)\b[^>]*>([\s\S]*?)<\/\1>/gi;
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowMatch[1] ?? "")) !== null) {
      cells.push(collapseWs(decodeHtmlEntities(extractText(cellMatch[2] ?? "", true, 400))));
    }
    if (cells.length) rows.push(cells);
  }
  if (!rows.length) return "";
  const width = Math.max(...rows.map((row) => row.length));
  const padded = rows.map((row) => {
    const next = [...row];
    while (next.length < width) next.push("");
    return next;
  });
  const header = padded[0];
  const lines = [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...padded.slice(1).map((row) => `| ${row.join(" | ")} |`),
  ];
  return `${lines.join("\n")}\n`;
}

export function extractJsonLd(html) {
  const out = [];
  const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const source = String(html ?? "");
  let match;
  while ((match = re.exec(source)) !== null) {
    try {
      out.push(JSON.parse(decodeHtmlEntities(match[1] ?? "")));
    } catch {
      // Malformed JSON-LD is skipped, never invented.
    }
  }
  return out;
}

export function extractPageMetadata(html, url = "") {
  const source = String(html ?? "");
  const attr = (name) => {
    const re = new RegExp(`<meta\\b[^>]*(?:name|property)\\s*=\\s*["']${name}["'][^>]*content\\s*=\\s*["']([^"']*)["']`, "i");
    const match = re.exec(source);
    return match ? decodeHtmlEntities(match[1]) : "";
  };
  const canonicalMatch = /<link\b[^>]*rel\s*=\s*["']canonical["'][^>]*href\s*=\s*["']([^"']*)["']/i.exec(source)
    || /<link\b[^>]*href\s*=\s*["']([^"']*)["'][^>]*rel\s*=\s*["']canonical["']/i.exec(source);
  const charsetMatch = /charset\s*=\s*["']?([a-z0-9-]+)/i.exec(source);
  return {
    title: extractTitle(source),
    description: attr("description") || attr("og:description"),
    canonical: canonicalMatch ? canonicalMatch[1] : url,
    charset: charsetMatch ? charsetMatch[1].toLowerCase() : "",
    json_ld: extractJsonLd(source),
  };
}

export function extractTitle(html) {
  const low = lower(html);
  const start = low.indexOf("<title");
  if (start === -1) return "";
  const gt = low.indexOf(">", start);
  if (gt === -1) return "";
  const end = low.indexOf("</title>", gt);
  if (end === -1) return "";
  return collapseWs(decodeHtmlEntities(String(html).slice(gt + 1, end)));
}

/** Prefer article/main and drop chrome (nav/footer/aside/header). */
export function preferMainContent(html) {
  let s = String(html ?? "");
  s = stripMarkedNoise(s);
  s = stripTagsRegion(s, "script");
  s = stripTagsRegion(s, "style");
  s = stripTagsRegion(s, "noscript");
  s = stripTagsRegion(s, "svg");
  s = stripTagsRegion(s, "nav");
  s = stripTagsRegion(s, "footer");
  s = stripTagsRegion(s, "aside");
  // keep first header only if no article/main — strip site chrome headers loosely
  const low = lower(s);
  for (const tag of ["article", "main"]) {
    const b = low.indexOf(`<${tag}`);
    if (b === -1) continue;
    const gt = low.indexOf(">", b);
    const e = low.indexOf(`</${tag}>`, gt === -1 ? b : gt);
    if (gt !== -1 && e !== -1 && e > gt) {
      const title = extractTitle(html);
      const inner = s.slice(gt + 1, e);
      return title ? `<html><head><title>${title}</title></head><body>${inner}</body></html>` : inner;
    }
  }
  const bodyIdx = low.indexOf("<body");
  if (bodyIdx !== -1) {
    const gt = low.indexOf(">", bodyIdx);
    const e = low.indexOf("</body>", gt === -1 ? bodyIdx : gt);
    if (gt !== -1 && e !== -1 && e > gt) {
      let inner = s.slice(gt + 1, e);
      inner = stripTagsRegion(inner, "header");
      const title = extractTitle(html);
      return title ? `<html><head><title>${title}</title></head><body>${inner}</body></html>` : inner;
    }
  }
  return s;
}

export function extractText(html, stripScriptsStyles = true, maxChars = 50000) {
  let s = preferMainContent(html);
  if (!stripScriptsStyles) {
    // preferMainContent already stripped scripts; keep as-is
  }
  let text = "";
  let inTag = false;
  for (const c of s) {
    if (c === "<") {
      inTag = true;
      continue;
    }
    if (c === ">") {
      inTag = false;
      text += " ";
      continue;
    }
    if (!inTag) text += c;
  }
  text = collapseWs(decodeHtmlEntities(text));
  if (maxChars > 0 && text.length > maxChars) {
    text = `${text.slice(0, maxChars)}...[truncated]`;
  }
  return text;
}

function attrValue(openTag, attr) {
  const low = lower(openTag);
  const key = `${lower(attr)}=`;
  let pos = low.indexOf(key);
  if (pos === -1) return "";
  pos += key.length;
  if (pos >= openTag.length) return "";
  const q = openTag[pos];
  if (q === '"' || q === "'") {
    const end = openTag.indexOf(q, pos + 1);
    if (end === -1) return "";
    return openTag.slice(pos + 1, end);
  }
  let end = pos;
  while (end < openTag.length && openTag[end] !== " " && openTag[end] !== ">" && openTag[end] !== "\t") {
    end++;
  }
  return openTag.slice(pos, end);
}

export function extractLinks(html, baseUrl = "", maxLinks = 100) {
  const out = [];
  const re = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
  const s = preferMainContent(String(html ?? ""));
  let m;
  while ((m = re.exec(s)) !== null) {
    if (maxLinks > 0 && out.length >= maxLinks) break;
    const href = m[1] ?? m[2] ?? m[3] ?? "";
    const text = collapseWs(decodeHtmlEntities(extractText(m[4] ?? "", true, 200)));
    let absolute = resolveUrl(baseUrl, href);
    if (!absolute && href.includes("://")) absolute = href;
    out.push({ href, absolute, text });
  }
  return out;
}

/**
 * First-party HTML → Markdown (good enough for agent context / README-style dumps).
 */
export function htmlToMarkdown(html, opts = {}) {
  const options = {
    baseUrl: opts.baseUrl ?? opts.base_url ?? "",
    stripScriptsStyles: opts.stripScriptsStyles ?? opts.strip_scripts_styles ?? true,
    maxChars: opts.maxChars ?? opts.max_chars ?? 60000,
    includeSourceHeader: opts.includeSourceHeader ?? opts.include_source_header ?? true,
    includeLinksSection: opts.includeLinksSection ?? opts.include_links_section ?? true,
    maxLinks: opts.maxLinks ?? opts.max_links ?? 100,
    preferMain: opts.preferMain ?? opts.prefer_main ?? true,
  };

  const originalHtml = String(html ?? "");
  let s = options.preferMain ? preferMainContent(originalHtml) : originalHtml;
  if (options.stripScriptsStyles && !options.preferMain) {
    s = stripTagsRegion(s, "script");
    s = stripTagsRegion(s, "style");
    s = stripTagsRegion(s, "noscript");
    s = stripTagsRegion(s, "svg");
  }

  const title = extractTitle(originalHtml) || extractTitle(s);
  {
    const low = lower(s);
    const b = low.indexOf("<body");
    if (b !== -1) {
      const gt = low.indexOf(">", b);
      const e = low.indexOf("</body>", gt === -1 ? b : gt);
      if (gt !== -1 && e !== -1 && e > gt) s = s.slice(gt + 1, e);
    }
  }

  let md = "";
  if (options.includeSourceHeader) {
    if (title) md += `# ${title}\n\n`;
    if (options.baseUrl) md += `Source: ${options.baseUrl}\n\n`;
  }

  const low = lower(s);
  let lineBuf = "";
  const flushLine = () => {
    const t = collapseWs(lineBuf);
    lineBuf = "";
    if (t) md += `${t}\n\n`;
  };

  for (let i = 0; i < s.length; ) {
    if (s[i] !== "<") {
      const next = s.indexOf("<", i);
      let chunk = s.slice(i, next === -1 ? s.length : next);
      chunk = decodeHtmlEntities(chunk).replace(/[\n\r\t]/g, " ");
      lineBuf += chunk;
      i = next === -1 ? s.length : next;
      continue;
    }
    const gt = s.indexOf(">", i);
    if (gt === -1) break;
    const tag = s.slice(i, gt + 1);
    const tagLow = lower(tag);
    const isClose = tagLow.length >= 2 && tagLow[1] === "/";
    let nameStart = isClose ? 2 : 1;
    let nameEnd = nameStart;
    while (nameEnd < tagLow.length && /[a-z0-9]/.test(tagLow[nameEnd])) nameEnd++;
    const name = tagLow.slice(nameStart, nameEnd);

    if (name === "br" || name === "hr") {
      flushLine();
      if (name === "hr") md += "---\n\n";
      i = gt + 1;
      continue;
    }
    if (["p", "div", "section", "article", "header", "footer", "main", "tr"].includes(name)) {
      flushLine();
      i = gt + 1;
      continue;
    }
    if (!isClose && /^h[1-6]$/.test(name)) {
      flushLine();
      const level = Number(name[1]) || 2;
      const close = low.indexOf(`</${name}>`, gt);
      if (close === -1) {
        i = gt + 1;
        continue;
      }
      const inner = extractText(s.slice(gt + 1, close), true, 2000);
      md += `${"#".repeat(level)} ${inner}\n\n`;
      i = close + 3 + name.length;
      continue;
    }
    if (!isClose && name === "li") {
      flushLine();
      const close = low.indexOf("</li>", gt);
      if (close === -1) {
        i = gt + 1;
        continue;
      }
      const inner = extractText(s.slice(gt + 1, close), true, 2000);
      md += `- ${inner}\n`;
      i = close + 5;
      continue;
    }
    if (!isClose && (name === "ul" || name === "ol")) {
      flushLine();
      i = gt + 1;
      continue;
    }
    if (isClose && (name === "ul" || name === "ol")) {
      md += "\n";
      i = gt + 1;
      continue;
    }
    if (!isClose && name === "blockquote") {
      flushLine();
      const close = low.indexOf("</blockquote>", gt);
      if (close === -1) {
        i = gt + 1;
        continue;
      }
      const inner = extractText(s.slice(gt + 1, close), true, 4000);
      md += `> ${inner}\n\n`;
      i = close + 13;
      continue;
    }
    if (!isClose && (name === "pre" || name === "code")) {
      const closeTag = `</${name}>`;
      const close = low.indexOf(closeTag, gt);
      if (close === -1) {
        i = gt + 1;
        continue;
      }
      let inner = decodeHtmlEntities(s.slice(gt + 1, close));
      inner = extractText(inner, true, 20000);
      if (name === "pre" || inner.includes("\n")) {
        flushLine();
        md += `\`\`\`\n${inner}\n\`\`\`\n\n`;
      } else {
        lineBuf += `\`${collapseWs(inner)}\``;
      }
      i = close + closeTag.length;
      continue;
    }
    if (!isClose && name === "a") {
      const href = attrValue(tag, "href");
      const close = low.indexOf("</a>", gt);
      if (close === -1) {
        i = gt + 1;
        continue;
      }
      let inner = collapseWs(decodeHtmlEntities(extractText(s.slice(gt + 1, close), true, 500)));
      let abs = resolveUrl(options.baseUrl, href);
      if (!abs) abs = href;
      if (!inner) inner = abs;
      lineBuf += abs ? `[${inner}](${abs})` : inner;
      i = close + 4;
      continue;
    }
    if (!isClose && name === "table") {
      const close = low.indexOf("</table>", gt);
      if (close === -1) {
        i = gt + 1;
        continue;
      }
      flushLine();
      md += `${htmlTableToMarkdown(s.slice(i, close + 8))}\n`;
      i = close + 8;
      continue;
    }
    if (!isClose && name === "img") {
      const src = attrValue(tag, "src");
      const alt = attrValue(tag, "alt");
      let abs = resolveUrl(options.baseUrl, src);
      if (!abs) abs = src;
      if (abs) {
        flushLine();
        md += `![${alt}](${abs})\n\n`;
      }
      i = gt + 1;
      continue;
    }
    if (!isClose && (name === "strong" || name === "b")) {
      let close = low.indexOf(name === "b" ? "</b>" : "</strong>", gt);
      if (close === -1) close = low.indexOf(name === "b" ? "</strong>" : "</b>", gt);
      if (close === -1) {
        i = gt + 1;
        continue;
      }
      const closeLen = low.startsWith("</b>", close) ? 4 : 9;
      const inner = collapseWs(decodeHtmlEntities(extractText(s.slice(gt + 1, close), true, 500)));
      lineBuf += `**${inner}**`;
      i = close + closeLen;
      continue;
    }
    if (!isClose && (name === "em" || name === "i")) {
      let close = low.indexOf(name === "i" ? "</i>" : "</em>", gt);
      if (close === -1) close = low.indexOf(name === "i" ? "</em>" : "</i>", gt);
      if (close === -1) {
        i = gt + 1;
        continue;
      }
      const closeLen = low.startsWith("</em>", close) ? 5 : 4;
      const inner = collapseWs(decodeHtmlEntities(extractText(s.slice(gt + 1, close), true, 500)));
      lineBuf += `*${inner}*`;
      i = close + closeLen;
      continue;
    }
    i = gt + 1;
  }
  flushLine();

  if (options.includeLinksSection) {
    const links = extractLinks(originalHtml, options.baseUrl, options.maxLinks);
    if (links.length) {
      md += "## Links\n\n";
      for (const l of links) {
        const u = l.absolute || l.href;
        if (!u) continue;
        const label = l.text || u;
        md += `- [${label}](${u})\n`;
      }
      md += "\n";
    }
  }

  let compact = "";
  let blank = 0;
  for (const c of md) {
    if (c === "\n") {
      blank++;
      if (blank <= 2) compact += "\n";
    } else {
      blank = 0;
      compact += c;
    }
  }
  if (options.maxChars > 0 && compact.length > options.maxChars) {
    const cut = compact.slice(0, options.maxChars);
    const lastHeading = Math.max(cut.lastIndexOf("\n## "), cut.lastIndexOf("\n# "));
    const lastPara = cut.lastIndexOf("\n\n");
    let end = options.maxChars;
    if (lastHeading > options.maxChars * 0.5) end = lastHeading;
    else if (lastPara > options.maxChars * 0.6) end = lastPara;
    compact = `${cut.slice(0, end).trimEnd()}\n\n...[truncated]\n`;
  }
  return compact;
}

export function pageHtmlToMarkdown(url, html, policy = {}) {
  const p = policy instanceof ExplorePolicy ? policy : new ExplorePolicy(policy);
  return htmlToMarkdown(html, {
    baseUrl: url,
    stripScriptsStyles: p.stripScriptsStyles,
    maxChars: p.maxMarkdownChars > 0 ? p.maxMarkdownChars : p.maxTextChars,
    includeSourceHeader: true,
    includeLinksSection: p.extractLinks,
    maxLinks: p.maxLinksPerPage,
  });
}

export function extractPage(url, html, policy = {}) {
  const p = policy instanceof ExplorePolicy ? policy : new ExplorePolicy(policy);
  const page = {
    url: String(url ?? ""),
    title: "",
    text: "",
    markdown: "",
    links: [],
    rawBodyBytes: String(html ?? "").length,
  };
  if (p.extractTitle) page.title = extractTitle(html);
  if (p.extractText) page.text = extractText(html, p.stripScriptsStyles, p.maxTextChars);
  if (p.extractLinks) page.links = extractLinks(html, url, p.maxLinksPerPage);
  if (p.emitMarkdown) page.markdown = pageHtmlToMarkdown(url, html, p);
  return page;
}

/**
 * Reader mode: isolate the main article and score extraction confidence.
 * Returns {title, byline, markdown, confidence, container, signals}.
 * Confidence is a 0..1 heuristic (landmark, title, byline, JSON-LD Article,
 * text length, link density) — not a correctness claim.
 */
export function extractReaderArticle(html, url = "") {
  const source = String(html ?? "");
  const low = lower(source);
  let container = "body";
  let inner = "";
  for (const [tag, label] of [["article", "article"], ["main", "main"]]) {
    const b = low.indexOf(`<${tag}`);
    if (b === -1) continue;
    const gt = low.indexOf(">", b);
    const e = low.indexOf(`</${tag}>`, gt === -1 ? b : gt);
    if (gt !== -1 && e !== -1 && e > gt) {
      container = label;
      inner = source.slice(gt + 1, e);
      break;
    }
  }
  if (!inner) {
    const roleMatch = /<([a-z][a-z0-9]*)\b[^>]*\brole\s*=\s*["']main["'][^>]*>/i.exec(source);
    if (roleMatch) {
      const tag = roleMatch[1].toLowerCase();
      const gt = source.indexOf(">", roleMatch.index);
      const e = low.indexOf(`</${tag}>`, gt);
      if (gt !== -1 && e !== -1 && e > gt) {
        container = "role=main";
        inner = source.slice(gt + 1, e);
      }
    }
  }
  const title = extractTitle(source);
  const bylineMatch = /<meta\b[^>]*(?:name|property)\s*=\s*["'](?:author|article:author)["'][^>]*content\s*=\s*["']([^"']*)["']/i.exec(source);
  const byline = bylineMatch ? decodeHtmlEntities(bylineMatch[1]).trim() : "";
  const jsonLd = extractJsonLd(source);
  const hasArticleSchema = jsonLd.some((node) => {
    const types = Array.isArray(node?.["@type"]) ? node["@type"] : [node?.["@type"]];
    return types.some((type) => ["Article", "NewsArticle", "BlogPosting", "ReportageNewsArticle"].includes(String(type ?? "")));
  });
  const markdown = htmlToMarkdown(inner || source, { baseUrl: url });
  const text = collapseWs(markdown.replace(/[#*`>\[\]()!-]/g, " "));
  const linkScope = inner || source;
  const linkCount = (linkScope.match(/<a\b[^>]*href/gi) || []).length;
  const linkDensity = text.length ? linkCount / Math.max(text.split(" ").length, 1) : 1;
  const signals = [];
  let score = 0;
  const add = (points, label, met) => {
    signals.push({ signal: label, met: Boolean(met) });
    if (met) score += points;
  };
  add(0.25, "article_landmark", container !== "body");
  add(0.2, "title_present", title.length > 0);
  add(0.1, "byline_present", byline.length > 0);
  add(0.15, "json_ld_article", hasArticleSchema);
  add(0.15, "text_length", text.length >= 500);
  add(0.15, "low_link_density", linkDensity < 0.2);
  return {
    title,
    byline,
    markdown,
    confidence: Math.round(Math.min(score, 1) * 100) / 100,
    container,
    signals,
  };
}
