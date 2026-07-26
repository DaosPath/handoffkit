"""First-party HTML → text/markdown (no Cheerio/BeautifulSoup)."""

from __future__ import annotations

import html
import re
from typing import Any

from handoffkit.browser.types import ExtractedLink, resolve_url

_TAG_RE = re.compile(r"<[^>]+>", re.I)
_SCRIPT_RE = re.compile(r"<script\b[^>]*>[\s\S]*?</script>", re.I)
_STYLE_RE = re.compile(r"<style\b[^>]*>[\s\S]*?</style>", re.I)
_NOSCRIPT_RE = re.compile(r"<noscript\b[^>]*>[\s\S]*?</noscript>", re.I)
_TITLE_RE = re.compile(r"<title\b[^>]*>([\s\S]*?)</title>", re.I)
_A_RE = re.compile(r"<a\b([^>]*)>([\s\S]*?)</a>", re.I)
_HREF_RE = re.compile(r"""href\s*=\s*["']([^"']+)["']""", re.I)
_BLOCK_RE = re.compile(
    r"</?(?:p|div|br|li|h[1-6]|tr|table|section|article|header|footer|nav|main|blockquote|pre|ul|ol)\b[^>]*>",
    re.I,
)
_HEADING_RE = re.compile(r"<h([1-6])\b[^>]*>([\s\S]*?)</h\1>", re.I)
_P_RE = re.compile(r"<p\b[^>]*>([\s\S]*?)</p>", re.I)
_LI_RE = re.compile(r"<li\b[^>]*>([\s\S]*?)</li>", re.I)
_MAIN_RE = re.compile(r"<main\b[^>]*>([\s\S]*?)</main>", re.I)
_ARTICLE_RE = re.compile(r"<article\b[^>]*>([\s\S]*?)</article>", re.I)
_WS_RE = re.compile(r"[ \t\f\v]+")
_NL_RE = re.compile(r"\n{3,}")


def _decode(s: str) -> str:
    return html.unescape(s or "")


def _strip_tags(s: str) -> str:
    return _TAG_RE.sub("", s or "")


def _clean_text(s: str) -> str:
    t = _decode(_strip_tags(s))
    t = _WS_RE.sub(" ", t)
    t = _NL_RE.sub("\n\n", t)
    return t.strip()


def strip_noise(html_src: str, *, strip_scripts_styles: bool = True) -> str:
    out = html_src or ""
    if strip_scripts_styles:
        out = _SCRIPT_RE.sub("", out)
        out = _STYLE_RE.sub("", out)
        out = _NOSCRIPT_RE.sub("", out)
    return out


def prefer_main_content(html_src: str) -> str:
    src = html_src or ""
    for pattern in (_MAIN_RE, _ARTICLE_RE):
        m = pattern.search(src)
        if m and len(m.group(1)) > 80:
            return m.group(1)
    return src


def extract_title(html_src: str) -> str:
    m = _TITLE_RE.search(html_src or "")
    return _clean_text(m.group(1)) if m else ""


def extract_links(
    html_src: str, base_url: str = "", *, max_links: int = 100
) -> list[ExtractedLink]:
    out: list[ExtractedLink] = []
    seen: set[str] = set()
    for m in _A_RE.finditer(html_src or ""):
        attrs, inner = m.group(1), m.group(2)
        hm = _HREF_RE.search(attrs or "")
        if not hm:
            continue
        href = hm.group(1).strip()
        absolute = resolve_url(base_url, href)
        if not absolute or absolute in seen:
            continue
        seen.add(absolute)
        out.append(ExtractedLink(href=href, absolute=absolute, text=_clean_text(inner)[:200]))
        if max_links > 0 and len(out) >= max_links:
            break
    return out


def extract_text(
    html_src: str, *, max_chars: int = 50000, strip_scripts_styles: bool = True
) -> str:
    body = prefer_main_content(strip_noise(html_src, strip_scripts_styles=strip_scripts_styles))
    body = _BLOCK_RE.sub("\n", body)
    text = _clean_text(body)
    if max_chars > 0 and len(text) > max_chars:
        text = text[:max_chars] + "…"
    return text


def html_to_markdown(
    html_src: str,
    *,
    base_url: str = "",
    max_chars: int = 60000,
    strip_scripts_styles: bool = True,
    prefer_main: bool = True,
) -> str:
    body = strip_noise(html_src, strip_scripts_styles=strip_scripts_styles)
    if prefer_main:
        body = prefer_main_content(body)
    title = extract_title(html_src)
    links = extract_links(html_src, base_url, max_links=40)
    parts: list[str] = []
    if title:
        parts.append(f"# {title}\n")
    if base_url:
        parts.append(f"Source: {base_url}\n")

    # headings
    def heading_repl(m: re.Match[str]) -> str:
        level = int(m.group(1))
        text = _clean_text(m.group(2))
        return f"\n{'#' * level} {text}\n" if text else "\n"

    work = _HEADING_RE.sub(heading_repl, body)

    def p_repl(m: re.Match[str]) -> str:
        text = _clean_text(m.group(1))
        return f"\n\n{text}\n\n" if text else "\n"

    work = _P_RE.sub(p_repl, work)

    def li_repl(m: re.Match[str]) -> str:
        text = _clean_text(m.group(1))
        return f"\n- {text}" if text else ""

    work = _LI_RE.sub(li_repl, work)

    # links as markdown
    def a_repl(m: re.Match[str]) -> str:
        attrs, inner = m.group(1), m.group(2)
        hm = _HREF_RE.search(attrs or "")
        text = _clean_text(inner) or "link"
        if not hm:
            return text
        abs_url = resolve_url(base_url, hm.group(1).strip())
        return f"[{text}]({abs_url})" if abs_url else text

    work = _A_RE.sub(a_repl, work)
    work = _BLOCK_RE.sub("\n", work)
    md = _clean_text(work)
    if parts:
        md = "\n".join(parts) + "\n" + md
    if links:
        link_lines = ["", "## Links", ""]
        for link in links[:40]:
            u = link.absolute or link.href
            label = link.text or u
            link_lines.append(f"- [{label}]({u})")
        md = md.rstrip() + "\n" + "\n".join(link_lines) + "\n"
    if max_chars > 0 and len(md) > max_chars:
        from handoffkit.browser.util import smart_truncate

        md = smart_truncate(md, max_chars)
    return md.strip()


def extract_page(
    html_src: str,
    *,
    base_url: str = "",
    max_text_chars: int = 50000,
    max_markdown_chars: int = 60000,
    max_links: int = 100,
    strip_scripts_styles: bool = True,
    emit_markdown: bool = True,
) -> dict[str, Any]:
    title = extract_title(html_src)
    text = extract_text(
        html_src,
        max_chars=max_text_chars,
        strip_scripts_styles=strip_scripts_styles,
    )
    links = extract_links(html_src, base_url, max_links=max_links)
    markdown = (
        html_to_markdown(
            html_src,
            base_url=base_url,
            max_chars=max_markdown_chars,
            strip_scripts_styles=strip_scripts_styles,
        )
        if emit_markdown
        else ""
    )
    return {
        "title": title,
        "text": text,
        "markdown": markdown,
        "links": links,
    }
