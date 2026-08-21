"""Integration tests for the real task calculator demo."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "examples" / "demos" / "real_task_calculator.py"
OUTPUT_DIR = ROOT / "examples" / "output" / "calculator_cli"
JSON_REPORT = ROOT / "reports" / "real_task_calculator.json"
MARKDOWN_REPORT = ROOT / "reports" / "real_task_calculator.md"


def test_real_task_calculator_demo_runs() -> None:
    """Demo runs offline, creates evidence, and generated project tests pass."""
    assert SCRIPT.exists()
    env = os.environ.copy()
    env.pop("OPENAI_API_KEY", None)
    env.pop("OPENAI_MODEL", None)
    env["OPENAI_BASE_URL"] = "https://api.freemodel.dev/v1"

    completed = subprocess.run(
        [sys.executable, str(SCRIPT)],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert completed.returncode == 0, completed.stdout + completed.stderr

    generated_files = [
        OUTPUT_DIR / "calculator.py",
        OUTPUT_DIR / "test_calculator.py",
        OUTPUT_DIR / "README.md",
        JSON_REPORT,
        MARKDOWN_REPORT,
    ]
    for path in generated_files:
        assert path.exists(), path

    report = json.loads(JSON_REPORT.read_text(encoding="utf-8"))
    assert report["final_status"] == "passed"
    assert report["protocol"] == "hybrid_state"
    assert report["agents"] == ["Architect", "Coder", "Tester", "Reporter"]

    generated_tests = subprocess.run(
        [sys.executable, "-m", "pytest", "-q"],
        cwd=OUTPUT_DIR,
        capture_output=True,
        text=True,
        check=False,
    )
    assert generated_tests.returncode == 0, generated_tests.stdout + generated_tests.stderr
