"""Tests for structured tool execution."""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

from handoffkit import Agent, ToolCall, ToolExecutionReport, ToolRegistry, ToolResult, tool
from handoffkit.providers import BaseProvider
from handoffkit.safety import is_dangerous_command
from handoffkit.tools.filesystem import read_file, write_file
from handoffkit.tools.shell import run_command

ROOT = Path(__file__).resolve().parents[1]
TEST_OUTPUT = ROOT / "tests" / "_tmp_tool_execution"


@tool
def greet(name: str) -> str:
    """Return a greeting."""
    return f"hello {name}"


def fresh_test_output() -> Path:
    """Return a unique workspace-local test output path."""
    output = TEST_OUTPUT / uuid.uuid4().hex
    output.mkdir(parents=True, exist_ok=True)
    return output


def test_tool_call_to_dict_and_json() -> None:
    call = ToolCall(tool_name="greet", arguments={"name": "Ada"}, call_id="c1")
    assert call.to_dict()["tool_name"] == "greet"
    assert json.loads(call.to_json())["arguments"] == {"name": "Ada"}


def test_tool_result_to_dict_and_json() -> None:
    result = ToolResult(tool_name="greet", success=True, result="hello Ada", call_id="c1")
    assert result.to_dict()["success"] is True
    assert json.loads(result.to_json())["result"] == "hello Ada"


def test_tool_registry_register_list_get_and_schemas() -> None:
    registry = ToolRegistry([greet])
    assert registry.list_tools() == ["greet"]
    assert registry.get("greet").name == "greet"
    assert registry.schemas()[0]["name"] == "greet"


def test_tool_registry_duplicate_error() -> None:
    registry = ToolRegistry([greet])
    try:
        registry.register(greet)
    except ValueError as exc:
        assert "already registered" in str(exc)
    else:
        raise AssertionError("duplicate tool registration should fail")


def test_tool_registry_execute_success() -> None:
    registry = ToolRegistry([greet])
    result = registry.execute(ToolCall("greet", {"name": "Ada"}))
    assert result.success is True
    assert result.result == "hello Ada"


def test_tool_registry_execute_missing_tool() -> None:
    registry = ToolRegistry()
    result = registry.execute(ToolCall("missing", {}))
    assert result.success is False
    assert "Tool not found" in str(result.error)


def test_tool_registry_execute_wrong_args() -> None:
    registry = ToolRegistry([greet])
    result = registry.execute(ToolCall("greet", {}))
    assert result.success is False
    assert "Invalid arguments" in str(result.error)


def test_agent_run_with_tools_echo_provider() -> None:
    output = fresh_test_output()
    sample = output / "sample.txt"
    sample.write_text("hello tools", encoding="utf-8")
    agent = Agent("FileAgent", "Read files.", tools=[read_file])
    report = agent.run_with_tools(f"read file {sample}")
    assert report.success is True
    assert report.tool_calls[0].tool_name == "read_file"
    assert report.tool_results[0].result == "hello tools"


class JsonToolProvider(BaseProvider):
    """Fake provider returning one tool call and one final response."""

    model = "fake-json"

    def __init__(self) -> None:
        self.calls = 0

    def generate(self, prompt: str, **kwargs: Any) -> str:
        self.calls += 1
        if self.calls == 1:
            return json.dumps(
                {
                    "tool_calls": [
                        {"tool_name": "greet", "arguments": {"name": "Ada"}},
                    ],
                    "final": None,
                }
            )
        return json.dumps({"final": "Done"})


def test_agent_run_with_tools_provider_json_tool_calls() -> None:
    agent = Agent("JsonAgent", "Use JSON tools.", provider=JsonToolProvider(), tools=[greet])
    report = agent.run_with_tools("Greet Ada.")
    assert report.success is True
    assert report.tool_results[0].result == "hello Ada"
    assert report.final_output == "Done"


class LoopProvider(BaseProvider):
    """Fake provider that never returns final."""

    model = "loop"

    def generate(self, prompt: str, **kwargs: Any) -> str:
        return json.dumps(
            {
                "tool_calls": [
                    {"tool_name": "greet", "arguments": {"name": "Loop"}},
                ],
                "final": None,
            }
        )


def test_max_steps_stops_infinite_loop() -> None:
    agent = Agent("LoopAgent", "Loop.", provider=LoopProvider(), tools=[greet])
    report = agent.run_with_tools("Loop forever.", max_steps=2)
    assert report.success is False
    assert len(report.tool_calls) == 2
    assert "max_steps" in report.final_output


def test_dangerous_command_blocked() -> None:
    assert is_dangerous_command("rm -rf /")
    registry = ToolRegistry([run_command])
    result = registry.execute(ToolCall("run_command", {"command": "rm -rf /"}))
    assert result.success is False
    assert "unsafe command blocked" in str(result.error)


def test_require_approval_blocks_write_and_shell() -> None:
    output = fresh_test_output()
    registry = ToolRegistry([write_file, run_command])
    write_result = registry.execute(
        ToolCall("write_file", {"path": str(output / "x.txt"), "content": "x"}),
        require_approval=True,
    )
    shell_result = registry.execute(
        ToolCall("run_command", {"command": "echo hi"}),
        require_approval=True,
    )
    assert write_result.error == "approval_required"
    assert shell_result.error == "approval_required"


def test_tool_execution_report_markdown_and_json() -> None:
    report = ToolExecutionReport(
        task="demo",
        agent_name="Agent",
        tool_calls=[ToolCall("greet", {"name": "Ada"}, call_id="c1")],
        tool_results=[ToolResult("greet", True, result="hello Ada", call_id="c1")],
        final_output="Done",
        success=True,
        steps=[{"step": 1}],
    )
    assert json.loads(report.to_json())["final_output"] == "Done"
    assert "# Tool Execution Report" in report.to_markdown()


def test_public_imports() -> None:
    from handoffkit import HandoffProtocol, HandoffState, Team

    assert Agent
    assert HandoffProtocol
    assert HandoffState
    assert Team
    assert ToolCall
    assert ToolResult
    assert ToolRegistry
