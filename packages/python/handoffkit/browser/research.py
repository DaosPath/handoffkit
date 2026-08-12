"""Gather search + fetch into a research pack (JS/C++ wire parity)."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from handoffkit.browser.cache import BrowserCache, default_cache_root
from handoffkit.browser.explorer import explore_url, fetch_markdown
from handoffkit.browser.page import PageMarkdown
from handoffkit.browser.rank import rank_search_hits
from handoffkit.browser.search import DEFAULT_SEARCH_PROVIDERS, keyword_compress, web_search
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
    metadata: dict[str, Any] = field(default_factory=dict)

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
            "metadata": dict(self.metadata),
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


def make_research_queries(
    *, query: str = "", task: str = "", max_sub_queries: int = 3
) -> list[str]:
    """Derive focused, deterministic subqueries without opening a browser."""
    limit = max(1, min(int(max_sub_queries or 3), 8))
    candidates = [(query or "").strip()]
    candidates.extend(part.strip() for part in re.split(r"[.!?\n]+", task or ""))
    out: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        focused = make_search_query_from_task(candidate, 140)
        key = focused.lower()
        if not focused or key in seen:
            continue
        seen.add(key)
        out.append(focused)
        if len(out) >= limit:
            break
    return out


def _page_from_explore_step(step: Any, *, format: str = "markdown") -> PageMarkdown:
    markdown = step.markdown or step.text or ""
    if format == "readme":
        source = step.final_url or step.url
        markdown = f"# {step.title or 'Untitled page'}\n\nSource: {source}\n\n{markdown}"
    return PageMarkdown(
        url=step.url,
        final_url=step.final_url or step.url,
        title=step.title,
        markdown=markdown,
        text=step.text,
        links=[link.to_dict() for link in step.links],
        format=format if format in {"markdown", "readme"} else "markdown",
        success=bool(step.success),
        error="" if step.success else step.error or "fetch failed",
        status=step.status,
        metadata={"depth": step.depth, "source": "background_http"},
    )


def gather_deep_web_research(
    query: str = "",
    *,
    task: str = "",
    transport: WebTransport | None = None,
    seed_urls: list[str] | None = None,
    max_pages: int = 8,
    max_depth: int = 2,
    max_sub_queries: int = 3,
    max_results_per_query: int = 8,
    providers: list[str] | None = None,
    auto_search: bool = True,
    timeout_ms: int = 20000,
    concurrency: int = 3,
    allow_hosts: list[str] | None = None,
    deny_hosts: list[str] | None = None,
    context_max_chars: int = 96000,
    format: str = "markdown",
    cache: BrowserCache | None = None,
    use_cache: bool = False,
    cache_root: str = "",
    policy: ExplorePolicy | dict[str, Any] | None = None,
) -> ResearchPack:
    """Run bounded multi-query/multi-hop research entirely in the background.

    The browser user is not involved. Search, redirects and page exploration use
    the selected WebTransport (HTTP by default, map transport in tests).
    """
    from time import monotonic

    started = monotonic()
    tr = transport or default_transport(True)
    pages_limit = max(1, min(int(max_pages or 8), 100))
    depth_limit = max(0, min(int(2 if max_depth is None else max_depth), 4))
    subquery_limit = max(1, min(int(max_sub_queries or 3), 8))
    result_limit = max(1, min(int(max_results_per_query or 8), 20))
    timeout = max(1000, int(timeout_ms or 20000))
    parallel = max(1, min(int(concurrency or 3), 8))
    allows = list(allow_hosts or [])
    denies = list(deny_hosts or [])
    provider_list = list(providers or DEFAULT_SEARCH_PROVIDERS)
    browser_cache = cache
    if browser_cache is None and (use_cache or cache_root):
        browser_cache = BrowserCache(root=cache_root or str(default_cache_root()))
    pack = ResearchPack(
        enabled=True,
        transport=getattr(tr, "name", lambda: "unknown")(),
        mode="deep_search_then_explore",
        metadata={
            "execution_mode": "background_http",
            "user_browser_required": False,
            "max_pages": pages_limit,
            "max_depth": depth_limit,
            "max_sub_queries": subquery_limit,
            "max_results_per_query": result_limit,
            "timeout_ms": timeout,
            "concurrency": parallel,
            "allow_hosts": allows,
            "deny_hosts": denies,
            "cache_enabled": browser_cache is not None,
            "provider_transport": getattr(tr, "name", lambda: "unknown")(),
            "providers_requested": provider_list,
            "providers_used": [],
            "provider_errors": [],
            "cache_hits": 0,
            "cache_misses": 0,
            "cache_writes": 0,
            "error_code": "",
            "auto_search": bool(auto_search),
        },
    )
    queries = (
        make_research_queries(query=query, task=task, max_sub_queries=subquery_limit)
        if auto_search
        else []
    )
    pack.queries.extend(queries)
    urls = [*list(seed_urls or []), *extract_urls_from_text(task), *extract_urls_from_text(query)]
    urls = list(dict.fromkeys(canonical_url(url) for url in urls if url))

    def search_one(subquery: str) -> tuple[str, dict[str, Any]]:
        return subquery, web_search(
            subquery,
            transport=tr,
            max_results=result_limit,
            timeout_ms=timeout,
            providers=provider_list,
            allow_hosts=allows,
            deny_hosts=denies,
        )

    for subquery, search in map_with_concurrency(queries, parallel, search_one):
        pack.tool_calls += 1
        pack.steps.append(
            {
                "tool": "web_search",
                "query": subquery,
                "success": bool(search.get("success")),
                "count": int(search.get("count") or 0),
                "engine": search.get("engine", ""),
                "providers_requested": search.get("providers_requested", []),
                "providers_used": search.get("providers_used", []),
                "provider_errors": search.get("errors", []),
                "error": search.get("error", ""),
            }
        )
        for provider in search.get("providers_used") or []:
            if provider not in pack.metadata["providers_used"]:
                pack.metadata["providers_used"].append(provider)
        for error in search.get("errors") or []:
            if error not in pack.metadata["provider_errors"]:
                pack.metadata["provider_errors"].append(error)
        urls.extend(canonical_url(hit.get("url", "")) for hit in search.get("results") or [])

    ranked = rank_search_hits(
        [{"title": "", "url": url} for url in dict.fromkeys(urls) if url],
        allow_hosts=allows,
        deny_hosts=denies,
    )
    candidate_limit = max(1, (pages_limit + depth_limit) // max(1, depth_limit + 1))
    candidates = [str(hit["url"]) for hit in ranked[:candidate_limit]]
    if not candidates:
        pack.error = "no urls to explore"
        pack.metadata["error_code"] = "no_urls_to_explore"
        pack.used = bool(pack.queries)
        pack.metadata["duration_ms"] = int((monotonic() - started) * 1000)
        return pack

    branch_pages = max(1, min(depth_limit + 1, pages_limit))
    base_policy = policy if isinstance(policy, ExplorePolicy) else ExplorePolicy.from_dict(policy)
    explore_policy = ExplorePolicy.from_dict(
        {
            **base_policy.to_dict(),
            "max_depth": depth_limit,
            "max_pages": branch_pages,
            "timeout_ms": timeout,
            "same_host_only": True,
            "allow_hosts": allows or base_policy.allow_hosts,
            "deny_hosts": denies or base_policy.deny_hosts,
            "emit_markdown": True,
        }
    )

    def explore_one(url: str) -> tuple[str, Any]:
        return url, explore_url(
            url,
            policy=explore_policy,
            transport=tr,
            cache=browser_cache,
        )

    for seed_url, explored in map_with_concurrency(candidates, parallel, explore_one):
        for key in ("cache_hits", "cache_misses", "cache_writes"):
            pack.metadata[key] += int(explored.metadata.get(key, 0) or 0)
        pack.tool_calls += 1
        elapsed = int((monotonic() - started) * 1000)
        pack.steps.append(
            {
                "tool": "web_explore",
                "seed_url": seed_url,
                "success": explored.success,
                "pages_fetched": explored.pages_fetched,
                "max_depth_reached": explored.max_depth_reached,
                "ms": elapsed,
                "error": explored.error,
            }
        )
        for step in explored.steps:
            pack.steps.append(
                {
                    "tool": "web_explore_step",
                    "seed_url": seed_url,
                    "depth": step.depth,
                    "url": step.url,
                    "final_url": step.final_url,
                    "status": step.status,
                    "success": step.success,
                    "error": step.error,
                }
            )
            if not step.success or pack.pages_ok >= pages_limit:
                continue
            page = _page_from_explore_step(step, format=format)
            if not page.success:
                continue
            pack.pages.append(page)
            pack.pages_ok += 1
            final_url = page.final_url or page.url
            pack.urls_fetched.append(final_url)
            pack.citations.append({"title": page.title or final_url, "url": final_url})

    pack.markdown_context = smart_truncate(
        "\n\n---\n\n".join(page.markdown for page in pack.pages if page.markdown),
        context_max_chars,
    )
    pack.used = pack.pages_ok > 0 or bool(pack.queries)
    if not pack.pages_ok:
        pack.error = "no pages explored successfully"
        pack.metadata["error_code"] = "no_pages_explored"
    pack.metadata["candidates"] = candidates
    pack.metadata["duration_ms"] = int((monotonic() - started) * 1000)
    pack.steps.append(
        {
            "tool": "deep_research_done",
            "pages_ok": pack.pages_ok,
            "ms": pack.metadata["duration_ms"],
        }
    )
    return pack


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
    providers: list[str] | None = None,
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
    pack.metadata.update(
        {
            "cache_enabled": browser_cache is not None,
            "cache_hits": 0,
            "cache_misses": 0,
            "cache_writes": 0,
        }
    )

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
                providers=providers,
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
            "cache_hits": int(result.metadata.get("cache_hits", 0) or 0),
            "cache_misses": int(result.metadata.get("cache_misses", 0) or 0),
            "cache_writes": int(result.metadata.get("cache_writes", 0) or 0),
        }
        return url, page, step

    fetched_pairs = map_with_concurrency(urls[: max_pages * 3], concurrency, fetch_one)
    md_parts: list[str] = []
    for _url, page, step in fetched_pairs:
        pack.tool_calls += 1
        for key in ("cache_hits", "cache_misses", "cache_writes"):
            pack.metadata[key] += step.get(key, 0)
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
