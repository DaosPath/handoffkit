"""First-party HTML → text/markdown (no Cheerio/BeautifulSoup)."""

from __future__ import annotations

import html
import json
import re
import string
from collections.abc import Iterator
from typing import Any

from handoffkit.browser.types import ExtractedLink, resolve_url

_MARKED_NOISE_RE = re.compile(
    r"<(div|section|aside|span|form|li|table)\b([^>]*)>[\s\S]*?</\1>", re.I
)
_NOISE_MARKER_RE = re.compile(
    r"(?:^|[\s_-])(?:ad|ads|advert|advertisement|sponsored|promoted|promo|commercial|"
    r"cookie|consent|newsletter|subscribe|paywall|popup|modal|banner)(?:$|[\s_-])",
    re.I,
)
_TITLE_RE = re.compile(r"<title\b[^>]*>([\s\S]*?)</title>", re.I)
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


# --- linear tag scanning ----------------------------------------------------
# Regexes like ``<meta\b[^>]*name=...[^>]*content=...`` backtrack polynomially
# on pathological input (CodeQL polynomial-redos), and ``</script>`` literals
# miss end tags such as ``</script >`` (CodeQL bad-tag-filter). These helpers
# scan with str.find in one pass and mirror js/packages/browser/src/html_extract.js.

_ASCII_LOWER = str.maketrans(string.ascii_uppercase, string.ascii_lowercase)
_HTML_SPACE = " \t\n\r\f"
_OPEN_TAG_NAME_END = ">/ \t\n\r"


def _ascii_lower(s: str) -> str:
    """Lowercase ASCII only so indices stay aligned with the source string."""
    return (s or "").translate(_ASCII_LOWER)


def _is_tag_name_boundary(low: str, idx: int) -> bool:
    """Equivalent of a regex ``\\b`` right after a tag name (next char not [a-z0-9_])."""
    if idx >= len(low):
        return True
    c = low[idx]
    return not ("0" <= c <= "9" or "a" <= c <= "z" or c == "_")


def _parse_tag_attributes(text: str) -> dict[str, str | None]:
    """Parse an open tag's attribute text in one pass; first occurrence wins."""
    attrs: dict[str, str | None] = {}
    s = text or ""
    n = len(s)
    i = 0
    while i < n:
        while i < n and (s[i] in _HTML_SPACE or s[i] == "/"):
            i += 1
        if i >= n:
            break
        name_start = i
        while i < n and s[i] not in _HTML_SPACE and s[i] != "/" and s[i] != "=":
            i += 1
        if i == name_start:
            i += 1  # stray "=" without a name
            continue
        name = _ascii_lower(s[name_start:i])
        j = i
        while j < n and s[j] in _HTML_SPACE:
            j += 1
        value: str | None = None
        if j < n and s[j] == "=":
            j += 1
            while j < n and s[j] in _HTML_SPACE:
                j += 1
            q = s[j] if j < n else ""
            if q in ('"', "'"):
                close = s.find(q, j + 1)
                value = s[j + 1 :] if close == -1 else s[j + 1 : close]
                j = n if close == -1 else close + 1
            else:
                value_start = j
                while j < n and s[j] not in _HTML_SPACE:
                    j += 1
                value = s[value_start:j]
            i = j
        attrs.setdefault(name, value)
    return attrs


def _next_open_tag(
    source: str, low: str, tag: str, start: int
) -> tuple[int, int, dict[str, str | None]] | None:
    """Next ``<tag ...>`` at or after ``start`` -> (tag_start, content_start, attrs)."""
    needle = f"<{tag}"
    pos = start
    while True:
        begin = low.find(needle, pos)
        if begin == -1:
            return None
        name_end = begin + len(needle)
        if not _is_tag_name_boundary(low, name_end):
            pos = begin + 1
            continue
        gt = low.find(">", name_end)
        if gt == -1:
            return None
        return begin, gt + 1, _parse_tag_attributes(source[name_end:gt])


def _find_close_tag(low: str, tag: str, start: int) -> tuple[int, int] | None:
    """Next end tag: ``</tag>``, ``</tag >`` or ``</tag\\t\\n foo>`` -> (start, end)."""
    needle = f"</{tag}"
    pos = start
    while True:
        i = low.find(needle, pos)
        if i == -1:
            return None
        j = i + len(needle)
        if j >= len(low):
            return None
        c = low[j]
        if c == ">":
            return i, j + 1
        if c in _HTML_SPACE or c == "/":
            gt = low.find(">", j)
            return None if gt == -1 else (i, gt + 1)
        pos = i + 1


def _attr_equals(attrs: dict[str, str | None], name: str, expected: str) -> bool:
    value = attrs.get(name)
    return value is not None and _ascii_lower(value.strip()) == expected


def _meta_content(source: str, low: str, names: tuple[str, ...]) -> str | None:
    """Content of the first ``<meta>`` whose name/property is one of ``names``."""
    pos = 0
    while True:
        found = _next_open_tag(source, low, "meta", pos)
        if found is None:
            return None
        _, pos, attrs = found
        content = attrs.get("content")
        if content is None:
            continue
        if any(_attr_equals(attrs, "name", n) or _attr_equals(attrs, "property", n) for n in names):
            return content


def _canonical_href(source: str, low: str) -> str | None:
    pos = 0
    while True:
        found = _next_open_tag(source, low, "link", pos)
        if found is None:
            return None
        _, pos, attrs = found
        href = attrs.get("href")
        if href is not None and _attr_equals(attrs, "rel", "canonical"):
            return href


def scan_href_anchors(html_src: str) -> list[tuple[dict[str, str | None], str]]:
    """Every ``<a ...>...</a>`` with an href attribute, as ``(attrs, inner_html)``.

    Linear scan replacing ``<a\\b[^>]*\\bhref...[^>]*>([\\s\\S]*?)</a>`` regexes
    (polynomial backtracking). Mirrors ``scanHrefAnchors`` in the JS runtime.
    """
    source = html_src or ""
    low = _ascii_lower(source)
    out: list[tuple[dict[str, str | None], str]] = []
    pos = 0
    while True:
        found = _next_open_tag(source, low, "a", pos)
        if found is None:
            break
        _, content_start, attrs = found
        pos = content_start
        if attrs.get("href") is None:
            continue
        close = _find_close_tag(low, "a", content_start)
        if close is None:
            break
        pos = close[1]
        out.append((attrs, source[content_start : close[0]]))
    return out


def _strip_element(src: str, tag: str) -> str:
    """Remove ``<tag ...>...</tag>`` regions; an unterminated one runs to the end."""
    s = src or ""
    low = _ascii_lower(s)
    needle = f"<{tag}"
    parts: list[str] = []
    copy_from = 0
    pos = 0
    while True:
        begin = low.find(needle, pos)
        if begin == -1:
            break
        name_end = begin + len(needle)
        if name_end < len(low) and low[name_end] not in _OPEN_TAG_NAME_END:
            pos = begin + 1
            continue
        parts.append(s[copy_from:begin])
        close = _find_close_tag(low, tag, name_end)
        if close is None:
            copy_from = len(s)
            break
        copy_from = pos = close[1]
    parts.append(s[copy_from:])
    return "".join(parts)


def _find_role_main_tag(source: str, low: str) -> tuple[str, int] | None:
    """First open tag of any name with role="main" -> (tag_name, index_of_gt)."""
    pos = 0
    n = len(low)
    while True:
        lt = low.find("<", pos)
        if lt == -1:
            return None
        k = lt + 1
        if not (k < n and "a" <= low[k] <= "z"):
            pos = lt + 1
            continue
        while k < n and ("a" <= low[k] <= "z" or "0" <= low[k] <= "9"):
            k += 1
        if not _is_tag_name_boundary(low, k):
            pos = lt + 1
            continue
        gt = low.find(">", k)
        if gt == -1:
            return None
        if _attr_equals(_parse_tag_attributes(source[k:gt]), "role", "main"):
            return low[lt + 1 : k], gt
        pos = gt + 1


def _count_anchors_with_href(html_src: str) -> int:
    """Count ``<a ...>`` tags whose attribute text mentions href (linear scan)."""
    low = _ascii_lower(html_src)
    count = 0
    pos = 0
    while True:
        begin = low.find("<a", pos)
        if begin == -1:
            return count
        name_end = begin + 2
        if not _is_tag_name_boundary(low, name_end):
            pos = begin + 1
            continue
        gt = low.find(">", name_end)
        if "href" in low[name_end : len(low) if gt == -1 else gt]:
            count += 1
        if gt == -1:
            return count
        pos = gt + 1


def _strip_tags(s: str, repl: str = "") -> str:
    """Linear equivalent of ``re.sub(r"<[^>]+>", repl, s)`` (that regex is O(n^2)
    on many ``<`` without a ``>``)."""
    src = s or ""
    parts: list[str] = []
    copy_from = pos = 0
    while True:
        lt = src.find("<", pos)
        if lt == -1:
            break
        gt = src.find(">", lt + 1)
        if gt == -1:
            break
        if gt == lt + 1:  # "<>" is not a tag
            pos = lt + 1
            continue
        parts.append(src[copy_from:lt])
        parts.append(repl)
        copy_from = pos = gt + 1
    parts.append(src[copy_from:])
    return "".join(parts)


def _iter_anchor_elements(src: str) -> Iterator[tuple[int, int, str, str]]:
    """Yield ``(start, end, attrs_text, inner)`` per ``<a ...>...</a>``.

    Linear stand-in for ``<a\\b([^>]*)>([\\s\\S]*?)</a>``: anchors are consumed
    whole (with or without href); one without an end tag stops the scan.
    """
    s = src or ""
    low = _ascii_lower(s)
    pos = 0
    while True:
        begin = low.find("<a", pos)
        if begin == -1:
            return
        name_end = begin + 2
        if not _is_tag_name_boundary(low, name_end):
            pos = begin + 1
            continue
        gt = low.find(">", name_end)
        if gt == -1:
            return
        close = _find_close_tag(low, "a", gt + 1)
        if close is None:
            return
        yield begin, close[1], s[name_end:gt], s[gt + 1 : close[0]]
        pos = close[1]


def _clean_text(s: str) -> str:
    t = _decode(_strip_tags(s))
    t = _WS_RE.sub(" ", t)
    t = _NL_RE.sub("\n\n", t)
    return t.strip()


def strip_noise(html_src: str, *, strip_scripts_styles: bool = True) -> str:
    out = html_src or ""
    for _ in range(3):

        def remove_marked(match: re.Match[str]) -> str:
            attrs = (match.group(2) or "").replace('"', " ").replace("'", " ")
            return "" if _NOISE_MARKER_RE.search(attrs) else match.group(0)

        cleaned = _MARKED_NOISE_RE.sub(remove_marked, out)
        if cleaned == out:
            break
        out = cleaned
    if strip_scripts_styles:
        for tag in ("script", "style", "noscript"):
            out = _strip_element(out, tag)
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
    for _start, _end, attrs, inner in _iter_anchor_elements(strip_noise(html_src or "")):
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

    def table_repl(m: re.Match[str]) -> str:
        return "\n" + html_table_to_markdown(m.group(0)) + "\n"

    work = re.sub(r"<table\b[\s\S]*?</table>", table_repl, work, flags=re.I)

    # links as markdown
    def a_repl(attrs: str, inner: str) -> str:
        hm = _HREF_RE.search(attrs or "")
        text = _clean_text(inner) or "link"
        if not hm:
            return text
        abs_url = resolve_url(base_url, hm.group(1).strip())
        return f"[{text}]({abs_url})" if abs_url else text

    anchor_parts: list[str] = []
    copy_from = 0
    for start, end, attrs, inner in _iter_anchor_elements(work):
        anchor_parts.append(work[copy_from:start])
        anchor_parts.append(a_repl(attrs, inner))
        copy_from = end
    anchor_parts.append(work[copy_from:])
    work = "".join(anchor_parts)
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


def html_table_to_markdown(html_src: str) -> str:
    rows: list[list[str]] = []
    for row in re.finditer(r"<tr\b[^>]*>([\s\S]*?)</tr>", html_src or "", re.I):
        cells = [
            _clean_text(cell.group(2))
            for cell in re.finditer(r"<(td|th)\b[^>]*>([\s\S]*?)</\1>", row.group(1) or "", re.I)
        ]
        if cells:
            rows.append(cells)
    if not rows:
        return ""
    width = max(len(row) for row in rows)
    padded = [row + [""] * (width - len(row)) for row in rows]
    header = padded[0]
    lines = [
        "| " + " | ".join(header) + " |",
        "| " + " | ".join("---" for _ in header) + " |",
        *["| " + " | ".join(row) + " |" for row in padded[1:]],
    ]
    return "\n".join(lines) + "\n"


def extract_json_ld(html_src: str) -> list[Any]:
    out: list[Any] = []
    source = html_src or ""
    low = _ascii_lower(source)
    pos = 0
    while True:
        found = _next_open_tag(source, low, "script", pos)
        if found is None:
            break
        _, content_start, attrs = found
        pos = content_start
        if not _attr_equals(attrs, "type", "application/ld+json"):
            continue
        close = _find_close_tag(low, "script", content_start)
        if close is None:
            break
        pos = close[1]
        try:
            out.append(json.loads(_decode(source[content_start : close[0]])))
        except Exception:  # noqa: BLE001
            continue
    return out


def extract_page_metadata(html_src: str, url: str = "") -> dict[str, Any]:
    source = html_src or ""
    low = _ascii_lower(source)

    def meta(name: str) -> str:
        content = _meta_content(source, low, (name,))
        return "" if content is None else _decode(content)

    canonical = _canonical_href(source, low)
    charset = re.search(r"charset\s*=\s*[\"']?([a-z0-9-]+)", source, re.I)
    return {
        "title": extract_title(source),
        "description": meta("description") or meta("og:description"),
        "canonical": canonical if canonical is not None else url,
        "charset": charset.group(1).lower() if charset else "",
        "json_ld": extract_json_ld(source),
    }


def extract_reader_article(html_src: str, url: str = "") -> dict[str, Any]:
    """Isolate the main article and score extraction confidence (0..1 heuristic)."""
    source = html_src or ""
    low = _ascii_lower(source)
    container = "body"
    inner = ""
    for tag, label in (("article", "article"), ("main", "main")):
        start = low.find(f"<{tag}")
        if start == -1:
            continue
        gt = low.find(">", start)
        end = low.find(f"</{tag}>", gt if gt != -1 else start)
        if gt != -1 and end != -1 and end > gt:
            container = label
            inner = source[gt + 1 : end]
            break
    if not inner:
        role_main = _find_role_main_tag(source, low)
        if role_main is not None:
            tag, gt = role_main
            end = low.find(f"</{tag}>", gt)
            if gt != -1 and end != -1 and end > gt:
                container = "role=main"
                inner = source[gt + 1 : end]
    title = extract_title(source)
    author = _meta_content(source, low, ("author", "article:author"))
    byline = _decode(author).strip() if author is not None else ""
    json_ld = extract_json_ld(source)
    article_types = {"Article", "NewsArticle", "BlogPosting", "ReportageNewsArticle"}

    def _has_article_schema() -> bool:
        for node in json_ld:
            if not isinstance(node, dict):
                continue
            types = node.get("@type")
            types = types if isinstance(types, list) else [types]
            if any(str(t or "") in article_types for t in types):
                return True
        return False

    markdown = html_to_markdown(inner or source, base_url=url)
    text = re.sub(r"[#*`>\[\]()!\-]", " ", markdown)
    text = _clean_text(text)
    scope = inner or source
    link_count = _count_anchors_with_href(scope)
    words = len(text.split())
    link_density = (link_count / words) if words else 1.0
    signals: list[dict[str, Any]] = []
    score = 0.0

    def _add(points: float, label: str, met: bool) -> None:
        nonlocal score
        signals.append({"signal": label, "met": bool(met)})
        if met:
            score += points

    _add(0.25, "article_landmark", container != "body")
    _add(0.2, "title_present", bool(title))
    _add(0.1, "byline_present", bool(byline))
    _add(0.15, "json_ld_article", _has_article_schema())
    _add(0.15, "text_length", len(text) >= 500)
    _add(0.15, "low_link_density", link_density < 0.2)
    return {
        "title": title,
        "byline": byline,
        "markdown": markdown,
        "confidence": round(min(score, 1.0), 2),
        "container": container,
        "signals": signals,
    }
