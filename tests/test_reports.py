"""Tests for report IO helpers."""

from __future__ import annotations

import json

import pytest

from handoffkit import Agent, RunTrace, Team, load_report_json, write_report_files


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
