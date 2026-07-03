"""Documentation coverage for the final pre-1.0 stabilization release."""

from __future__ import annotations

from pathlib import Path


def test_pre_1_0_docs_exist_and_cover_required_topics() -> None:
    docs = {
        "PUBLIC_API.md": ["Agent", "RunTrace", "ProviderToolAdapter", "Compatibility Promise"],
        "MIGRATION_0_9.md": ["No breaking changes", "What Did Not Change", "handoffkit doctor"],
        "COMPATIBILITY.md": ["Python 3.10", "Runtime Dependencies", "Offline Test Policy"],
    }
    for filename, expected_terms in docs.items():
        text = (Path("docs") / filename).read_text(encoding="utf-8")
        for term in expected_terms:
            assert term in text


def test_readme_documents_090_and_road_to_1_0() -> None:
    text = Path("README.md").read_text(encoding="utf-8")

    assert "## What 0.9.0 Adds" in text
    assert "## Road to 1.0" in text
    assert "docs/PUBLIC_API.md" in text
    assert "docs/MIGRATION_0_9.md" in text
    assert "docs/COMPATIBILITY.md" in text
