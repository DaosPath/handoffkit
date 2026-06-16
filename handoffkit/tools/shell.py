"""Shell command tool with a small safety policy."""

from __future__ import annotations

import re
import subprocess
from pathlib import Path
from typing import Any

from handoffkit.errors import DangerousCommandError
from handoffkit.tool import tool

DANGEROUS_PATTERNS = [
    re.compile(r"\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-rf|-fr)\b", re.IGNORECASE),
    re.compile(r"\bdel\s+/(s|q)\b", re.IGNORECASE),
    re.compile(r"\brmdir\s+/(s|q)\b", re.IGNORECASE),
    re.compile(r"\brd\s+/(s|q)\b", re.IGNORECASE),
    re.compile(r"\bformat\b", re.IGNORECASE),
    re.compile(r"\bshutdown\b", re.IGNORECASE),
    re.compile(r"\breboot\b", re.IGNORECASE),
    re.compile(r"\bmkfs(\.[a-z0-9]+)?\b", re.IGNORECASE),
    re.compile(r"\bdiskpart\b", re.IGNORECASE),
    re.compile(r"\bRemove-Item\b.*\b-Recurse\b", re.IGNORECASE),
]


def _assert_safe(command: str) -> None:
    normalized = " ".join(command.strip().split())
    for pattern in DANGEROUS_PATTERNS:
        if pattern.search(normalized):
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
