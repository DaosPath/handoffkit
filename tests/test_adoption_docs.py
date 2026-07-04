"""Adoption-facing docs and assets tests."""

from __future__ import annotations

from pathlib import Path


def test_readme_links_showcases_post_and_integrations() -> None:
    text = Path("README.md").read_text(encoding="utf-8")

    assert "docs/assets/handoffkit-showcases.svg" in text
    assert "docs/assets/coding-review-terminal.svg" in text
    assert "docs/assets/handoffkit-report-gallery.svg" in text
    assert "docs/SHOWCASE_GALLERY.md" in text
    assert "reports/coding_review.md" in text
    assert "Context Soup vs Contract Handoffs" in text
    assert "docs/launch/CONTEXT_SOUP_LAUNCH_KIT.md" in text
    assert "docs/integrations/LANGGRAPH.md" in text
    assert "docs/integrations/OPENAI_AGENTS.md" in text
    assert "docs/integrations/PYDANTIC_AI.md" in text
    assert "examples/langgraph_integration.py" in text
    assert "examples/openai_agents_sdk_integration.py" in text
    assert "examples/pydantic_ai_integration.py" in text
    assert "handoffkit demos" in text
    assert "handoffkit showcase coding-review" in text


def test_context_soup_post_exists() -> None:
    text = Path("docs/CONTEXT_SOUP_VS_CONTRACT_HANDOFFS.md").read_text(encoding="utf-8")

    assert "Context Soup" in text
    assert "HandoffState" in text
    assert "handoffkit init coding-review" in text
    assert "RunTrace" in text


def test_integration_docs_are_explicit_and_offline() -> None:
    docs = {
        "LANGGRAPH.md": ["LangGraph", "HandoffState", "graph nodes", "Copy/Paste Adapter"],
        "OPENAI_AGENTS.md": [
            "OpenAI Agents SDK",
            "HandoffStateValidator",
            "handoff payloads",
            "Copy/Paste Adapter",
        ],
        "PYDANTIC_AI.md": [
            "Pydantic AI",
            "BaseModel",
            "workflow-level handoff",
            "Copy/Paste Adapter",
        ],
    }
    for filename, terms in docs.items():
        text = (Path("docs") / "integrations" / filename).read_text(encoding="utf-8")
        for term in terms:
            assert term in text


def test_launch_kit_has_channel_specific_copy() -> None:
    text = Path("docs/launch/CONTEXT_SOUP_LAUNCH_KIT.md").read_text(encoding="utf-8")

    for term in ["Hacker News", "r/Python", "r/LocalLLaMA", "X / Twitter", "LinkedIn"]:
        assert term in text
    assert "pip install handoffkit" in text
    assert "handoffkit report runs/latest" in text
    assert "SHOWCASE_GALLERY.md" in text


def test_showcase_gallery_doc_exists() -> None:
    text = Path("docs/SHOWCASE_GALLERY.md").read_text(encoding="utf-8")

    assert "handoffkit demos" in text
    assert "handoffkit showcase coding-review" in text
    assert "reports/coding_review.md" in text
    assert "reports/support_escalation.md" in text
    assert "reports/research_workflow.md" in text


def test_showcase_svg_asset_exists() -> None:
    text = Path("docs/assets/handoffkit-showcases.svg").read_text(encoding="utf-8")

    assert "<svg" in text
    assert "Coding agents" in text
    assert "Support escalation" in text
    assert "Research workflow" in text


def test_coding_review_terminal_asset_exists() -> None:
    text = Path("docs/assets/coding-review-terminal.svg").read_text(encoding="utf-8")

    assert "<svg" in text
    assert "pip install handoffkit" in text
    assert "Before: vague summary" in text
    assert "After: HandoffState" in text


def test_report_gallery_svg_asset_exists() -> None:
    text = Path("docs/assets/handoffkit-report-gallery.svg").read_text(encoding="utf-8")

    assert "<svg" in text
    assert "Report Gallery" in text or "REPORT GALLERY" in text
    assert "coding_review.md" in text
    assert "support_escalation.md" in text
    assert "research_workflow.md" in text
