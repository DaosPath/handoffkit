"""Tests for the searxng search provider (Dodo Explorer / self-hosted SearXNG)."""

from __future__ import annotations

import pytest

from handoffkit.browser import make_fixture_map_transport
from handoffkit.browser.search import (
    SUPPORTED_SEARCH_PROVIDERS,
    provider_engine,
    search_searxng,
    web_search,
)

SEARXNG_BODY = """{
  "query": "OpenAI",
  "results": [
    {"title": "OpenAI API", "url": "https://openai.com/api"},
    {"title": "OpenAI Blog", "url": "https://openai.com/blog"},
    {"title": "no url", "url": ""},
    {"title": "javascript:void(0)", "url": "javascript:void(0)"}
  ],
  "unresponsive_engines": []
}"""


def _searx_url(base="http://127.0.0.1:8888"):
    return f"{base}/search?q=OpenAI&format=json"


def test_searxng_is_supported_provider():
    assert "searxng" in SUPPORTED_SEARCH_PROVIDERS
    assert provider_engine(["searxng"]) == "searxng_json"


def test_search_searxng_parses_json_results(monkeypatch):
    transport = make_fixture_map_transport()
    transport.set_page(_searx_url(), SEARXNG_BODY)
    hits = search_searxng(
        "OpenAI",
        transport=transport,
        base_url="http://127.0.0.1:8888",
        max_results=4,
    )
    urls = [h["url"] for h in hits]
    assert urls == ["https://openai.com/api", "https://openai.com/blog"]


def test_search_searxng_requires_base_url():
    monkeypatch_delenv = pytest.MonkeyPatch()
    monkeypatch_delenv.delenv("HANDOFFKIT_SEARXNG_URL", raising=False)
    with pytest.raises(ValueError):
        search_searxng("OpenAI")
    monkeypatch_delenv.undo()


def test_web_search_searxng_provider_end_to_end(monkeypatch):
    monkeypatch.setenv("HANDOFFKIT_SEARXNG_URL", "http://127.0.0.1:8888")
    transport = make_fixture_map_transport()
    transport.set_page(_searx_url(), SEARXNG_BODY)
    result = web_search(
        "OpenAI",
        transport=transport,
        providers=["searxng"],
        max_results=4,
    )
    assert result["success"] is True
    assert result["providers_requested"] == ["searxng"]
    assert result["providers_used"] == ["searxng"]
    assert result["count"] >= 1
    assert all(r["url"].startswith("https://") for r in result["results"])


def test_web_search_searxng_alias_dodo(monkeypatch):
    monkeypatch.setenv("HANDOFFKIT_SEARXNG_URL", "http://127.0.0.1:8888")
    transport = make_fixture_map_transport()
    transport.set_page(_searx_url(), SEARXNG_BODY)
    result = web_search(
        "OpenAI",
        transport=transport,
        providers=["dodo"],
        max_results=2,
    )
    assert result["providers_used"] == ["searxng"]


def test_web_search_searxng_unconfigured_reports_gracefully(monkeypatch):
    monkeypatch.delenv("HANDOFFKIT_SEARXNG_URL", raising=False)
    monkeypatch.delenv("HANDOFFKIT_SEARXNG_URLS", raising=False)
    transport = make_fixture_map_transport()
    result = web_search(
        "OpenAI",
        transport=transport,
        providers=["searxng"],
        max_results=4,
    )
    assert result["success"] is False
    assert any("no base URL" in e for e in result["errors"])
    codes = {t["error_code"] for t in result["provider_trace"]}
    assert "provider_unavailable" in codes


def _searx_url_with(base, extra=""):
    return f"{base}/search?q=OpenAI&format=json{extra}"


def test_search_searxng_engines_categories_page(monkeypatch):
    monkeypatch.delenv("HANDOFFKIT_SEARXNG_URL", raising=False)
    monkeypatch.delenv("HANDOFFKIT_SEARXNG_URLS", raising=False)
    transport = make_fixture_map_transport()
    transport.set_page(
        _searx_url_with(
            "http://127.0.0.1:8888", "&engines=brave,mojeek&categories=general&pageno=2"
        ),
        SEARXNG_BODY,
    )
    result = web_search(
        "OpenAI",
        transport=transport,
        providers=["searxng"],
        max_results=4,
        searxng={
            "base_url": "http://127.0.0.1:8888",
            "engines": ["brave", "mojeek"],
            "categories": "general",
            "page": 2,
        },
    )
    assert result["success"] is True
    assert result["providers_used"] == ["searxng"]


def test_search_searxng_rejects_unknown_category():
    transport = make_fixture_map_transport()
    result = web_search(
        "OpenAI",
        transport=transport,
        providers=["searxng"],
        max_results=4,
        searxng={"base_url": "http://127.0.0.1:8888", "categories": ["telepathy"]},
    )
    assert result["success"] is False
    codes = {t["error_code"] for t in result["provider_trace"]}
    assert "searxng_invalid_options" in codes


def test_search_searxng_falls_over_to_next_instance(monkeypatch):
    monkeypatch.delenv("HANDOFFKIT_SEARXNG_URL", raising=False)
    monkeypatch.delenv("HANDOFFKIT_SEARXNG_URLS", raising=False)
    transport = make_fixture_map_transport()
    transport.set_page(
        _searx_url_with("http://127.0.0.1:8888"), '{"query": "x", "results": []}'
    )
    transport.set_page(_searx_url_with("http://127.0.0.1:8889"), SEARXNG_BODY)
    result = web_search(
        "OpenAI",
        transport=transport,
        providers=["searxng"],
        max_results=4,
        searxng={"base_urls": ["http://127.0.0.1:8888", "http://127.0.0.1:8889"]},
    )
    assert result["success"] is True
    assert [r["url"] for r in result["results"]] == [
        "https://openai.com/api",
        "https://openai.com/blog",
    ]


def test_search_searxng_safesearch_language_and_infoboxes():
    from handoffkit.browser.search import search_searxng

    body = """{"query": "x", "results": [],
      "infoboxes": [{"content": "OpenAI", "urls": [{"title": "OpenAI", "url": "https://openai.com?utm_source=x"}]}]}"""
    transport = make_fixture_map_transport()
    transport.set_page(
        "http://127.0.0.1:8888/search?q=OpenAI&format=json&safesearch=1&language=en",
        body,
    )
    hits = search_searxng(
        "OpenAI",
        transport=transport,
        base_url="http://127.0.0.1:8888",
        safesearch=1,
        language="en",
    )
    assert [h["url"] for h in hits] == ["https://openai.com?utm_source=x"]


def test_search_searxng_rejects_bad_options():
    from handoffkit.browser.search import search_searxng

    transport = make_fixture_map_transport()
    with pytest.raises(ValueError):
        search_searxng(
            "x", transport=transport, base_url="http://127.0.0.1:8888", categories=["telepathy"]
        )
    with pytest.raises(ValueError):
        search_searxng("x", transport=transport, base_url="http://127.0.0.1:8888", page=0)


def test_canonical_search_url_strips_tracking():
    from handoffkit.browser.search import canonical_search_url

    assert (
        canonical_search_url("https://example.test/a?utm_source=x&b=1#frag")
        == "https://example.test/a?b=1"
    )
    assert canonical_search_url("not a url") == "not a url"


def test_web_search_dedups_tracking_variants(monkeypatch):
    monkeypatch.setenv("HANDOFFKIT_BRAVE_API_KEY", "k")
    monkeypatch.setenv("HANDOFFKIT_BING_API_KEY", "k")
    transport = make_fixture_map_transport()
    transport.set_page(
        "https://api.search.brave.com/res/v1/web/search?q=OpenAI&count=8",
        """{"web": {"results": [{"title": "A", "url": "https://openai.com/api?utm_source=x"}]}}""",
    )
    transport.set_page(
        "https://api.bing.microsoft.com/v7.0/search?q=OpenAI&count=8&responseFilter=Webpages",
        """{"webPages": {"value": [{"name": "A", "url": "https://openai.com/api?fbclid=y"}]}}""",
    )
    result = web_search("OpenAI", transport=transport, providers=["brave", "bing"])
    assert result["success"] is True
    assert [r["url"] for r in result["results"]] == ["https://openai.com/api"]


class _FlakyTransport:
    """Fails once with 429, then serves the body."""

    def __init__(self, url, body):
        self._url = url
        self._body = body
        self.calls = 0

    def get(self, url, timeout_ms=0, headers=None):
        from handoffkit.browser.transport import TransportResponse

        self.calls += 1
        if self.calls == 1:
            return TransportResponse(status=429, body="", headers={})
        return TransportResponse(status=200, body=self._body, headers={})


def test_json_retry_recovers_after_429(monkeypatch):
    from handoffkit.browser import search as search_module

    monkeypatch.setattr(search_module.time, "sleep", lambda seconds: None)
    transport = _FlakyTransport(
        "https://api.search.brave.com/res/v1/web/search?q=OpenAI&count=4",
        '{"web": {"results": [{"title": "A", "url": "https://openai.com/api"}]}}',
    )
    hits = search_module.search_brave("OpenAI", transport=transport, api_key="k", max_results=4)
    assert [h["url"] for h in hits] == ["https://openai.com/api"]
    assert transport.calls == 2
