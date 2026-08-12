from handoffkit.browser import (
    create_browser_agent_kit,
    detect_soft_block,
    explore_url,
    extract_title,
    gather_deep_web_research,
    gather_web_research,
    html_to_markdown,
    make_fixture_map_transport,
    rank_search_hits,
    register_browser_tools,
    smart_truncate,
    web_fetch_markdown,
    web_search,
)
from handoffkit.recipes.web import run_web_grounded_answer
from handoffkit.tool_execution import ToolRegistry


def test_html_to_markdown_fixture_home():
    transport = make_fixture_map_transport()
    page = transport.get("https://fixture.local/")
    md = html_to_markdown(page.body, base_url="https://fixture.local/")
    assert "Fixture Home" in extract_title(page.body)
    assert "Welcome to Fixture" in md
    assert "secret_should_not_appear" not in md


def test_web_fetch_markdown_offline():
    transport = make_fixture_map_transport()
    result = web_fetch_markdown("https://fixture.local/about.html", transport=transport)
    assert result["success"] is True
    assert "About" in result["markdown"]


def test_gather_web_research_seed_only():
    transport = make_fixture_map_transport()
    pack = gather_web_research(
        transport=transport,
        seed_urls=["https://fixture.local/"],
        auto_search=False,
        max_pages=1,
    )
    assert pack["pages_ok"] == 1
    assert pack["urls_fetched"]


def test_gather_deep_web_research_is_background_only_and_bounded():
    transport = make_fixture_map_transport()
    pack = gather_deep_web_research(
        task="Explain the fixture guide.",
        seed_urls=["https://fixture.local/"],
        transport=transport,
        max_pages=3,
        max_depth=1,
        max_sub_queries=2,
        auto_search=False,
    )
    assert pack.mode == "deep_search_then_explore"
    assert pack.metadata["execution_mode"] == "background_http"
    assert pack.metadata["user_browser_required"] is False
    assert pack.metadata["max_depth"] == 1
    assert pack.pages_ok >= 2
    assert any(step["tool"] == "web_explore_step" for step in pack.steps)
    assert "Fixture" in pack.markdown_context or "Guide" in pack.markdown_context


def test_gather_deep_web_research_expands_queries_through_background_transport():
    transport = make_fixture_map_transport()
    transport.set_page(
        "https://html.duckduckgo.com/html/?q=OpenAI+product+docs",
        '<a class="result__a" href="https://fixture.local/">Fixture</a>',
    )
    transport.set_page(
        "https://html.duckduckgo.com/html/?q=OpenAI+security",
        '<a class="result__a" href="https://fixture.local/about.html">About</a>',
    )
    pack = gather_deep_web_research(
        task="OpenAI product docs. OpenAI security.",
        transport=transport,
        max_pages=3,
        max_depth=1,
        max_sub_queries=2,
        max_results_per_query=2,
    )
    assert pack.queries == ["OpenAI product docs", "OpenAI security"]
    assert sum(step.get("tool") == "web_search" for step in pack.steps) == 2
    assert len(pack.metadata["candidates"]) == 2
    assert pack.pages_ok >= 2


def test_web_search_with_map_endpoints():
    transport = make_fixture_map_transport()
    transport.set_page(
        "https://html.duckduckgo.com/html/?q=OpenAI",
        '<a href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fopenai.com%2F">x</a>',
    )
    transport.set_page(
        "https://en.wikipedia.org/w/api.php?action=opensearch&format=json&limit=4&search=OpenAI",
        '["OpenAI", ["OpenAI"], [""], ["https://en.wikipedia.org/wiki/OpenAI"]]',
    )
    result = web_search("OpenAI", transport=transport, max_results=4)
    assert result["success"] is True
    assert result["count"] >= 1
    assert result["providers_requested"] == ["duckduckgo", "wikipedia"]
    assert "duckduckgo" in result["providers_used"]

    wiki_only = web_search("OpenAI", transport=transport, max_results=4, providers=["wiki"])
    assert wiki_only["success"] is True
    assert wiki_only["providers_requested"] == ["wiki"]
    assert wiki_only["providers_used"] == ["wikipedia"]
    assert wiki_only["errors"] == []

    unavailable = web_search("OpenAI", transport=transport, providers=["bing"])
    assert unavailable["success"] is False
    assert unavailable["error_code"] == "provider_unavailable"
    assert "unsupported provider" in unavailable["errors"][0]


def test_explore_bfs_fixture():
    transport = make_fixture_map_transport()
    result = explore_url(
        "https://fixture.local/",
        policy={"max_depth": 1, "max_pages": 4, "same_host_only": True},
        transport=transport,
    )
    assert result.success is True
    assert result.pages_fetched >= 2
    assert any("about" in s.url for s in result.steps if s.success)


def test_create_browser_agent_kit_registers_tools():
    kit = create_browser_agent_kit({"fixture": True})
    names = sorted(t.name for t in kit["tools"])
    assert names == [
        "html_to_markdown",
        "web_deep_research",
        "web_explore",
        "web_fetch",
        "web_fetch_markdown",
        "web_research",
        "web_search",
    ]
    registry = ToolRegistry()
    register_browser_tools(registry, kit["transport"])
    page = registry.get("web_fetch_markdown").run(url="https://fixture.local/")
    assert page["success"] is True
    deep = registry.get("web_deep_research").run(
        query="fixture",
        seed_urls=["https://fixture.local/"],
        auto_search=False,
        max_pages=2,
        max_depth=1,
    )
    assert deep["success"] is True
    assert deep["metadata"]["user_browser_required"] is False


def test_rank_and_soft_block_helpers():
    ranked = rank_search_hits(
        [
            {"title": "NIH", "url": "https://www.nih.gov/foo"},
            {"title": "Social", "url": "https://twitter.com/x"},
        ]
    )
    assert ranked[0]["url"].endswith("/foo")
    assert detect_soft_block("Just a moment... cloudflare", 403)["blocked"] is True
    truncated = smart_truncate("a" * 100, 40)
    assert "truncated" in truncated.lower() or len(truncated) <= 60


def test_run_web_grounded_answer_offline():
    transport = make_fixture_map_transport()

    class _Prov:
        model = "echo"

        def generate(self, prompt: str) -> str:
            return "grounded-answer"

    # Map transport has no search endpoints → use seed research path via gather directly
    pack = gather_web_research(
        seed_urls=["https://fixture.local/about.html"],
        seed_only=True,
        transport=transport,
        max_pages=1,
    )
    assert pack.pages_ok == 1

    # With search stubs, grounded answer can succeed
    transport.set_page(
        "https://html.duckduckgo.com/html/?q=About+Fixture",
        '<a href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Ffixture.local%2Fabout.html">x</a>',
    )
    transport.set_page(
        "https://en.wikipedia.org/w/api.php?action=opensearch&format=json&limit=2&search=About%20Fixture",
        '["About Fixture", ["About"], [""], ["https://fixture.local/about.html"]]',
    )
    out = run_web_grounded_answer(
        "About Fixture",
        transport=transport,
        max_pages=1,
        provider=_Prov(),
    )
    assert out["success"] is True
    assert out["answer"] == "grounded-answer"


def test_browser_live_search():
    import os

    if os.environ.get("HANDOFFKIT_BROWSER_LIVE") != "1":
        return
    result = web_search("HandoffKit protocol", max_results=4)
    assert result["success"] is True
    assert result["count"] >= 1
