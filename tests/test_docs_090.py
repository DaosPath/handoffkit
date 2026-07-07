"""Documentation coverage for the stable 1.0 release."""

from __future__ import annotations

from pathlib import Path


def test_stable_docs_exist_and_cover_required_topics() -> None:
    docs = {
        "PUBLIC_API.md": ["Agent", "RunTrace", "ProviderToolAdapter", "1.x"],
        "MIGRATION_0_9.md": ["No breaking changes", "What Did Not Change", "handoffkit doctor"],
        "MIGRATION_1_0.md": ["No breaking changes", "WorkflowEvaluator", "handoffkit init"],
        "COMPATIBILITY.md": ["Python 3.10", "Runtime Dependencies", "Async Compatibility"],
    }
    for filename, expected_terms in docs.items():
        text = (Path("docs") / filename).read_text(encoding="utf-8")
        for term in expected_terms:
            assert term in text


def test_readme_documents_100_and_stable_api() -> None:
    text = Path("README.md").read_text(encoding="utf-8")

    assert "## Release Highlights" in text
    assert "1.0.x" in text
    assert "0.8-0.9" in text
    assert "## Road to 1.0" in text
    assert "docs/PUBLIC_API.md" in text
    assert "docs/MIGRATION_1_0.md" in text
    assert "docs/COMPATIBILITY.md" in text
