"""Gather search + fetch into a research pack (JS/C++ wire parity)."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from handoffkit.browser.cache import BrowserCache, default_cache_root
from handoffkit.browser.explorer import explore_url, fetch_markdown
from handoffkit.browser.page import PageMarkdown
from handoffkit.browser.search import keyword_compress, web_search
from handoffkit.browser.transport import WebTransport, default_transport
from handoffkit.browser.types import ExplorePolicy, canonical_url
from handoffkit.browser.util import map_with_concurrency, smart_truncate

_URL_RE = re.compile(r"https?://[^\s<>\"')\]]+", re.I)


def extract_urls_from_text(text: str) -> list[str]:
    found = _URL_RE.findall(text or "")
    out: list[str] = []
    seen: set[str] = set()
    for raw in found:
        u = re.sub(r"[.,;:!?)]+$", "", raw)
        if u in seen:
            continue
        seen.add(u)
        out.append(u)
    return out


def make_search_query_from_task(task: str, max_chars: int = 140) -> str:
    raw = (task or "").strip()
    if not raw:
        return ""
    first = re.split(r"[.!?\n]", raw)[0].strip() or raw
    kw = keyword_compress(first, 12)
    q = kw or first
    return q[:max_chars] if len(q) > max_chars else q


@dataclass
class ResearchPack:
    enabled: bool = True
    used: bool = False
    queries: list[str] = field(default_factory=list)
    urls_fetched: list[str] = field(default_factory=list)
    markdown_context: str = ""
    pages: list[PageMarkdown] = field(default_factory=list)
    citations: list[dict[str, str]] = field(default_factory=list)
    steps: list[dict[str, Any]] = field(default_factory=list)
    pages_ok: int = 0
    tool_calls: int = 0
    error: str = ""
    transport: str = ""
    mode: str = "search_then_fetch"

    def to_dict(self) -> dict[str, Any]:
        return {
            "enabled": self.enabled,
            "used": self.used,
            "queries": list(self.queries),
            "urls_fetched": list(self.urls_fetched),
            "markdown_chars": len(self.markdown_context),
            "markdown_context": self.markdown_context,
            "pages": [p.to_dict() if isinstance(p, PageMarkdown) else p for p in self.pages],
            "citations": list(self.citations),
            "steps": list(self.steps),
            "pages_ok": self.pages_ok,
            "tool_calls": self.tool_calls,
            "error": self.error,
            "transport": self.transport,
            "mode": self.mode,
        }

    def prompt_section(self) -> str:
        return research_prompt_section(self)


def research_prompt_section(research: ResearchPack | dict[str, Any]) -> str:
    if isinstance(research, ResearchPack):
        md = research.markdown_context or ""
    else:
        md = research.get("markdown_context") or ""
    if not md:
        return ""
    return (
        "### Live web research (Markdown from HandoffKit browser)\n"
        "Use the following fetched page content as evidence. Prefer these sources over invention.\n"
        + md
    )


def gather_web_research(
    query: str = "",
    *,
    transport: WebTransport | None = None,
    max_pages: int = 3,
    timeout_ms: int = 20000,
    seed_urls: list[str] | None = None,
    auto_search: bool = True,
    seed_only: bool = False,
    allow_hosts: list[str] | None = None,
    deny_hosts: list[str] | None = None,
    prefer_explore: bool = False,
    max_depth: int = 0,
    concurrency: int = 2,
    context_max_chars: int = 48000,
    format: str = "markdown",
    cache: BrowserCache | None = None,
    use_cache: bool = False,
    cache_root: str = "",
    task: str = "",
    policy: ExplorePolicy | dict[str, Any] | None = None,
) -> ResearchPack:
    tr = transport or default_transport(True)
    q = (query or "").strip()
    task_s = (task or "").strip()
    auto = False if seed_only else auto_search
    pack = ResearchPack(
        enabled=True,
        transport=getattr(tr, "name", lambda: "unknown")(),
        mode="seed_only" if seed_only else ("search_then_fetch" if auto else "urls_only"),
    )

    browser_cache = cache
    if browser_cache is None and (use_cache or cache_root):
        browser_cache = BrowserCache(root=cache_root or str(default_cache_root()))

    urls = list(seed_urls or [])
    urls.extend(extract_urls_from_text(task_s))
    urls.extend(extract_urls_from_text(q))
    urls = list(dict.fromkeys(canonical_url(u) for u in urls if u))

    if not urls and auto:
        search_q = q or make_search_query_from_task(task_s)
        if search_q:
            pack.queries.append(search_q)
            pack.tool_calls += 1
            search = web_search(
                search_q,
                transport=tr,
                max_results=min(8, max(max_pages * 2, max_pages)),
                timeout_ms=timeout_ms,
                allow_hosts=allow_hosts,
                deny_hosts=deny_hosts,
            )
            pack.steps.append({"tool": "web_search", "query": search_q, "result": search})
            urls.extend(h["url"] for h in search.get("results") or [])

    urls = list(dict.fromkeys(urls))[: max(max_pages * 3, max_pages)]
    if not urls:
        pack.error = "no urls to fetch"
        pack.used = bool(pack.queries)
        return pack

    pol = policy if isinstance(policy, ExplorePolicy) else ExplorePolicy.from_dict(policy)
    pol_dict = {
        **pol.to_dict(),
        "timeout_ms": timeout_ms or pol.timeout_ms,
        "same_host_only": True if prefer_explore else False,
        "max_depth": max_depth if prefer_explore else 0,
        "max_pages": max(1, max_depth + 1) if prefer_explore else 1,
        "allow_hosts": allow_hosts or pol.allow_hosts,
        "deny_hosts": deny_hosts or pol.deny_hosts,
        "emit_markdown": True,
    }
    explore_policy = ExplorePolicy.from_dict(pol_dict)

    def fetch_one(url: str) -> tuple[str, PageMarkdown, dict[str, Any]]:
        if prefer_explore and max_depth > 0:
            result = explore_url(url, policy=explore_policy, transport=tr, cache=browser_cache)
            tool = "web_explore"
        else:
            fetch_pol = ExplorePolicy.from_dict(
                {
                    **explore_policy.to_dict(),
                    "max_depth": 0,
                    "max_pages": 1,
                    "same_host_only": False,
                }
            )
            result = fetch_markdown(url, policy=fetch_pol, transport=tr, cache=browser_cache)
            tool = "web_fetch_markdown"
        page = PageMarkdown.from_explore_result(result, max_chars=60000, format=format)
        step = {
            "tool": tool,
            "url": url,
            "success": page.success,
            "error": page.error,
        }
        return url, page, step

    fetched_pairs = map_with_concurrency(urls[: max_pages * 3], concurrency, fetch_one)
    md_parts: list[str] = []
    for _url, page, step in fetched_pairs:
        pack.tool_calls += 1
        pack.steps.append(step)
        if not page.success and not page.markdown:
            continue
        if pack.pages_ok >= max_pages:
            break
        pack.pages_ok += 1
        pack.pages.append(page)
        final = page.final_url or page.url
        pack.urls_fetched.append(final)
        pack.citations.append({"title": page.title or final, "url": final})
        chunk = page.markdown or page.text
        if format == "readme":
            chunk = page.to_readme()
        if chunk:
            md_parts.append(chunk)

    pack.markdown_context = smart_truncate("\n\n---\n\n".join(md_parts), context_max_chars)
    pack.used = pack.pages_ok > 0 or bool(pack.queries)
    pack.error = "" if pack.pages_ok else "no pages fetched successfully"
    return pack
