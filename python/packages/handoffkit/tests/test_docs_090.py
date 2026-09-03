"""Documentation coverage for the stable 1.0 release."""

from __future__ import annotations

from pathlib import Path

import pytest

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = PACKAGE_ROOT.parents[1]
PYTHON_DOCS = REPO_ROOT / "docs" / "python"


def read_python_doc(filename: str) -> str:
    path = PYTHON_DOCS / filename
    if not path.is_file():
        pytest.skip(f"central Python docs not present outside monorepo: {filename}")
    return path.read_text(encoding="utf-8")


def test_stable_docs_exist_and_cover_required_topics() -> None:
    docs = {
        "PUBLIC_API.md": ["Agent", "RunTrace", "ProviderToolAdapter", "1.x"],
        "MIGRATION_0_9.md": ["No breaking changes", "What Did Not Change", "handoffkit doctor"],
        "MIGRATION_1_0.md": ["No breaking changes", "WorkflowEvaluator", "handoffkit init"],
        "COMPATIBILITY.md": ["Python 3.10", "Runtime Dependencies", "Async Compatibility"],
    }
    for filename, expected_terms in docs.items():
        text = read_python_doc(filename)
        for term in expected_terms:
            assert term in text


def test_readme_documents_100_and_stable_api() -> None:
    text = (PACKAGE_ROOT / "README.md").read_text(encoding="utf-8")

    assert "## Release Highlights" in text
    assert "1.0.x" in text
    assert "0.8-0.9" in text
    assert "## Road to 1.0" in text
    assert "docs/python/PUBLIC_API.md" in text
    assert "docs/python/MIGRATION_1_0.md" in text
    assert "docs/python/COMPATIBILITY.md" in text
