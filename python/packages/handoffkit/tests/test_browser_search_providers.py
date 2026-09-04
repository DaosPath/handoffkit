"""Tests for the Brave/Bing/Kagi JSON search providers (fail-closed API keys)."""

from __future__ import annotations

import pytest

from handoffkit.browser import make_fixture_map_transport
from handoffkit.browser.search import (
    SUPPORTED_SEARCH_PROVIDERS,
    provider_engine,
    search_bing,
    search_brave,
    search_kagi,
    search_marginalia,
    search_mojeek,
    search_startpage,
    suggest_queries,
    web_search,
)

BRAVE_BODY = """{
  "query": {"original": "OpenAI"},
  "web": {"results": [
    {"title": "OpenAI API", "url": "https://openai.com/api"},
    {"title": "OpenAI Blog", "url": "https://openai.com/blog"},
    {"title": "no url", "url": ""}
  ]}
}"""

BING_BODY = """{
  "queryContext": {"originalQuery": "OpenAI"},
  "webPages": {"value": [
    {"name": "OpenAI API", "url": "https://openai.com/api"},
    {"name": "OpenAI Blog", "url": "https://openai.com/blog"},
    {"name": "no url", "url": ""}
  ]}
}"""

KAGI_BODY = """{
  "meta": {"id": "abc"},
  "data": [
    {"t": 0, "title": "OpenAI API", "url": "https://openai.com/api"},
    {"t": 0, "title": "OpenAI Blog", "url": "https://openai.com/blog"},
    {"t": 0, "title": "no url", "url": ""}
  ]
}"""


def test_key_gated_providers_are_supported():
    for provider in ("brave", "bing", "kagi", "mojeek", "marginalia", "startpage"):
        assert provider in SUPPORTED_SEARCH_PROVIDERS
    assert provider_engine(["brave"]) == "brave_json"
    assert provider_engine(["bing"]) == "bing_json"
    assert provider_engine(["kagi"]) == "kagi_json"
    assert provider_engine(["mojeek"]) == "mojeek_html"
    assert provider_engine(["marginalia"]) == "marginalia_html"
    assert provider_engine(["startpage"]) == "startpage_html"


def test_search_brave_parses_json_results():
    transport = make_fixture_map_transport()
    transport.set_page(
        "https://api.search.brave.com/res/v1/web/search?q=OpenAI&count=4",
        BRAVE_BODY,
    )
    hits = search_brave("OpenAI", transport=transport, api_key="test-key", max_results=4)
    assert [h["url"] for h in hits] == ["https://openai.com/api", "https://openai.com/blog"]


def test_search_bing_parses_json_results():
    transport = make_fixture_map_transport()
    transport.set_page(
        "https://api.bing.microsoft.com/v7.0/search?q=OpenAI&count=4&responseFilter=Webpages",
        BING_BODY,
    )
    hits = search_bing("OpenAI", transport=transport, api_key="test-key", max_results=4)
    assert [h["url"] for h in hits] == ["https://openai.com/api", "https://openai.com/blog"]


def test_search_kagi_parses_json_results():
    transport = make_fixture_map_transport()
    transport.set_page("https://kagi.com/api/v0/search?q=OpenAI", KAGI_BODY)
    hits = search_kagi("OpenAI", transport=transport, api_key="test-key", max_results=4)
    assert [h["url"] for h in hits] == ["https://openai.com/api", "https://openai.com/blog"]


@pytest.mark.parametrize(
    ("provider", "env_key", "search_fn"),
    [
        ("brave", "HANDOFFKIT_BRAVE_API_KEY", search_brave),
        ("bing", "HANDOFFKIT_BING_API_KEY", search_bing),
        ("kagi", "HANDOFFKIT_KAGI_API_KEY", search_kagi),
    ],
)
def test_key_gated_providers_require_api_key(monkeypatch, provider, env_key, search_fn):
    monkeypatch.delenv(env_key, raising=False)
    with pytest.raises(ValueError):
        search_fn("OpenAI")


def test_web_search_key_gated_providers_fail_closed(monkeypatch):
    for env_key in (
        "HANDOFFKIT_BRAVE_API_KEY",
        "HANDOFFKIT_BING_API_KEY",
        "HANDOFFKIT_KAGI_API_KEY",
    ):
        monkeypatch.delenv(env_key, raising=False)
    transport = make_fixture_map_transport()
    for provider in ("brave", "bing", "kagi"):
        result = web_search("OpenAI", transport=transport, providers=[provider])
        assert result["success"] is False
        trace = next(t for t in result["provider_trace"] if t["provider"] == provider)
        assert trace["error_code"] == "provider_unavailable"
        assert trace["fallback_reason"] == f"{provider}_unconfigured"


def test_keyless_html_engines_parse_anchors():
    transport = make_fixture_map_transport()
    transport.set_page(
        "https://www.mojeek.com/search?q=OpenAI",
        '<html><body><a class="title" href="https://openai.com/api">OpenAI API</a>'
        '<a href="https://www.mojeek.com/preferences">prefs</a></body></html>',
    )
    transport.set_page(
        "https://search.marginalia.nu/search?query=OpenAI",
        '<html><body><a href="https://openai.com/blog">OpenAI Blog</a></body></html>',
    )
    transport.set_page(
        "https://www.startpage.com/sp/search?query=OpenAI",
        '<html><body><a class="w-gl__result-title" href="https://openai.com/api">OpenAI API</a>'
        '<a href="https://www.startpage.com/r">internal</a></body></html>',
    )
    assert [h["url"] for h in search_mojeek("OpenAI", transport=transport)] == [
        "https://openai.com/api"
    ]
    assert [h["url"] for h in search_marginalia("OpenAI", transport=transport)] == [
        "https://openai.com/blog"
    ]
    assert [h["url"] for h in search_startpage("OpenAI", transport=transport)] == [
        "https://openai.com/api"
    ]
    result = web_search("OpenAI", transport=transport, providers=["mojeek"], max_results=4)
    assert result["success"] is True
    assert result["providers_used"] == ["mojeek"]


def test_suggest_queries_parses_and_fails_closed(monkeypatch):
    transport = make_fixture_map_transport()
    transport.set_page(
        "https://api.search.brave.com/res/v1/suggest?q=Open",
        '{"suggestions": [{"query": "OpenAI"}, "OpenAI API"]}',
    )
    transport.set_page(
        "https://api.bing.microsoft.com/v7.0/Suggestions?q=Open",
        '{"suggestionGroups": [{"searchSuggestions": [{"displayText": "OpenAI"}]}]}',
    )
    monkeypatch.setenv("HANDOFFKIT_BRAVE_API_KEY", "k")
    monkeypatch.setenv("HANDOFFKIT_BING_API_KEY", "k")
    assert suggest_queries("brave", "Open", transport=transport)["suggestions"] == [
        "OpenAI",
        "OpenAI API",
    ]
    assert suggest_queries("bing", "Open", transport=transport)["suggestions"] == ["OpenAI"]
    assert suggest_queries("nope", "Open", transport=transport)["error_code"] == (
        "unsupported_provider"
    )
    monkeypatch.delenv("HANDOFFKIT_BRAVE_API_KEY", raising=False)
    assert suggest_queries("brave", "Open", transport=transport)["error_code"] == (
        "provider_unavailable"
    )


def test_searxng_default_engines_from_env(monkeypatch):
    monkeypatch.delenv("HANDOFFKIT_SEARXNG_URL", raising=False)
    monkeypatch.setenv("HANDOFFKIT_SEARXNG_URLS", "http://127.0.0.1:8888")
    monkeypatch.setenv("HANDOFFKIT_SEARXNG_ENGINES", "brave,mojeek")
    transport = make_fixture_map_transport()
    transport.set_page(
        "http://127.0.0.1:8888/search?q=OpenAI&format=json&engines=brave,mojeek",
        '{"query": "x", "results": [{"title": "A", "url": "https://openai.com/api"}]}',
    )
    result = web_search("OpenAI", transport=transport, providers=["searxng"], max_results=4)
    assert result["success"] is True
