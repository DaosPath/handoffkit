"""Offline wheel install smoke test."""

from __future__ import annotations

import subprocess
import sys
import venv
from pathlib import Path


def run_command(args: list[str], *, cwd: Path | None = None) -> None:
    """Run a subprocess and fail with useful output."""
    completed = subprocess.run(
        args,
        cwd=cwd,
        text=True,
        capture_output=True,
        check=False,
    )
    assert completed.returncode == 0, completed.stdout + completed.stderr


def test_local_wheel_installs_and_imports_offline(tmp_path: Path) -> None:
    wheelhouse = tmp_path / "wheelhouse"
    wheelhouse.mkdir()
    run_command(
        [
            sys.executable,
            "-m",
            "pip",
            "wheel",
            ".",
            "--no-deps",
            "--no-build-isolation",
            "--wheel-dir",
            str(wheelhouse),
        ]
    )

    env_dir = tmp_path / "venv"
    venv.EnvBuilder(with_pip=True).create(env_dir)
    python = env_dir / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
    handoffkit = env_dir / (
        "Scripts/handoffkit.exe" if sys.platform == "win32" else "bin/handoffkit"
    )

    run_command(
        [
            str(python),
            "-m",
            "pip",
            "install",
            "--no-index",
            "--find-links",
            str(wheelhouse),
            "handoffkit==1.8.7",
        ]
    )
    run_command(
        [
            str(python),
            "-c",
            "from handoffkit import Agent, Team, RunTrace, ReplayRunner; print('OK')",
        ]
    )
    run_command([str(handoffkit), "--version"])
