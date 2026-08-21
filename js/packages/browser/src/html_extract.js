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
  const s = String(html ?? "");
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
