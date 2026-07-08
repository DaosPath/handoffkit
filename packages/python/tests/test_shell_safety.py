import pytest

from handoffkit.errors import DangerousCommandError
from handoffkit.tools.shell import run_command


def test_run_command_blocks_dangerous_command() -> None:
    with pytest.raises(DangerousCommandError):
        run_command.run(command="rm -rf /")


def test_run_command_returns_result() -> None:
    result = run_command.run(command="python --version")

    assert result["command"] == "python --version"
    assert isinstance(result["returncode"], int)
