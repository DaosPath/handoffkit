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
