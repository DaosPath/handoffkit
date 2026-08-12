"""Browser tools for ToolRegistry."""

from __future__ import annotations

from typing import Any

from handoffkit.browser.explorer import explore_url, fetch_markdown
from handoffkit.browser.html_extract import extract_title, html_to_markdown
from handoffkit.browser.page import PageMarkdown, to_readme_markdown
from handoffkit.browser.research import gather_deep_web_research, gather_web_research
from handoffkit.browser.search import web_search
from handoffkit.browser.transport import default_transport, make_transport
from handoffkit.browser.types import ExplorePolicy, policy_from_args
from handoffkit.tool import Tool


def _resolve_transport(args: dict[str, Any] | None, fallback: Any) -> Any:
    args = args or {}
    t = args.get("transport")
    if t is not None and hasattr(t, "get"):
        return t
    if isinstance(t, str):
        return make_transport(t)
    return fallback if fallback is not None else default_transport(True)


def make_web_search_tool(
    default_transport_ref: Any = None,
    defaults: dict[str, Any] | None = None,
) -> Tool:
    defaults = defaults or {}
    def run(
        query: str,
        max_results: int = 6,
        timeout_ms: int = 20000,
        allow_hosts: list[str] | None = None,
        deny_hosts: list[str] | None = None,
        providers: list[str] | None = None,
        user_browser: Any = None,
        transport: Any = None,
    ) -> dict[str, Any]:
        if not query:
            return {"success": False, "error": "query is required", "results": [], "count": 0}
        return web_search(
            query,
            transport=_resolve_transport({"transport": transport}, default_transport_ref),
            max_results=max_results,
            timeout_ms=timeout_ms,
            providers=providers if providers is not None else defaults.get("providers"),
            user_browser=user_browser if user_browser is not None else defaults.get("user_browser"),
            allow_hosts=allow_hosts,
            deny_hosts=deny_hosts,
        )

    return Tool(
        run,
        name="web_search",
        description=(
            "Search the live web for a query. Returns ranked {title,url,score} hits. "
            "user_browser requires an explicitly injected search bridge; page research "
            "also needs fetch/open."
        ),
    )


def make_web_fetch_tool(default_transport_ref: Any = None) -> Tool:
    def run(
        url: str,
        timeout_ms: int = 15000,
        same_host_only: bool = False,
        max_text_chars: int | None = None,
        max_markdown_chars: int | None = None,
        transport: Any = None,
    ) -> dict[str, Any]:
        if not url:
            return {"success": False, "error": "url is required"}
        args = {
            "timeout_ms": timeout_ms,
            "same_host_only": same_host_only,
            "max_depth": 0,
            "max_pages": 1,
        }
        if max_text_chars is not None:
            args["max_text_chars"] = max_text_chars
        if max_markdown_chars is not None:
            args["max_markdown_chars"] = max_markdown_chars
        result = fetch_markdown(
            url,
            policy=policy_from_args(args),
            transport=_resolve_transport({"transport": transport}, default_transport_ref),
        )
        return result.to_dict()

    return Tool(
        run,
        name="web_fetch",
        description=(
            "Fetch one URL and extract title, text, links, and markdown "
            "under ExplorePolicy budgets."
        ),
    )


def make_web_explore_tool(default_transport_ref: Any = None) -> Tool:
    def run(
        url: str,
        max_depth: int = 1,
        max_pages: int = 4,
        timeout_ms: int = 15000,
        same_host_only: bool = True,
        transport: Any = None,
    ) -> dict[str, Any]:
        if not url:
            return {"success": False, "error": "url is required"}
        result = explore_url(
            url,
            policy=policy_from_args(
                {
                    "max_depth": max_depth,
                    "max_pages": max_pages,
                    "timeout_ms": timeout_ms,
                    "same_host_only": same_host_only,
                }
            ),
            transport=_resolve_transport({"transport": transport}, default_transport_ref),
        )
        return result.to_dict()

    return Tool(
        run,
        name="web_explore",
        description=(
            "Bounded BFS crawl from a start URL. Use for docs sites when one page is not enough."
        ),
    )


def make_html_to_markdown_tool(default_transport_ref: Any = None) -> Tool:
    def run(
        html: str = "",
        url: str = "",
        max_chars: int = 60000,
        include_links: bool = True,
        include_header: bool = True,
        format: str = "markdown",
        timeout_ms: int = 15000,
        transport: Any = None,
    ) -> dict[str, Any]:
        _ = include_links
        body = html or ""
        final_url = url or ""
        if not body and url:
            tr = _resolve_transport({"transport": transport}, default_transport_ref)
            resp = tr.get(url, timeout_ms=timeout_ms)
            if resp.error or not resp.body:
                return {
                    "success": False,
                    "url": url,
                    "error": resp.error or "empty body",
                    "format": "markdown",
                }
            body = resp.body
            final_url = resp.final_url or url
        if not body:
            return {"success": False, "error": "html or url is required", "format": "markdown"}
        markdown = html_to_markdown(body, base_url=final_url, max_chars=max_chars)
        title = extract_title(body)
        if include_header and final_url and "Source:" not in markdown[:200]:
            if title:
                markdown = f"# {title}\n\nSource: {final_url}\n\n{markdown}"
            else:
                markdown = f"Source: {final_url}\n\n{markdown}"
        if format == "readme":
            markdown = to_readme_markdown(title=title, url=final_url, markdown=markdown)
        return {
            "success": True,
            "url": final_url,
            "title": title,
            "markdown": markdown,
            "markdown_chars": len(markdown),
            "format": "readme" if format == "readme" else "markdown",
        }

    return Tool(
        run,
        name="html_to_markdown",
        description=(
            "Convert an HTML string (or fetch a URL) into compact Markdown for agent context."
        ),
    )


def make_web_fetch_markdown_tool(default_transport_ref: Any = None) -> Tool:
    def run(
        url: str,
        timeout_ms: int = 15000,
        max_chars: int = 60000,
        format: str = "markdown",
        transport: Any = None,
    ) -> dict[str, Any]:
        if not url:
            return {"success": False, "error": "url is required", "format": "markdown"}
        policy = ExplorePolicy(
            timeout_ms=timeout_ms,
            max_markdown_chars=max_chars,
            emit_markdown=True,
            same_host_only=False,
            max_depth=0,
            max_pages=1,
        )
        result = fetch_markdown(
            url,
            policy=policy,
            transport=_resolve_transport({"transport": transport}, default_transport_ref),
        )
        return PageMarkdown.from_explore_result(
            result, max_chars=max_chars, format=format
        ).to_dict()

    return Tool(
        run,
        name="web_fetch_markdown",
        description=(
            "Fetch a URL and return PageMarkdown: title, markdown, excerpt, links, fetched_at. "
            "Prefer this after web_search."
        ),
    )


def make_web_research_tool(
    default_transport_ref: Any = None,
    defaults: dict[str, Any] | None = None,
) -> Tool:
    defaults = defaults or {}
    def run(
        query: str,
        task: str = "",
        max_pages: int = 3,
        max_sub_queries: int = 3,
        timeout_ms: int = 20000,
        allow_hosts: list[str] | None = None,
        deny_hosts: list[str] | None = None,
        providers: list[str] | None = None,
        user_browser: Any = None,
        seed_only: bool = False,
        seed_urls: list[str] | None = None,
        format: str = "markdown",
        transport: Any = None,
    ) -> dict[str, Any]:
        if not query and not seed_urls:
            return {"success": False, "error": "query is required"}
        pack = gather_web_research(
            query,
            task=task,
            transport=_resolve_transport({"transport": transport}, default_transport_ref),
            max_pages=max_pages,
            max_sub_queries=max_sub_queries,
            timeout_ms=timeout_ms,
            allow_hosts=allow_hosts,
            deny_hosts=deny_hosts,
            providers=providers if providers is not None else defaults.get("providers"),
            user_browser=user_browser if user_browser is not None else defaults.get("user_browser"),
            seed_only=seed_only,
            seed_urls=seed_urls,
            format=format,
            auto_search=not seed_only,
        )
        data = pack.to_dict()
        data["success"] = pack.pages_ok > 0
        return data

    return Tool(
        run,
        name="web_research",
        description=(
            "Run search-then-fetch research and return a ResearchPack with markdown_context "
            "and citations for answering grounded questions."
        ),
    )


def make_deep_web_research_tool(
    default_transport_ref: Any = None,
    defaults: dict[str, Any] | None = None,
) -> Tool:
    """Agent-facing bounded research with an explicit user-browser page bridge."""
    defaults = defaults or {}

    def run(
        query: str,
        task: str = "",
        max_pages: int = 8,
        max_depth: int = 2,
        max_sub_queries: int = 3,
        max_results_per_query: int = 8,
        providers: list[str] | None = None,
        user_browser: Any = None,
        timeout_ms: int = 20000,
        concurrency: int = 3,
        allow_hosts: list[str] | None = None,
        deny_hosts: list[str] | None = None,
        seed_urls: list[str] | None = None,
        auto_search: bool = True,
        context_max_chars: int = 96000,
        format: str = "markdown",
        transport: Any = None,
    ) -> dict[str, Any]:
        if not query:
            return {"success": False, "error": "query is required"}
        pack = gather_deep_web_research(
            query,
            task=task,
            transport=_resolve_transport({"transport": transport}, default_transport_ref),
            max_pages=max_pages,
            max_depth=max_depth,
            max_sub_queries=max_sub_queries,
            max_results_per_query=max_results_per_query,
            providers=providers if providers is not None else defaults.get("providers"),
            user_browser=user_browser if user_browser is not None else defaults.get("user_browser"),
            timeout_ms=timeout_ms,
            concurrency=concurrency,
            allow_hosts=allow_hosts,
            deny_hosts=deny_hosts,
            seed_urls=seed_urls,
            auto_search=auto_search,
            context_max_chars=context_max_chars,
            format=format,
        )
        data = pack.to_dict()
        data["success"] = pack.pages_ok > 0
        return data

    return Tool(
        run,
        name="web_deep_research",
        description=(
            "Run bounded multi-query, multi-hop research and return a grounded ResearchPack; "
            "user_browser requires an explicit search plus fetch/open host bridge."
        ),
    )


def register_browser_tools(
    registry: Any,
    transport: Any | None = None,
    defaults: dict[str, Any] | None = None,
) -> Any:
    if registry is None or not hasattr(registry, "register"):
        raise TypeError("register_browser_tools requires a ToolRegistry")
    t = transport if transport is not None else default_transport(True)
    registry.register(make_web_search_tool(t, defaults))
    registry.register(make_web_fetch_tool(t))
    registry.register(make_web_explore_tool(t))
    registry.register(make_html_to_markdown_tool(t))
    registry.register(make_web_fetch_markdown_tool(t))
    registry.register(make_web_research_tool(t, defaults))
    registry.register(make_deep_web_research_tool(t, defaults))
    return registry


def register_web_explorer_tools(
    registry: Any,
    transport: Any | None = None,
    defaults: dict[str, Any] | None = None,
) -> Any:
    return register_browser_tools(registry, transport, defaults)
