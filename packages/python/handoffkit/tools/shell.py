"""Shell command tool with a small safety policy."""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any

from handoffkit.errors import DangerousCommandError
from handoffkit.safety import is_dangerous_command
from handoffkit.tool import tool


def _assert_safe(command: str) -> None:
    if is_dangerous_command(command):
        raise DangerousCommandError(f"Blocked dangerous command: {command}")


@tool
def run_command(command: str, cwd: str | None = None) -> dict[str, Any]:
    """Run a shell command and return command, cwd, return code, stdout, and stderr."""
    _assert_safe(command)
    working_dir = str(Path(cwd).resolve()) if cwd else None
    completed = subprocess.run(
        command,
        cwd=working_dir,
        shell=True,
        check=False,
        capture_output=True,
        text=True,
    )
    return {
        "command": command,
        "cwd": working_dir,
        "returncode": completed.returncode,
        "stdout": completed.stdout,
        "stderr": completed.stderr,
    }
