"""Tests for report IO helpers."""

from __future__ import annotations

import json

import pytest

from handoffkit import (
    Agent,
    RunTrace,
    Team,
    load_report_json,
    render_report_html,
    write_report_files,
    write_report_html,
)


def test_write_report_files_for_trace(tmp_path) -> None:  # type: ignore[no-untyped-def]
    trace = RunTrace.from_team_result(Team([Agent("A", "Do.")]).run("Task."))

    json_path, markdown_path = write_report_files(trace, "trace", tmp_path)

    assert json_path.exists()
    assert markdown_path.exists()
    assert load_report_json(json_path)["run_id"] == trace.run_id


def test_write_report_files_for_dict(tmp_path) -> None:  # type: ignore[no-untyped-def]
    json_path, markdown_path = write_report_files({"success": True}, "dict-report", tmp_path)

    assert json.loads(json_path.read_text())["success"] is True
    assert "Report" in markdown_path.read_text()


def test_write_report_files_strips_suffix(tmp_path) -> None:  # type: ignore[no-untyped-def]
    json_path, markdown_path = write_report_files({"success": True}, "demo.json", tmp_path)

    assert json_path.name == "demo.json"
    assert markdown_path.name == "demo.md"


def test_load_report_json_rejects_non_object(tmp_path) -> None:  # type: ignore[no-untyped-def]
    path = tmp_path / "bad.json"
    path.write_text("[]", encoding="utf-8")

    with pytest.raises(ValueError, match="object"):
        load_report_json(path)


def test_write_report_files_rejects_plain_string(tmp_path) -> None:  # type: ignore[no-untyped-def]
    with pytest.raises(TypeError, match="report"):
        write_report_files("not a report", "bad", tmp_path)


def test_render_report_html_for_showcase_shaped_dict() -> None:
    html = render_report_html(
        {
            "title": "Demo Report",
            "command": "handoffkit report runs/latest",
            "pain": "Free text loses context.",
            "free_text_summary": "Basically done.",
            "lost_context": ["files", "errors"],
            "preserved_context": ["decisions", "next steps"],
            "handoffs": [
                {
                    "from_agent": "Architect",
                    "to_agent": "Coder",
                    "decisions": ["Use argparse"],
                    "important_files": ["calculator.py"],
                    "errors": [],
                }
            ],
            "quality": {"score": 0.85, "grade": "A"},
            "validation": {"success": True},
            "replay": {"step_count": 2, "handoff_count": 1},
        }
    )

    assert "<!doctype html>" in html
    assert "Demo Report" in html
    assert "Context soup loses" in html
    assert "calculator.py" in html


def test_write_report_html(tmp_path) -> None:  # type: ignore[no-untyped-def]
    path = write_report_html({"title": "HTML Report", "success": True}, tmp_path / "report.html")

    assert path.exists()
    assert "HTML Report" in path.read_text(encoding="utf-8")
