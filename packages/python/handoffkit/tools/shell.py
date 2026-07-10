"""Shell command tool without shell=True (argv list only)."""

from __future__ import annotations

import os
import shlex
import subprocess
from typing import Any

from handoffkit.errors import DangerousCommandError
from handoffkit.safety import is_dangerous_command
from handoffkit.sandbox import SandboxError, get_sandbox
from handoffkit.tool import tool


def _assert_safe(command: str) -> None:
    if is_dangerous_command(command):
        raise DangerousCommandError(f"Blocked dangerous command: {command}")


def split_command(command: str) -> list[str]:
    """Split a command string into argv without invoking a shell.

    Uses POSIX rules on Unix and non-POSIX (Windows-aware) rules on Windows.
    Does not expand shell metacharacters (pipes, redirects, ``&&``).
    """
    posix = os.name != "nt"
    parts = shlex.split(command, posix=posix)
    if not parts:
        raise ValueError("empty command")
    # Reject attempts to chain via shell-only tokens once split fails to preserve them
    # as separate args — still block obvious multi-command strings.
    if any(tok in {"&&", "||", ";", "|", "`"} for tok in parts):
        raise DangerousCommandError(
            f"Blocked shell metacharacters in command (no shell=True): {command}"
        )
    return parts


@tool
def run_command(command: str, cwd: str | None = None) -> dict[str, Any]:
    """Run a command as argv (no shell) inside the tool sandbox workspace.

    Returns command, argv, cwd, return code, stdout, and stderr.
    """
    _assert_safe(command)
    sandbox = get_sandbox()
    try:
        working_dir = sandbox.assert_cwd(cwd)
    except SandboxError as exc:
        raise DangerousCommandError(str(exc)) from exc

    try:
        argv = split_command(command)
    except ValueError as exc:
        raise DangerousCommandError(str(exc)) from exc

    completed = subprocess.run(
        argv,
        cwd=str(working_dir) if working_dir is not None else None,
        shell=False,
        check=False,
        capture_output=True,
        text=True,
    )
    return {
        "command": command,
        "argv": argv,
        "cwd": str(working_dir) if working_dir is not None else None,
        "returncode": completed.returncode,
        "stdout": completed.stdout,
        "stderr": completed.stderr,
    }
