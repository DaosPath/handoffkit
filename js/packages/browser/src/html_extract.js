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

// ASCII-only lowercase: unlike String#toLowerCase it never changes the string
// length, so indices found in the lowered copy are valid in the source.
function asciiLower(s) {
  return String(s ?? "").replace(/[A-Z]+/g, (m) => m.toLowerCase());
}

const HTML_SPACE = new Set([" ", "\t", "\n", "\r", "\f"]);
const OPEN_TAG_NAME_END = new Set([">", " ", "\t", "\n", "\r", "/"]);

// Equivalent of a regex `\b` right after a tag name (next char is not [a-z0-9_]).
function isTagNameBoundary(low, idx) {
  if (idx >= low.length) return true;
  const c = low.charCodeAt(idx);
  return !((c >= 48 && c <= 57) || (c >= 97 && c <= 122) || c === 95);
}

/**
 * Parse the attribute text of an open tag (everything between the tag name
 * and its `>`). Single linear pass, no regex backtracking. Names are
 * lowercased, the first occurrence wins, valueless attributes map to null.
 */
function parseTagAttributes(text) {
  const attrs = new Map();
  const s = String(text ?? "");
  const n = s.length;
  let i = 0;
  while (i < n) {
    while (i < n && (HTML_SPACE.has(s[i]) || s[i] === "/")) i++;
    if (i >= n) break;
    const nameStart = i;
    while (i < n && !HTML_SPACE.has(s[i]) && s[i] !== "/" && s[i] !== "=") i++;
    if (i === nameStart) {
      i++; // stray "=" without a name
      continue;
    }
    const name = asciiLower(s.slice(nameStart, i));
    let j = i;
    while (j < n && HTML_SPACE.has(s[j])) j++;
    let value = null;
    if (j < n && s[j] === "=") {
      j++;
      while (j < n && HTML_SPACE.has(s[j])) j++;
      const q = s[j];
      if (q === '"' || q === "'") {
        const close = s.indexOf(q, j + 1);
        value = close === -1 ? s.slice(j + 1) : s.slice(j + 1, close);
        j = close === -1 ? n : close + 1;
      } else {
        const valueStart = j;
        while (j < n && !HTML_SPACE.has(s[j])) j++;
        value = s.slice(valueStart, j);
      }
      i = j;
    }
    if (!attrs.has(name)) attrs.set(name, value);
  }
  return attrs;
}

/**
 * Next `<tag ...>` open tag at or after `from` (linear indexOf scan).
 * Returns {start, contentStart, attrs} or null. The tag ends at the first `>`.
 */
function nextOpenTag(source, low, tag, from) {
  const open = `<${tag}`;
  let pos = from;
  while (true) {
    const start = low.indexOf(open, pos);
    if (start === -1) return null;
    const nameEnd = start + open.length;
    if (!isTagNameBoundary(low, nameEnd)) {
      pos = start + 1;
      continue;
    }
    const gt = low.indexOf(">", nameEnd);
    if (gt === -1) return null;
    return { start, contentStart: gt + 1, attrs: parseTagAttributes(source.slice(nameEnd, gt)) };
  }
}

/**
 * Next end tag for `tag` at or after `from`: `</tag>` and also `</tag >`,
 * `</tag\t\n foo>` (what browsers accept). Returns {start, end} or null.
 */
function findCloseTag(low, tag, from) {
  const needle = `</${tag}`;
  let pos = from;
  while (true) {
    const i = low.indexOf(needle, pos);
    if (i === -1) return null;
    const j = i + needle.length;
    if (j >= low.length) return null;
    const c = low[j];
    if (c === ">") return { start: i, end: j + 1 };
    if (HTML_SPACE.has(c) || c === "/") {
      const gt = low.indexOf(">", j);
      return gt === -1 ? null : { start: i, end: gt + 1 };
    }
    pos = i + 1;
  }
}

function attrEquals(attrs, name, expected) {
  const value = attrs.get(name);
  return value != null && asciiLower(value.trim()) === expected;
}

// First `<meta>` whose name/property is one of `names` and that has content.
function metaContent(source, low, names) {
  let pos = 0;
  while (true) {
    const tag = nextOpenTag(source, low, "meta", pos);
    if (!tag) return null;
    pos = tag.contentStart;
    const content = tag.attrs.get("content");
    if (content == null) continue;
    if (names.some((name) => attrEquals(tag.attrs, "name", name) || attrEquals(tag.attrs, "property", name))) {
      return content;
    }
  }
}

/**
 * Every `<a ...>...</a>` carrying an href attribute, as {href, attrs, inner}.
 * Linear scan that replaces `<a\b[^>]*\bhref\s*=...[^>]*>([\s\S]*?)<\/a>`
 * regexes (polynomial backtracking on pathological markup). Anchors without
 * an href are skipped without consuming their content; an anchor without a
 * closing tag ends the scan (nothing after it could close either).
 */
export function scanHrefAnchors(html) {
  const source = String(html ?? "");
  const low = asciiLower(source);
  const out = [];
  let pos = 0;
  while (true) {
    const tag = nextOpenTag(source, low, "a", pos);
    if (!tag) break;
    pos = tag.contentStart;
    const href = tag.attrs.get("href");
    if (href == null) continue;
    const close = findCloseTag(low, "a", tag.contentStart);
    if (!close) break;
    pos = close.end;
    out.push({ href, attrs: tag.attrs, inner: source.slice(tag.contentStart, close.start) });
  }
  return out;
}

function stripTagsRegion(html, tag) {
  const s = String(html ?? "");
  const low = asciiLower(s);
  const open = `<${tag}`;
  const parts = [];
  let copyFrom = 0;
  let pos = 0;
  while (true) {
    const start = low.indexOf(open, pos);
    if (start === -1) break;
    const nameEnd = start + open.length;
    if (nameEnd < low.length && !OPEN_TAG_NAME_END.has(low[nameEnd])) {
      pos = start + 1;
      continue;
    }
    parts.push(s.slice(copyFrom, start));
    const close = findCloseTag(low, tag, nameEnd);
    if (!close) {
      copyFrom = s.length;
      break;
    }
    copyFrom = close.end;
    pos = close.end;
  }
  parts.push(s.slice(copyFrom));
  return parts.join("");
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
  const source = String(html ?? "");
  const low = asciiLower(source);
  let pos = 0;
  while (true) {
    const tag = nextOpenTag(source, low, "script", pos);
    if (!tag) break;
    pos = tag.contentStart;
    if (!attrEquals(tag.attrs, "type", "application/ld+json")) continue;
    const close = findCloseTag(low, "script", tag.contentStart);
    if (!close) break;
    pos = close.end;
    try {
      out.push(JSON.parse(decodeHtmlEntities(source.slice(tag.contentStart, close.start))));
    } catch {
      // Malformed JSON-LD is skipped, never invented.
    }
  }
  return out;
}

function canonicalHref(source, low) {
  let pos = 0;
  while (true) {
    const tag = nextOpenTag(source, low, "link", pos);
    if (!tag) return null;
    pos = tag.contentStart;
    const href = tag.attrs.get("href");
    if (href != null && attrEquals(tag.attrs, "rel", "canonical")) return href;
  }
}

export function extractPageMetadata(html, url = "") {
  const source = String(html ?? "");
  const low = asciiLower(source);
  const attr = (name) => {
    const content = metaContent(source, low, [name]);
    return content == null ? "" : decodeHtmlEntities(content);
  };
  const canonical = canonicalHref(source, low);
  const charsetMatch = /charset\s*=\s*["']?([a-z0-9-]+)/i.exec(source);
  return {
    title: extractTitle(source),
    description: attr("description") || attr("og:description"),
    canonical: canonical != null ? canonical : url,
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
  for (const { href, inner } of scanHrefAnchors(preferMainContent(String(html ?? "")))) {
    if (maxLinks > 0 && out.length >= maxLinks) break;
    const text = collapseWs(decodeHtmlEntities(extractText(inner, true, 200)));
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

// First open tag of any name carrying role="main" (linear scan).
function findRoleMainTag(source, low) {
  let pos = 0;
  while (true) {
    const lt = low.indexOf("<", pos);
    if (lt === -1) return null;
    let k = lt + 1;
    const first = low.charCodeAt(k);
    if (!(first >= 97 && first <= 122)) {
      pos = lt + 1;
      continue;
    }
    while (k < low.length && /[a-z0-9]/.test(low[k])) k++;
    if (!isTagNameBoundary(low, k)) {
      pos = lt + 1;
      continue;
    }
    const gt = low.indexOf(">", k);
    if (gt === -1) return null;
    if (attrEquals(parseTagAttributes(source.slice(k, gt)), "role", "main")) {
      return { tag: low.slice(lt + 1, k), gt };
    }
    pos = gt + 1;
  }
}

// Count `<a ...>` tags whose attribute text mentions href (linear scan).
function countAnchorsWithHref(html) {
  const low = asciiLower(html);
  let count = 0;
  let pos = 0;
  while (true) {
    const start = low.indexOf("<a", pos);
    if (start === -1) return count;
    const nameEnd = start + 2;
    if (!isTagNameBoundary(low, nameEnd)) {
      pos = start + 1;
      continue;
    }
    const gt = low.indexOf(">", nameEnd);
    if (low.slice(nameEnd, gt === -1 ? low.length : gt).includes("href")) count++;
    if (gt === -1) return count;
    pos = gt + 1;
  }
}

/**
 * Reader mode: isolate the main article and score extraction confidence.
 * Returns {title, byline, markdown, confidence, container, signals}.
 * Confidence is a 0..1 heuristic (landmark, title, byline, JSON-LD Article,
 * text length, link density) — not a correctness claim.
 */
export function extractReaderArticle(html, url = "") {
  const source = String(html ?? "");
  const low = asciiLower(source);
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
    const roleMatch = findRoleMainTag(source, low);
    if (roleMatch) {
      const { tag, gt } = roleMatch;
      const e = low.indexOf(`</${tag}>`, gt);
      if (gt !== -1 && e !== -1 && e > gt) {
        container = "role=main";
        inner = source.slice(gt + 1, e);
      }
    }
  }
  const title = extractTitle(source);
  const bylineContent = metaContent(source, low, ["author", "article:author"]);
  const byline = bylineContent != null ? decodeHtmlEntities(bylineContent).trim() : "";
  const jsonLd = extractJsonLd(source);
  const hasArticleSchema = jsonLd.some((node) => {
    const types = Array.isArray(node?.["@type"]) ? node["@type"] : [node?.["@type"]];
    return types.some((type) => ["Article", "NewsArticle", "BlogPosting", "ReportageNewsArticle"].includes(String(type ?? "")));
  });
  const markdown = htmlToMarkdown(inner || source, { baseUrl: url });
  const text = collapseWs(markdown.replace(/[#*`>\[\]()!-]/g, " "));
  const linkScope = inner || source;
  const linkCount = countAnchorsWithHref(linkScope);
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
