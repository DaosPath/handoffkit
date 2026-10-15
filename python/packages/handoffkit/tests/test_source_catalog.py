"""Source catalog tests (parity with js source-catalog.test.js)."""

from __future__ import annotations

from handoffkit.browser import (
    ProjectWebIndex,
    SourceCatalog,
    create_source_catalog,
    make_fixture_map_transport,
    web_search,
)


def _setup(tmp_path):
    index = ProjectWebIndex(root=tmp_path, enabled=True).open()
    index.ingest(
        {"url": "https://docs.example.test/a", "title": "Alpha", "markdown": "alpha widgets guide"}
    )
    index.ingest(
        {
            "url": "https://blog.example.test/b",
            "title": "Beta",
            "markdown": "beta widgets widgets widgets",
        }
    )
    catalog = SourceCatalog(tmp_path).load()
    catalog.add({"url": "https://docs.example.test/a", "category": "docs", "weight": 5})
    catalog.add({"url": "https://blog.example.test/b", "category": "blog", "weight": 1})
    return index, catalog


def test_catalog_crud_round_trip(tmp_path):
    catalog = create_source_catalog(tmp_path).load()
    assert catalog.list() == []
    catalog.add({"url": "https://docs.example.test/a", "category": "docs", "weight": 2})
    assert catalog.list()[0]["weight"] == 2
    assert len(catalog.list(category="docs")) == 1
    assert catalog.set_weight("https://docs.example.test/a", 7) is True
    assert catalog.list()[0]["weight"] == 7
    assert catalog.remove("https://docs.example.test/a") is True
    assert catalog.list() == []
    assert SourceCatalog(tmp_path).load().list() == []


def test_catalog_search_prefers_higher_weights(tmp_path):
    index, catalog = _setup(tmp_path)
    try:
        found = catalog.search(index, "widgets")
        assert found["hits"][0]["url"] == "https://docs.example.test/a"
        assert found["hits"][0]["weight"] == 5
        scoped = catalog.search(index, "widgets", category="blog")
        assert [h["url"] for h in scoped["hits"]] == ["https://blog.example.test/b"]
        catalog.remove("https://docs.example.test/a")
        catalog.remove("https://blog.example.test/b")
        assert catalog.search(index, "widgets")["error_code"] == "catalog_empty"
    finally:
        index.close()


def test_web_search_catalog_provider_weighted_and_fail_closed(tmp_path):
    index, catalog = _setup(tmp_path)
    transport = make_fixture_map_transport()
    try:
        result = web_search(
            "widgets",
            transport=transport,
            providers=["catalog"],
            catalog={"index": index, "catalog": catalog},
        )
        assert result["success"] is True
        assert result["providers_used"] == ["catalog"]
        assert result["results"][0]["url"] == "https://docs.example.test/a"
        missing = web_search("widgets", transport=transport, providers=["catalog"])
        assert missing["success"] is False
        trace = next(t for t in missing["provider_trace"] if t["provider"] == "catalog")
        assert trace["error_code"] == "catalog_not_configured"
    finally:
        index.close()
