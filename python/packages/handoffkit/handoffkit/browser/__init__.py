"""First-party web browser complement (search / fetch / HTML→Markdown).

Separate from core — import explicitly::

    from handoffkit.browser import web_search, gather_web_research, create_browser_agent_kit

Wire JSON uses snake_case to match ``@handoffkit/browser`` and C++ ``handoffkit::browser``.
"""

from __future__ import annotations

from typing import Any

from handoffkit.browser.cache import BrowserCache, default_cache_root
from handoffkit.browser.core import (
    CONTRACT_VERSION as BROWSER_CORE_CONTRACT_VERSION,
)
from handoffkit.browser.core import (
    HANDOFFKIT_BROWSER_CORE_VERSION,
    BrowserCapabilities,
    BrowserError,
    BrowserPolicy,
    ResearchClaim,
    ResearchResult,
    classify_network_target,
    parse_core_model,
)
from handoffkit.browser.default_browser import (
    DEFAULT_BROWSER_BRIDGE_ENV,
    DEFAULT_BROWSER_PROVIDER,
    DEFAULT_BROWSER_TOKEN_ENV,
    DefaultBrowserBridge,
    DefaultBrowserBridgeError,
    explore_default_browser,
    fetch_default_browser_page,
    is_default_browser_bridge,
    search_default_browser,
    search_default_browser_many,
)
from handoffkit.browser.explorer import explore_url, fetch_markdown
from handoffkit.browser.grounding_scorer import live_grounding_oracle, score_live_grounding_run
from handoffkit.browser.html_extract import (
    extract_json_ld,
    extract_links,
    extract_page,
    extract_page_metadata,
    extract_text,
    extract_title,
    html_table_to_markdown,
    html_to_markdown,
    prefer_main_content,
)
from handoffkit.browser.kit import create_browser_agent_kit
from handoffkit.browser.model_answer import judge_model_answer
from handoffkit.browser.page import (
    PageMarkdown,
    format_readme_bundle,
    page_from_html,
    to_readme_markdown,
)
from handoffkit.browser.project_index import ProjectWebIndex
from handoffkit.browser.rank import host_score, rank_search_hits
from handoffkit.browser.real_client import BrowserRealClient
from handoffkit.browser.research import (
    ResearchPack,
    extract_urls_from_text,
    gather_deep_web_research,
    gather_web_research,
    make_research_queries,
    make_search_query_from_task,
    research_prompt_section,
)
from handoffkit.browser.research_pack_v2 import finalize_research_pack_v2, write_research_checkpoint
from handoffkit.browser.robots import is_robots_allowed, parse_robots_txt
from handoffkit.browser.search import (
    DEFAULT_SEARCH_PROVIDERS,
    PLATFORM_SEARCH_PROVIDERS,
    SUPPORTED_SEARCH_PROVIDERS,
    keyword_compress,
    search_duckduckgo,
    search_google,
    search_wikipedia,
    web_search,
)
from handoffkit.browser.tools import (
    make_deep_web_research_tool,
    make_html_to_markdown_tool,
    make_web_explore_tool,
    make_web_fetch_markdown_tool,
    make_web_fetch_tool,
    make_web_research_tool,
    make_web_search_tool,
    register_browser_tools,
    register_web_explorer_tools,
)
from handoffkit.browser.transport import (
    HttpTransport,
    MapTransport,
    TransportResponse,
    default_transport,
    make_fixture_map_transport,
    make_transport,
)
from handoffkit.browser.types import (
    DEFAULT_UA,
    ExplorePolicy,
    ExploreResult,
    ExploreStep,
    ExtractedLink,
    canonical_url,
    host_allowed,
    normalize_host,
    parse_url,
    policy_from_args,
    resolve_url,
    url_allowed,
)
from handoffkit.browser.user_browser import (
    USER_BROWSER_PROVIDER,
    UserBrowserBridge,
    UserBrowserPageBridge,
    explore_user_browser,
    fetch_user_browser_page,
    is_user_browser_bridge,
    is_user_browser_page_bridge,
    search_user_browser,
    search_user_browser_many,
)
from handoffkit.browser.util import detect_soft_block, map_with_concurrency, smart_truncate


def web_fetch_markdown(
    url: str,
    *,
    transport: Any | None = None,
    timeout_ms: int = 15000,
    max_chars: int = 60000,
    format: str = "markdown",
    cache: BrowserCache | None = None,
) -> dict[str, Any]:
    """Fetch one URL and return a PageMarkdown wire dict."""
    policy = ExplorePolicy(
        timeout_ms=timeout_ms,
        max_markdown_chars=max_chars,
        emit_markdown=True,
        same_host_only=False,
        max_depth=0,
        max_pages=1,
    )
    result = fetch_markdown(url, policy=policy, transport=transport, cache=cache)
    return PageMarkdown.from_explore_result(result, max_chars=max_chars, format=format).to_dict()


def browser_toolkit(
    transport: Any | None = None,
    user_browser: Any | None = None,
) -> dict[str, Any]:
    """Return callables an agent/runtime can bind as tools."""
    t = transport or HttpTransport()
    return {
        "web_search": lambda query, max_results=6, providers=None: web_search(
            query,
            transport=t,
            max_results=max_results,
            providers=providers,
            user_browser=user_browser,
        ),
        "web_fetch_markdown": lambda url: web_fetch_markdown(url, transport=t),
        "web_research": lambda query, max_pages=3, providers=None: gather_web_research(
            query, transport=t, max_pages=max_pages, providers=providers, user_browser=user_browser
        ).to_dict(),
        "web_deep_research": lambda query, max_pages=8, max_depth=2, providers=None: (
            gather_deep_web_research(
                query,
                transport=t,
                max_pages=max_pages,
                max_depth=max_depth,
                providers=providers,
                user_browser=user_browser,
            ).to_dict()
        ),
    }


# Mapping-style access for ResearchPack (legacy tests / dict callers)
def _research_getitem(self: ResearchPack, key: str) -> Any:
    return self.to_dict()[key]


ResearchPack.__getitem__ = _research_getitem  # type: ignore[method-assign]


__all__ = [
    "DEFAULT_UA",
    "DEFAULT_SEARCH_PROVIDERS",
    "PLATFORM_SEARCH_PROVIDERS",
    "BROWSER_CORE_CONTRACT_VERSION",
    "HANDOFFKIT_BROWSER_CORE_VERSION",
    "DEFAULT_BROWSER_PROVIDER",
    "DEFAULT_BROWSER_BRIDGE_ENV",
    "DEFAULT_BROWSER_TOKEN_ENV",
    "SUPPORTED_SEARCH_PROVIDERS",
    "USER_BROWSER_PROVIDER",
    "BrowserCache",
    "BrowserCapabilities",
    "BrowserError",
    "BrowserPolicy",
    "BrowserRealClient",
    "ProjectWebIndex",
    "ResearchClaim",
    "ResearchResult",
    "ExplorePolicy",
    "ExploreResult",
    "ExploreStep",
    "ExtractedLink",
    "HttpTransport",
    "MapTransport",
    "PageMarkdown",
    "ResearchPack",
    "live_grounding_oracle",
    "score_live_grounding_run",
    "judge_model_answer",
    "TransportResponse",
    "browser_toolkit",
    "canonical_url",
    "classify_network_target",
    "create_browser_agent_kit",
    "default_cache_root",
    "default_transport",
    "detect_soft_block",
    "explore_url",
    "extract_json_ld",
    "extract_links",
    "extract_page",
    "extract_page_metadata",
    "extract_text",
    "extract_title",
    "html_table_to_markdown",
    "is_robots_allowed",
    "parse_core_model",
    "parse_robots_txt",
    "extract_urls_from_text",
    "finalize_research_pack_v2",
    "fetch_markdown",
    "format_readme_bundle",
    "gather_web_research",
    "gather_deep_web_research",
    "host_allowed",
    "host_score",
    "html_to_markdown",
    "keyword_compress",
    "make_fixture_map_transport",
    "make_html_to_markdown_tool",
    "make_deep_web_research_tool",
    "make_search_query_from_task",
    "make_research_queries",
    "make_transport",
    "make_web_explore_tool",
    "make_web_fetch_markdown_tool",
    "make_web_fetch_tool",
    "make_web_research_tool",
    "make_web_search_tool",
    "map_with_concurrency",
    "normalize_host",
    "page_from_html",
    "parse_url",
    "policy_from_args",
    "prefer_main_content",
    "rank_search_hits",
    "register_browser_tools",
    "register_web_explorer_tools",
    "research_prompt_section",
    "resolve_url",
    "search_google",
    "search_duckduckgo",
    "search_wikipedia",
    "smart_truncate",
    "to_readme_markdown",
    "url_allowed",
    "web_fetch_markdown",
    "web_search",
    "write_research_checkpoint",
    "UserBrowserBridge",
    "UserBrowserPageBridge",
    "DefaultBrowserBridge",
    "DefaultBrowserBridgeError",
    "explore_user_browser",
    "fetch_user_browser_page",
    "is_user_browser_bridge",
    "is_user_browser_page_bridge",
    "search_user_browser",
    "search_user_browser_many",
    "explore_default_browser",
    "fetch_default_browser_page",
    "is_default_browser_bridge",
    "search_default_browser",
    "search_default_browser_many",
]
