import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from handoffkit.browser import (
    DEFAULT_BROWSER_PROVIDER,
    DefaultBrowserBridge,
    create_browser_agent_kit,
    detect_soft_block,
    explore_url,
    explore_user_browser,
    extract_title,
    gather_deep_web_research,
    gather_web_research,
    html_to_markdown,
    make_fixture_map_transport,
    rank_search_hits,
    register_browser_tools,
    search_user_browser_many,
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


def test_google_provider_uses_handoffkit_transport_and_drops_sponsored_redirects():
    transport = make_fixture_map_transport()
    transport.set_page(
        "https://www.google.com/search?hl=en&num=8&q=OpenAI",
        """
        <html><body>
          <a href="/aclk?sa=l&amp;adurl=https%3A%2F%2Fads.example%2F">Sponsored</a>
          <a href="/url?q=https%3A%2F%2Fexample.org%2Fpaper&amp;sa=U">Primary paper</a>
          <a href="/search?q=OpenAI">Google navigation</a>
          <a href="https://example.org/direct">Direct source</a>
        </body></html>
        """,
    )
    result = web_search("OpenAI", transport=transport, providers=["google"], max_results=4)
    assert result["success"] is True
    assert result["providers_used"] == ["google"]
    assert result["engine"] == "google_html"
    assert [item["url"] for item in result["results"]] == [
        "https://example.org/direct",
        "https://example.org/paper",
    ]


def test_html_extraction_removes_ad_and_consent_containers():
    html = """<html><head><title>Evidence</title></head><body>
      <div class="ad-banner"><a href="https://ads.example/click">Buy</a></div>
      <div id="cookie-consent">Accept cookies</div>
      <main><p>Primary evidence remains.</p><a href="/source">Source</a></main>
    </body></html>"""
    from handoffkit.browser import extract_links, extract_text

    text = extract_text(html)
    assert "Primary evidence remains" in text
    assert "Buy" not in text and "Accept cookies" not in text
    assert [link.absolute for link in extract_links(html, "https://example.org/")] == [
        "https://example.org/source"
    ]


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
    assert result["providers_requested"] == [
        "google_browser",
        "project_index",
        "google_http",
        "duckduckgo",
        "wikipedia",
    ]
    assert "duckduckgo" in result["providers_used"]

    wiki_only = web_search("OpenAI", transport=transport, max_results=4, providers=["wiki"])
    assert wiki_only["success"] is True
    assert wiki_only["providers_requested"] == ["wiki"]
    assert wiki_only["providers_used"] == ["wikipedia"]
    assert wiki_only["errors"] == []

    unavailable = web_search("OpenAI", transport=transport, providers=["not_a_provider"])
    assert unavailable["success"] is False
    assert unavailable["error_code"] == "provider_unavailable"
    assert "unsupported provider" in unavailable["errors"][0]


def test_user_browser_provider_uses_explicit_host_bridge_and_sanitizes_hits():
    class Bridge:
        def __init__(self):
            self.observed = None

        def search(self, query, **options):
            self.observed = (query, options)
            return {
                "results": [
                    {"title": "User result", "url": "https://example.org/from-user#fragment"},
                    {"title": "unsafe", "url": "javascript:alert(1)"},
                    {"title": "duplicate", "url": "https://example.org/from-user"},
                ]
            }

    bridge = Bridge()
    result = web_search(
        "local browser query",
        providers=["user_browser"],
        user_browser=bridge,
        max_results=4,
    )
    assert result["success"] is True
    assert result["providers_requested"] == ["user_browser"]
    assert result["providers_used"] == ["user_browser"]
    assert result["engine"] == "user_browser_bridge"
    assert len(result["results"]) == 1
    assert result["results"][0]["url"] == "https://example.org/from-user"
    assert bridge.observed[0] == "local browser query"
    assert bridge.observed[1]["max_results"] == 4


def test_user_browser_search_many_merges_query_provenance_and_partial_errors():
    calls = []

    class Bridge:
        def search(self, query, **options):
            calls.append(query)
            if query == "missing":
                return {"results": [], "error_code": "empty", "error": "no session hit"}
            return {
                "results": [
                    {
                        "title": f"Result {query}",
                        "url": "https://example.org/shared",
                        "snippet": query,
                    },
                    {"title": query, "url": f"https://example.org/{query}"},
                ]
            }

    result = search_user_browser_many(
        Bridge(), ["alpha", "beta", "missing"], max_queries=3, max_results_per_query=3
    )
    assert result["success"] is True
    assert result["queries"] == ["alpha", "beta", "missing"]
    assert set(calls) == {"alpha", "beta", "missing"}
    assert len(calls) == 3
    shared = next(hit for hit in result["hits"] if hit["url"] == "https://example.org/shared")
    assert shared["queries"] == ["alpha", "beta"]
    assert result["metadata"]["partial"] is True
    assert any("missing" in error for error in result["errors"])


def test_default_browser_bridge_uses_bounded_loopback_json_and_feeds_research():
    calls = []

    class Response:
        status = 200
        code = 200

        def __init__(self, payload):
            self.payload = json.dumps(payload).encode("utf-8")

        def read(self, _limit):
            return self.payload

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

    def opener(request, timeout):
        calls.append((request, timeout))
        payload = json.loads(request.data.decode("utf-8"))
        if request.full_url.endswith("/search"):
            return Response(
                {
                    "results": [
                        {"title": "Default browser result", "url": "https://default.example/page"}
                    ]
                }
            )
        assert payload["url"] == "https://default.example/page"
        return Response(
            {
                "status": 200,
                "url": payload["url"],
                "final_url": payload["url"],
                "html": "<html><head><title>Default page</title></head><body><main><h1>Evidence</h1><p>Browser bridge page.</p></main></body></html>",  # noqa: E501
            }
        )

    bridge = DefaultBrowserBridge(
        endpoint="http://127.0.0.1:8765/v1",
        token="test-token",
        opener=opener,
    )
    assert bridge.provider == DEFAULT_BROWSER_PROVIDER
    result = gather_web_research(
        "default browser",
        providers=["default_browser"],
        user_browser=bridge,
        max_pages=1,
    )
    assert result.pages_ok == 1
    assert result.metadata["page_transport"] == "default_browser_bridge"
    assert result.metadata["default_browser_required"] is True
    assert len(calls) == 2
    assert calls[0][0].headers["Authorization"] == "Bearer test-token"
    assert not DefaultBrowserBridge(endpoint="http://remote.example:8765").configured
    missing = web_search("x", providers=["default_browser"])
    assert missing["error_code"] == "default_browser_bridge_required"


def test_default_browser_bridge_interoperates_over_real_loopback_tcp():
    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):  # noqa: N802
            length = int(self.headers.get("content-length", "0"))
            payload = json.loads(self.rfile.read(length) or b"{}")
            if self.path.endswith("/search"):
                body = {
                    "results": [
                        {
                            "title": "TCP result",
                            "url": f"http://127.0.0.1:{self.server.server_port}/page",
                        }
                    ]
                }
            else:
                assert self.path.endswith("/fetch")
                body = {
                    "status": 200,
                    "url": payload["url"],
                    "final_url": payload["url"],
                    "html": "<html><head><title>TCP page</title></head><body><main><p>Real loopback evidence.</p></main></body></html>",  # noqa: E501
                }
            encoded = json.dumps(body).encode("utf-8")
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

        def log_message(self, *_args):
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        bridge = DefaultBrowserBridge(endpoint=f"http://127.0.0.1:{server.server_port}/v1")
        pack = gather_web_research(
            "tcp default browser",
            providers=["default_browser"],
            user_browser=bridge,
            max_pages=1,
        )
        assert pack.pages_ok == 1
        assert pack.pages[0].title == "TCP page"
        assert pack.metadata["page_transport"] == "default_browser_bridge"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_user_browser_exploration_prioritizes_relevant_links_and_skips_actions():
    pages = {
        "https://example.org/root": {
            "title": "Root",
            "markdown": "root",
            "links": [
                {"href": "/logout", "text": "logout"},
                {"href": "/misc", "text": "misc"},
                {"href": "/guide", "text": "guide"},
            ],
        },
        "https://example.org/guide": {"title": "Guide", "markdown": "guide evidence", "links": []},
        "https://example.org/misc": {"title": "Misc", "markdown": "misc evidence", "links": []},
    }

    class Bridge:
        def fetch(self, url, **options):
            return {"url": url, **pages.get(url, {"error_code": "missing"})}

    result = explore_user_browser(
        Bridge(), "https://example.org/root", max_pages=2, max_depth=1, query="guide"
    )
    assert result["pages_fetched"] == 2
    assert result["steps"][1]["url"] == "https://example.org/guide"
    assert result["metadata"]["action_links_skipped"] == 1
    assert "https://example.org/logout" in result["steps"][0]["blocked_links"]


def test_user_browser_fails_closed_without_bridge_and_never_falls_back():
    result = web_search("needs user session", providers=["user_browser"])
    assert result["success"] is False
    assert result["error_code"] == "user_browser_bridge_required"
    assert result["providers_used"] == []
    assert "injected search bridge" in result["errors"][0]


def test_kit_carries_user_browser_bridge_and_uses_it_only_when_requested():
    class Bridge:
        def search(self, query, **options):
            return [{"title": "Session", "url": "https://example.org/session"}]

    bridge = Bridge()
    kit = create_browser_agent_kit({"providers": ["user_browser"], "user_browser": bridge})
    direct = kit["search"]("OpenAI")
    assert direct["success"] is True
    assert direct["providers_used"] == ["user_browser"]
    tool = kit["registry"].get("web_search").run(query="OpenAI")
    assert tool["success"] is True
    assert tool["providers_used"] == ["user_browser"]
    many = kit["search_many"](["OpenAI", "session"], max_queries=2)
    assert many["success"] is True
    assert many["metadata"]["queries_executed"] == 2


def test_user_browser_bridge_feeds_bounded_research_with_explicit_metadata():
    transport = make_fixture_map_transport()
    transport.set_page(
        "https://example.org/session",
        "<html><head><title>Session page</title></head>"
        "<body><main><p>session evidence</p></main></body></html>",
    )

    calls = []

    class Bridge:
        def search(self, query, **options):
            return [{"title": "Session", "url": "https://example.org/session"}]

        def fetch(self, url, **options):
            calls.append(url)
            return {
                "url": url,
                "title": "Session page",
                "markdown": "session evidence",
                "links": [],
            }

    pack = gather_web_research(
        "session evidence",
        transport=transport,
        providers=["user_browser"],
        user_browser=Bridge(),
        max_pages=1,
    )
    assert pack.pages_ok == 1
    assert pack.metadata["execution_mode"] == "background_user_browser_bridge"
    assert pack.metadata["user_browser_required"] is True
    assert pack.metadata["user_browser_bridge_configured"] is True
    assert "user_browser" in pack.metadata["providers_used"]
    assert calls == ["https://example.org/session"]
    assert "## Evidence" in pack.to_agent_markdown()
    assert "session evidence" in pack.to_dict()["agent_markdown"]


def test_user_browser_exploration_is_bounded_and_never_falls_back_to_http():
    transport = make_fixture_map_transport()
    transport.set_page("https://example.org/session", "<p>HTTP fallback must not be used</p>")
    pages = {
        "https://example.org/session": {
            "title": "Session root",
            "markdown": "root evidence",
            "links": [{"href": "/next", "text": "Next"}, {"href": "javascript:bad"}],
        },
        "https://example.org/next": {
            "title": "Session next",
            "markdown": "next evidence",
            "links": [{"href": "/session#again", "text": "Root"}],
        },
    }

    class Bridge:
        def search(self, query, **options):
            return [{"title": "Session", "url": "https://example.org/session"}]

        def fetch(self, url, **options):
            return {"url": url, **pages.get(url, {"error_code": "missing"})}

    pack = gather_web_research(
        "session",
        transport=transport,
        providers=["user_browser"],
        user_browser=Bridge(),
        max_pages=2,
        prefer_explore=True,
        max_depth=1,
    )
    assert pack.pages_ok == 2
    assert pack.metadata["page_transport"] == "user_browser_bridge"
    assert pack.urls_fetched == ["https://example.org/session", "https://example.org/next"]
    assert all("HTTP fallback" not in page.markdown for page in pack.pages)
    assert any(
        step["tool"] == "user_browser_explore_step" and step["depth"] == 1 for step in pack.steps
    )


def test_user_browser_research_expands_focused_query_variants_before_fetching():
    calls = []
    pages = {
        "https://example.org/alpha": {"title": "Alpha", "markdown": "alpha evidence", "links": []},
        "https://example.org/beta": {"title": "Beta", "markdown": "beta evidence", "links": []},
    }

    class Bridge:
        def search(self, query, **options):
            calls.append(query)
            return [{"title": query, "url": f"https://example.org/{query}"}]

        def fetch(self, url, **options):
            return {"url": url, **pages.get(url, {"error_code": "missing"})}

    pack = gather_web_research(
        "alpha",
        task="beta",
        providers=["user_browser"],
        user_browser=Bridge(),
        max_pages=2,
        max_sub_queries=2,
    )
    assert pack.queries == ["alpha", "beta"]
    assert calls == ["alpha", "beta"]
    assert pack.pages_ok == 2
    assert pack.metadata["search_query_count"] == 2
    assert "alpha evidence" in pack.to_agent_markdown()
    assert "beta evidence" in pack.to_agent_markdown()


def test_user_browser_research_fails_closed_without_page_bridge():
    transport = make_fixture_map_transport()
    transport.set_page("https://example.org/session", "<p>must not be read</p>")

    class Bridge:
        def search(self, query, **options):
            return []

    pack = gather_web_research(
        seed_urls=["https://example.org/session"],
        seed_only=True,
        transport=transport,
        providers=["user_browser"],
        user_browser=Bridge(),
        max_pages=1,
    )
    assert pack.pages_ok == 0
    assert pack.metadata["error_code"] == "user_browser_fetch_bridge_required"
    assert "injected fetch" in pack.error


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


def test_create_browser_agent_kit_carries_provider_defaults_into_helpers_and_tools():
    kit = create_browser_agent_kit({"fixture": True, "providers": ["wiki"]})
    kit["transport"].set_page(
        "https://en.wikipedia.org/w/api.php?action=opensearch&format=json&limit=6&search=OpenAI",
        '["OpenAI", ["OpenAI"], [""], ["https://en.wikipedia.org/wiki/OpenAI"]]',
    )
    direct = kit["search"]("OpenAI")
    assert direct["providers_requested"] == ["wiki"]
    assert direct["providers_used"] == ["wikipedia"]
    tool = kit["registry"].get("web_search").run(query="OpenAI")
    assert tool["success"] is True
    assert tool["providers_requested"] == ["wiki"]


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
            if "evidence_pages" in prompt:
                return '{"answer":"About Fixture grounded-answer","evidence_pages":"all"}'
            return '{"selected_urls":["https://fixture.local/about.html"]}'

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
    assert out["answer"] == "About Fixture grounded-answer"
    assert out["selection"]["valid"] is True
    assert out["answer_audit"]["coverage"] is True


def test_run_web_grounded_answer_honors_max_total_ms():
    import time as _time

    transport = make_fixture_map_transport()

    class _SlowProv:
        model = "slow"
        calls = 0

        def generate(self, prompt: str) -> str:
            type(self).calls += 1
            _time.sleep(0.03)
            return '{"selected_urls":["https://fixture.local/about.html"]}'

    transport.set_page(
        "https://html.duckduckgo.com/html/?q=Budget",
        '<a href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Ffixture.local%2Fabout.html">x</a>',
    )
    out = run_web_grounded_answer(
        "Budget",
        transport=transport,
        max_pages=1,
        provider=_SlowProv(),
        max_total_ms=5,
    )
    assert out["budget"]["max_total_ms"] == 5
    assert out["budget"]["exceeded"] is True
    assert _SlowProv.calls == 1
    assert out["answer"] == ""


def test_run_web_grounded_answer_builds_dossier_and_falls_back_deterministically():
    transport = make_fixture_map_transport()

    class _Prov:
        model = "fixture"

        def generate(self, prompt: str, **_options: object) -> str:
            if "Extract evidence for exactly ONE requirement" in prompt:
                return json.dumps(
                    {
                        "section_id": "method",
                        "findings": [
                            {
                                "status": "supported",
                                "statement": "The verified mechanism uses two explicit stages.",
                                "quote": "verified mechanism uses two explicit stages",
                                "evidence_pages": [1],
                            }
                        ],
                    }
                )
            if "Selecciona las páginas" in prompt:
                return '{"selected_urls":["https://fixture.local/dossier.html"]}'
            return "malformed final answer"

    transport.set_page(
        "https://html.duckduckgo.com/html/?q=Dossier",
        '<a href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Ffixture.local%2Fdossier.html">Dossier Evidence</a>',  # noqa: E501
    )
    transport.set_page(
        "https://fixture.local/dossier.html",
        "<html><head><title>Dossier Evidence</title></head><body><main><p>The verified mechanism uses two explicit stages.</p></main></body></html>",  # noqa: E501
    )
    out = run_web_grounded_answer(
        "Dossier",
        providers=["duckduckgo"],
        transport=transport,
        provider=_Prov(),
        max_pages=1,
        answer_retries=0,
        evidence_sections=[
            {
                "id": "method",
                "title": "Method",
                "render": "paragraph",
                "requirements": ["Explain the two stages.", "Confirm the verified mechanism."],
                "deterministic_evidence": [
                    {
                        "requirement": "Confirm the verified mechanism.",
                        "statement": "The verified mechanism uses two explicit stages.",
                        "quote": "verified mechanism uses two explicit stages",
                    }
                ],
            }
        ],
        synthesis_sections=[
            {
                "id": "summary",
                "title": "Summary",
                "render": "table",
                "columns": ["Claim", "Result"],
                "requirements": ["Combine the two verified claims."],
                "deterministic_findings": [
                    {
                        "requirement": "Combine the two verified claims.",
                        "statement": "Both checks support the verified two-stage mechanism.",
                        "cells": [
                            "Combined",
                            "Both checks support the verified two-stage mechanism.",
                        ],
                        "evidence_claims": ["method:0", "method:1"],
                    }
                ],
            }
        ],
        dossier_compose_mode="deterministic",
    )
    assert out["success"] is True
    assert out["evidence_dossier"]["valid"] is True
    assert (
        out["evidence_dossier"]["sections"][0]["findings"][0]["verification"]["quote_matched"]
        is True
    )
    assert "two explicit stages" in out["answer"]
    assert "Both checks support" in out["answer"]
    assert "| Claim | Result |" in out["answer"]
    assert "Direct evidence:" in out["answer"]


def test_run_web_grounded_answer_rejects_semantically_unrelated_real_quote():
    transport = make_fixture_map_transport()

    class _Prov:
        def generate(self, prompt: str, **_options: object) -> str:
            if "Extract evidence for exactly ONE requirement" in prompt:
                return json.dumps(
                    {
                        "section_id": "adoption",
                        "findings": [
                            {
                                "status": "supported",
                                "statement": "The estimator aggregates cohort-specific effects.",
                                "quote": "estimator aggregates cohort-specific effects",
                                "evidence_pages": [1],
                            }
                        ],
                    }
                )
            return '{"selected_urls":["https://fixture.local/adoption.html"]}'

    transport.set_page(
        "https://html.duckduckgo.com/html/?q=Adoption",
        '<a href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Ffixture.local%2Fadoption.html">Evidence</a>',
    )
    transport.set_page(
        "https://fixture.local/adoption.html",
        "<html><body><main>The estimator aggregates cohort-specific effects, but this page has no journal counts.</main></body></html>",  # noqa: E501
    )
    out = run_web_grounded_answer(
        "Adoption",
        providers=["duckduckgo"],
        transport=transport,
        provider=_Prov(),
        max_pages=1,
        evidence_sections=[
            {
                "id": "adoption",
                "requirements": [
                    "Report bibliometric adoption rates for AER, QJE, and JPE during 2020-2024."
                ],
            }
        ],
        dossier_compose_mode="deterministic",
    )
    finding = out["evidence_dossier"]["sections"][0]["findings"][0]
    assert finding["status"] == "not_found"
    assert "Evidence not found" in out["answer"]


def test_run_web_grounded_answer_merges_focused_native_browser_queries():
    transport = make_fixture_map_transport()

    class _Prov:
        model = "echo"

        def generate(self, prompt: str) -> str:
            if "evidence_pages" in prompt:
                return '{"answer":"About Fixture and Guide grounded-answer","evidence_pages":"all"}'
            return '{"selected_urls":["https://fixture.local/about.html"]}'

    transport.set_page(
        "https://www.google.com/search?hl=en&num=8&q=Fixture",
        '<a href="/url?q=https%3A%2F%2Ffixture.local%2Fabout.html&amp;sa=U">About Fixture</a>',
    )
    transport.set_page(
        "https://www.google.com/search?hl=en&num=8&q=fixture+guide",
        '<a href="/url?q=https%3A%2F%2Ffixture.local%2Fdocs%2Fguide.html&amp;sa=U">Fixture Guide</a>',  # noqa: E501
    )
    out = run_web_grounded_answer(
        "Fixture research",
        search_queries=["Fixture", "fixture guide"],
        providers=["google"],
        transport=transport,
        max_pages=2,
        provider=_Prov(),
    )
    assert out["success"] is True
    assert out["research"]["metadata"]["search_queries"] == ["Fixture", "fixture guide"]
    assert out["research"]["pages_ok"] == 2


def test_html_table_and_json_ld():
    from handoffkit.browser import extract_json_ld, html_table_to_markdown

    html = (
        '<html><head><script type="application/ld+json">{"@type":"Article"}</script></head>'
        "<body><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table></body></html>"
    )
    assert "| A | B |" in html_table_to_markdown(html)
    assert extract_json_ld(html)[0]["@type"] == "Article"


def test_web_search_provider_trace_and_strict_provider():
    transport = make_fixture_map_transport()
    result = web_search("OpenAI", transport=transport, providers=["wikipedia"])
    assert result["provider_trace"][0]["provider"] == "wikipedia"
    strict = web_search(
        "OpenAI",
        transport=transport,
        providers=["google_browser", "wikipedia"],
        strict_provider=True,
    )
    assert strict["error_code"] == "strict_provider_rejected"
    assert strict["success"] is False


def test_project_index_opt_in(tmp_path):
    from handoffkit.browser import ProjectWebIndex

    index = ProjectWebIndex(root=tmp_path, enabled=True).open()
    ingested = index.ingest(
        {
            "url": "https://example.org/a",
            "title": "Alpha",
            "markdown": "alpha evidence about widgets",
        }
    )
    assert ingested["ok"] is True
    found = index.search("widgets")
    assert found["hits"][0]["url"] == "https://example.org/a"
    assert "not a complete index" in found["disclaimer"]
    index.close()


def test_project_index_ranks_with_fts5(tmp_path):
    from handoffkit.browser import ProjectWebIndex

    index = ProjectWebIndex(root=tmp_path, enabled=True).open()
    index.ingest({"url": "https://example.org/a", "title": "Alpha", "markdown": "alpha widgets"})
    index.ingest(
        {"url": "https://example.org/b", "title": "Beta", "markdown": "beta widgets widgets widgets"}
    )
    found = index.search("widgets")
    assert found["backend"] == "fts5"
    assert found["hits"][0]["url"] == "https://example.org/b"
    index.close()


def test_browser_live_search():
    import os

    if os.environ.get("HANDOFFKIT_BROWSER_LIVE") != "1":
        return
    result = web_search("HandoffKit protocol", max_results=4)
    assert result["success"] is True
    assert result["count"] >= 1
