from handoffkit.browser import (
    create_browser_agent_kit,
    detect_soft_block,
    explore_url,
    extract_title,
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


def test_web_search_with_map_endpoints():
    transport = make_fixture_map_transport()
    transport.set_page(
        "https://html.duckduckgo.com/html/?q=OpenAI",
        '<a href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fopenai.com%2F">x</a>',
    )
    transport.set_page(
        "https://en.wikipedia.org/w/api.php?action=opensearch&format=json&limit=8&search=OpenAI",
        '["OpenAI", ["OpenAI"], [""], ["https://en.wikipedia.org/wiki/OpenAI"]]',
    )
    result = web_search("OpenAI", transport=transport, max_results=4)
    assert result["success"] is True
    assert result["count"] >= 1


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
