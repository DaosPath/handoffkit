"""Project template tests."""

from __future__ import annotations

import pytest

from handoffkit import ProjectTemplate, TemplateFile, TemplateScaffolder


def test_builtin_templates_are_listed() -> None:
    scaffolder = TemplateScaffolder()

    assert scaffolder.list_templates() == [
        "basic-agent",
        "coding-review",
        "doctor-orchestrator",
        "recipe-workflow",
        "research-workflow",
        "support-escalation",
        "team-workflow",
        "tool-agent",
    ]


def test_template_serializes_to_markdown() -> None:
    template = ProjectTemplate(
        name="demo",
        description="Demo template.",
        files=[TemplateFile("main.py", "print('hi')\n")],
    )

    assert template.to_dict()["name"] == "demo"
    assert "Project Template" in template.to_markdown()


def test_scaffold_writes_project_files(tmp_path) -> None:  # type: ignore[no-untyped-def]
    result = TemplateScaffolder().scaffold(
        "demo-agent",
        template="basic-agent",
        output=tmp_path,
    )

    assert result.success is True
    assert (tmp_path / "demo-agent" / "README.md").exists()
    assert (tmp_path / "demo-agent" / "main.py").read_text(encoding="utf-8")


def test_scaffold_writes_showcase_template(tmp_path) -> None:  # type: ignore[no-untyped-def]
    result = TemplateScaffolder().scaffold(
        "coding-review",
        template="coding-review",
        output=tmp_path,
    )

    assert result.success is True
    assert (tmp_path / "coding-review" / "coding_review.py").exists()
    assert "handoffkit report runs/latest" in (
        tmp_path / "coding-review" / "README.md"
    ).read_text(encoding="utf-8")


def test_scaffold_does_not_overwrite_without_force(tmp_path) -> None:  # type: ignore[no-untyped-def]
    scaffolder = TemplateScaffolder()
    scaffolder.scaffold("demo-agent", output=tmp_path)

    result = scaffolder.scaffold("demo-agent", output=tmp_path)

    assert result.success is False
    assert result.skipped


def test_scaffold_force_overwrites(tmp_path) -> None:  # type: ignore[no-untyped-def]
    target = tmp_path / "demo-agent"
    target.mkdir()
    main_py = target / "main.py"
    main_py.write_text("old", encoding="utf-8")

    result = TemplateScaffolder().scaffold("demo-agent", output=tmp_path, force=True)

    assert result.success is True
    assert "from handoffkit import Agent" in main_py.read_text(encoding="utf-8")


def test_scaffold_rejects_path_escape(tmp_path) -> None:  # type: ignore[no-untyped-def]
    template = ProjectTemplate(
        name="bad",
        description="Bad template.",
        files=[TemplateFile("../escape.py", "bad")],
    )
    scaffolder = TemplateScaffolder([template])

    with pytest.raises(ValueError, match="escapes output"):
        scaffolder.scaffold("demo", template="bad", output=tmp_path)
