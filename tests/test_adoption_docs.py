"""Adoption-facing docs and assets tests."""

from __future__ import annotations

from pathlib import Path


def test_readme_links_showcases_post_and_integrations() -> None:
    text = Path("README.md").read_text(encoding="utf-8")

    assert "docs/assets/handoffkit-showcases.svg" in text
    assert "reports/coding_review.md" in text
    assert "Context Soup vs Contract Handoffs" in text
    assert "docs/integrations/LANGGRAPH.md" in text
    assert "docs/integrations/OPENAI_AGENTS.md" in text
    assert "docs/integrations/PYDANTIC_AI.md" in text


def test_context_soup_post_exists() -> None:
    text = Path("docs/CONTEXT_SOUP_VS_CONTRACT_HANDOFFS.md").read_text(encoding="utf-8")

    assert "Context Soup" in text
    assert "HandoffState" in text
    assert "handoffkit init coding-review" in text
    assert "RunTrace" in text


def test_integration_docs_are_explicit_and_offline() -> None:
    docs = {
        "LANGGRAPH.md": ["LangGraph", "HandoffState", "graph nodes"],
        "OPENAI_AGENTS.md": ["OpenAI Agents SDK", "HandoffStateValidator", "handoff payloads"],
        "PYDANTIC_AI.md": ["Pydantic AI", "BaseModel", "workflow-level handoff"],
    }
    for filename, terms in docs.items():
        text = (Path("docs") / "integrations" / filename).read_text(encoding="utf-8")
        for term in terms:
            assert term in text


def test_showcase_svg_asset_exists() -> None:
    text = Path("docs/assets/handoffkit-showcases.svg").read_text(encoding="utf-8")

    assert "<svg" in text
    assert "Coding agents" in text
    assert "Support escalation" in text
    assert "Research workflow" in text
