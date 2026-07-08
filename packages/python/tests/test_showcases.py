"""Tests for real-world showcase demos."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from handoffkit import build_showcase, run_showcase, showcase_names
from handoffkit.showcases import load_showcase_report


def test_showcase_names_are_available() -> None:
    assert showcase_names() == [
        "coding-review",
        "support-escalation",
        "research-workflow",
        "doctor-orchestrator",
    ]


def test_build_showcase_contains_structured_handoffs() -> None:
    result = build_showcase("coding-review")

    assert result.slug == "coding-review"
    assert len(result.handoffs) == 3
    assert result.validation.success is True
    assert result.quality.success is True
    assert "division-by-zero" in result.to_json()


def test_run_showcase_writes_latest_and_report_files(tmp_path: Path) -> None:
    result = run_showcase(
        "support-escalation",
        output_dir=tmp_path / "runs" / "latest",
        reports_dir=tmp_path / "reports",
    )

    assert result.artifacts
    assert (tmp_path / "runs" / "latest" / "trace.json").exists()
    assert (tmp_path / "runs" / "latest" / "report.json").exists()
    assert (tmp_path / "runs" / "latest" / "report.md").exists()
    assert (tmp_path / "reports" / "support_escalation.json").exists()
    assert "Customer Support" in load_showcase_report(tmp_path / "runs" / "latest")


def test_showcase_examples_run_without_api_key(tmp_path: Path) -> None:
    for script in [
        "examples/coding_review.py",
        "examples/support_escalation.py",
        "examples/research_workflow.py",
        "examples/doctor_orchestrator.py",
        "examples/doctor_benchmark.py",
        "examples/langgraph_integration.py",
        "examples/openai_agents_sdk_integration.py",
        "examples/pydantic_ai_integration.py",
    ]:
        completed = subprocess.run(
            [sys.executable, script],
            cwd=Path.cwd(),
            text=True,
            capture_output=True,
            check=False,
        )
        assert completed.returncode == 0, completed.stdout + completed.stderr
        assert "Handoff" in completed.stdout or "Free-text Summary Loses" in completed.stdout

