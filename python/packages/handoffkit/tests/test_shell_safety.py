import sys

import pytest

from handoffkit.errors import DangerousCommandError
from handoffkit.sandbox import set_sandbox
from handoffkit.tools.shell import run_command

PACKAGE_ROOT = __import__("pathlib").Path(__file__).resolve().parents[1]


def test_run_command_blocks_dangerous_command() -> None:
    set_sandbox(PACKAGE_ROOT, require_approval=False)
    with pytest.raises(DangerousCommandError):
        run_command.run(command="rm -rf /")


def test_run_command_returns_result() -> None:
    set_sandbox(PACKAGE_ROOT, require_approval=False)
    result = run_command.run(command=f"{sys.executable} --version")

    assert "argv" in result
    assert isinstance(result["returncode"], int)
    assert result["returncode"] == 0
