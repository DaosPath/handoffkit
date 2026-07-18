"""Smoke tests for HandoffKit 0.7.0 offline demos."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def run_example(script_name: str) -> subprocess.CompletedProcess[str]:
    """Run one example script."""
    return subprocess.run(
        [sys.executable, str(ROOT / "examples" / "demos" / script_name)],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )


def test_handoff_quality_demo_runs_without_api_key() -> None:
    completed = run_example("handoff_quality_demo.py")

    assert completed.returncode == 0, completed.stdout + completed.stderr
    assert "Handoff quality success: True" in completed.stdout
    report = json.loads((ROOT / "reports" / "handoff_quality_demo.json").read_text())
    assert report["success"] is True


def test_contract_validation_demo_runs_without_api_key() -> None:
    completed = run_example("contract_validation_demo.py")

    assert completed.returncode == 0, completed.stdout + completed.stderr
    assert "Tool schema validation: True" in completed.stdout
    report = json.loads((ROOT / "reports" / "contract_validation_demo.json").read_text())
    assert report["handoff"]["success"] is True


def test_provider_tool_formats_demo_runs_without_api_key() -> None:
    completed = run_example("provider_tool_formats_demo.py")

    assert completed.returncode == 0, completed.stdout + completed.stderr
    assert "OpenAI call id: call_openai_1" in completed.stdout
    assert "Anthropic call id: toolu_1" in completed.stdout
    report = json.loads((ROOT / "reports" / "provider_tool_formats_demo.json").read_text())
    assert report["parsed_calls"]["openai"][0]["call_id"] == "call_openai_1"
