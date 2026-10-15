"""Tests for the Fusion-style panel demo."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_fusion_style_demo_runs_offline() -> None:
    completed = subprocess.run(
        [sys.executable, "examples/demos/fusion_style_demo.py"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )

    assert completed.returncode == 0, completed.stdout + completed.stderr
    assert "Fusion-style demo success: True" in completed.stdout
    assert "offline-deterministic-panel" in completed.stdout

    report = json.loads((ROOT / "reports" / "fusion_style_demo.json").read_text())
    assert report["success"] is True
    assert report["mode"] == "offline-deterministic-panel"
    assert len(report["panel"]) == 4
    assert "consensus" in report["analysis"]
