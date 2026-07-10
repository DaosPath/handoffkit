"""P0 sandbox, approval defaults, and argv-only shell execution."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

from handoffkit import ToolCall, ToolRegistry, get_sandbox, set_sandbox
from handoffkit.errors import DangerousCommandError, ToolExecutionError
from handoffkit.sandbox import SandboxError
from handoffkit.tools.filesystem import file_exists, read_file, write_file
from handoffkit.tools.shell import run_command, split_command

PACKAGE_ROOT = Path(__file__).resolve().parents[1]


def test_split_command_no_shell_metacharacters() -> None:
    assert split_command("python --version")[0] in {"python", "python.exe"}
    with pytest.raises(DangerousCommandError):
        split_command("echo hi && rm -rf /")


def test_run_command_uses_argv_and_returns_result() -> None:
    set_sandbox(PACKAGE_ROOT, require_approval=False)
    result = run_command.run(command=f"{sys.executable} --version")
    assert result["returncode"] == 0
    assert "argv" in result
    assert result["argv"][0] == sys.executable
    assert "Python" in (result["stdout"] + result["stderr"])


def test_filesystem_stays_in_workspace(tmp_path: Path) -> None:
    set_sandbox(tmp_path, require_approval=False)
    target = write_file.run(path="notes.txt", content="safe")
    assert Path(target).read_text(encoding="utf-8") == "safe"
    assert file_exists.run(path="notes.txt") is True
    assert read_file.run(path="notes.txt") == "safe"

    outside = Path.cwd().anchor  # e.g. C:\ or /
    with pytest.raises((FileNotFoundError, SandboxError, OSError, ToolExecutionError)):
        read_file.run(path=str(Path(outside) / "handoffkit-not-allowed.txt"))


def test_approval_default_blocks_mutating_tools() -> None:
    set_sandbox(PACKAGE_ROOT, require_approval=True)
    registry = ToolRegistry([write_file, run_command])
    blocked = registry.execute(
        ToolCall("write_file", {"path": "tests/_tmp_tool_execution/block.txt", "content": "x"})
    )
    assert blocked.success is False
    assert blocked.error == "approval_required"

    allowed = registry.execute(
        ToolCall("write_file", {"path": "tests/_tmp_tool_execution/ok.txt", "content": "x"}),
        require_approval=False,
    )
    assert allowed.success is True
    assert get_sandbox().sandbox_enabled is True
