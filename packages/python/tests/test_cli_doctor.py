"""Tests for 1.0.0 CLI commands."""

from __future__ import annotations

import json

from handoffkit.cli import (
    evaluate_report,
    main,
    run_api,
    run_doctor,
    run_replay_demo,
    run_trace_demo,
    validate_report,
)


def test_run_doctor_reports_ok() -> None:
    output = run_doctor()

    assert "HandoffKit doctor" in output
    assert "Status: OK" in output


def test_run_api_lists_stable_candidates() -> None:
    output = run_api()

    assert "RunTrace" in output
    assert "ReplayRunner" in output
    assert "WorkflowEvaluator" in output
    assert "TemplateScaffolder" in output


def test_run_trace_demo_reports_trace() -> None:
    output = run_trace_demo()

    assert "Run Trace" in output
    assert "cli-trace-demo" in output


def test_run_replay_demo_reports_summary() -> None:
    output = run_replay_demo()

    assert "Replay Summary" in output
    assert "Steps" in output


def test_validate_report_command(tmp_path) -> None:  # type: ignore[no-untyped-def]
    path = tmp_path / "report.json"
    path.write_text(json.dumps({"success": True}), encoding="utf-8")

    output = validate_report(str(path))

    assert "Status: OK" in output
    assert "success" in output


def test_new_cli_commands(capsys, tmp_path) -> None:  # type: ignore[no-untyped-def]
    report = tmp_path / "report.json"
    report.write_text(json.dumps({"success": True}), encoding="utf-8")

    for command in ["doctor", "api", "demo-async", "demo-trace", "demo-replay"]:
        assert main([command]) == 0
        assert capsys.readouterr().out
    assert main(["validate-report", str(report)]) == 0
    assert "Status: OK" in capsys.readouterr().out
    assert main(["evaluate", str(report)]) == 0
    assert "Workflow Evaluation Report" in capsys.readouterr().out


def test_cli_help_includes_new_commands(capsys) -> None:  # type: ignore[no-untyped-def]
    assert main([]) == 0

    output = capsys.readouterr().out

    assert "doctor" in output
    assert "demo-async" in output
    assert "demo-trace" in output


def test_evaluate_report_function(tmp_path) -> None:  # type: ignore[no-untyped-def]
    path = tmp_path / "trace.json"
    path.write_text(
        json.dumps(
            {
                "run_id": "demo",
                "name": "demo",
                "success": True,
                "final_output": "done",
                "steps": [{"name": "step", "success": True}],
                "handoffs": [],
                "metadata": {},
            }
        ),
        encoding="utf-8",
    )

    output = evaluate_report(str(path))

    assert "Workflow Evaluation Report" in output
