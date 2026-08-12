"""Browser agent kit: transport + tools + helpers."""

from __future__ import annotations

from typing import Any

from handoffkit.browser.cache import BrowserCache, default_cache_root
from handoffkit.browser.explorer import explore_url, fetch_markdown
from handoffkit.browser.page import PageMarkdown
from handoffkit.browser.research import (
    ResearchPack,
    gather_deep_web_research,
    gather_web_research,
)
from handoffkit.browser.search import DEFAULT_SEARCH_PROVIDERS, web_search
from handoffkit.browser.tools import register_browser_tools
from handoffkit.browser.transport import (
    default_transport,
    make_fixture_map_transport,
    make_transport,
)
from handoffkit.browser.types import ExplorePolicy
from handoffkit.tool_execution import ToolRegistry


def create_browser_agent_kit(options: dict[str, Any] | None = None) -> dict[str, Any]:
    opts = options or {}
    if opts.get("fixture") or opts.get("transport") == "fixture":
        transport = make_fixture_map_transport()
    elif opts.get("transport"):
        t = opts["transport"]
        transport = make_transport(t) if isinstance(t, str) else t
    else:
        transport = default_transport(True)

    cache = None
    if (
        opts.get("use_cache")
        or opts.get("useCache")
        or opts.get("cache_root")
        or opts.get("cacheRoot")
    ):
        cache = BrowserCache(
            root=opts.get("cache_root") or opts.get("cacheRoot") or str(default_cache_root()),
            ttl_ms=int(opts.get("cache_ttl_ms") or opts.get("cacheTtlMs") or 24 * 60 * 60 * 1000),
        )

    allow_hosts = list(opts.get("allow_hosts") or opts.get("allowHosts") or [])
    deny_hosts = list(opts.get("deny_hosts") or opts.get("denyHosts") or [])
    fmt = opts.get("format") or "markdown"
    max_pages = int(opts.get("max_pages") or opts.get("maxPages") or 3)
    providers = list(opts.get("providers") or opts.get("provider") or DEFAULT_SEARCH_PROVIDERS)

    registry = ToolRegistry()
    register_browser_tools(registry, transport, {"providers": providers})

    def search(query: str, **kwargs: Any) -> dict[str, Any]:
        return web_search(
            query,
            transport=transport,
            max_results=kwargs.get("max_results", opts.get("max_results", 6)),
            allow_hosts=kwargs.get("allow_hosts", allow_hosts),
            deny_hosts=kwargs.get("deny_hosts", deny_hosts),
            timeout_ms=kwargs.get("timeout_ms", 20000),
            providers=kwargs.get("providers", providers),
        )

    def fetch_md(url: str, **kwargs: Any) -> PageMarkdown:
        policy = ExplorePolicy(
            timeout_ms=int(kwargs.get("timeout_ms", 15000)),
            max_markdown_chars=int(kwargs.get("max_chars", 60000)),
            emit_markdown=True,
            same_host_only=False,
            max_depth=0,
            max_pages=1,
        )
        result = fetch_markdown(url, policy=policy, transport=transport, cache=cache)
        return PageMarkdown.from_explore_result(
            result,
            max_chars=int(kwargs.get("max_chars", 60000)),
            format=kwargs.get("format", fmt),
        )

    def explore(url: str, **kwargs: Any) -> Any:
        return explore_url(
            url,
            policy=ExplorePolicy.from_dict(
                {
                    "max_depth": kwargs.get("max_depth", 1),
                    "max_pages": kwargs.get("max_pages", 4),
                    "same_host_only": kwargs.get("same_host_only", True),
                    "allow_hosts": allow_hosts,
                    "deny_hosts": deny_hosts,
                }
            ),
            transport=transport,
            cache=cache,
        )

    def gather(**kwargs: Any) -> ResearchPack:
        return gather_web_research(
            kwargs.get("query", ""),
            transport=transport,
            cache=cache,
            max_pages=int(kwargs.get("max_pages", max_pages)),
            allow_hosts=kwargs.get("allow_hosts", allow_hosts),
            deny_hosts=kwargs.get("deny_hosts", deny_hosts),
            seed_urls=kwargs.get("seed_urls"),
            seed_only=bool(kwargs.get("seed_only", False)),
            auto_search=kwargs.get("auto_search", True),
            prefer_explore=bool(kwargs.get("prefer_explore", False)),
            max_depth=int(kwargs.get("max_depth", 0)),
            format=kwargs.get("format", fmt),
            use_cache=bool(cache),
            timeout_ms=int(kwargs.get("timeout_ms", 20000)),
            task=kwargs.get("task", ""),
            providers=kwargs.get("providers", providers),
        )

    def deep_gather(**kwargs: Any) -> ResearchPack:
        return gather_deep_web_research(
            kwargs.get("query", ""),
            task=kwargs.get("task", ""),
            transport=transport,
            cache=cache,
            max_pages=int(kwargs.get("max_pages", max(max_pages, 8))),
            max_depth=int(kwargs.get("max_depth", 2)),
            max_sub_queries=int(kwargs.get("max_sub_queries", 3)),
            max_results_per_query=int(kwargs.get("max_results_per_query", 8)),
            auto_search=bool(kwargs.get("auto_search", True)),
            timeout_ms=int(kwargs.get("timeout_ms", 20000)),
            concurrency=int(kwargs.get("concurrency", 3)),
            allow_hosts=kwargs.get("allow_hosts", allow_hosts),
            deny_hosts=kwargs.get("deny_hosts", deny_hosts),
            seed_urls=kwargs.get("seed_urls"),
            context_max_chars=int(kwargs.get("context_max_chars", max(96000, 2 * 48000))),
            format=kwargs.get("format", fmt),
            use_cache=bool(cache),
            providers=kwargs.get("providers", providers),
        )

    return {
        "transport": transport,
        "cache": cache,
        "registry": registry,
        "tools": [registry.get(n) for n in registry.list_tools()],
        "search": search,
        "fetch_markdown": fetch_md,
        "explore": explore,
        "gather": gather,
        "deep_gather": deep_gather,
        "options": dict(opts),
        "providers": providers,
    }
