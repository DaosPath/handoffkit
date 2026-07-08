"""Structured tool calls, execution, and reports."""

from __future__ import annotations

import json
import uuid
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from typing import Any

from handoffkit.errors import ToolExecutionError
from handoffkit.safety import UnsafeToolCallError, is_dangerous_command, requires_approval
from handoffkit.tool import Tool, ensure_tool


def _json_default(value: Any) -> Any:
    """Return a readable JSON fallback for non-serializable values."""
    return str(value)


@dataclass
class ToolCall:
    """A structured request to run one tool."""

    tool_name: str
    arguments: dict[str, Any]
    call_id: str = field(default_factory=lambda: uuid.uuid4().hex)
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Serialize the tool call."""
        return {
            "tool_name": self.tool_name,
            "arguments": self.arguments,
            "call_id": self.call_id,
            "metadata": self.metadata,
        }

    def to_json(self, *, indent: int | None = 2) -> str:
        """Serialize the tool call as JSON."""
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=indent, default=_json_default)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ToolCall:
        """Create a tool call from a dictionary."""
        return cls(
            tool_name=str(data.get("tool_name", "")),
            arguments=data.get("arguments") if isinstance(data.get("arguments"), dict) else {},
            call_id=str(data.get("call_id") or uuid.uuid4().hex),
            metadata=data.get("metadata") if isinstance(data.get("metadata"), dict) else {},
        )


@dataclass
class ToolResult:
    """Result of one tool execution."""

    tool_name: str
    success: bool
    result: Any = None
    error: str | None = None
    call_id: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Serialize the tool result."""
        return {
            "tool_name": self.tool_name,
            "success": self.success,
            "result": self.result,
            "error": self.error,
            "call_id": self.call_id,
            "metadata": self.metadata,
        }

    def to_json(self, *, indent: int | None = 2) -> str:
        """Serialize the tool result as JSON."""
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=indent, default=_json_default)


class ToolRegistry:
    """Registry for structured tool execution."""

    def __init__(self, tools: Iterable[Tool | Callable[..., Any]] | None = None) -> None:
        self._tools: dict[str, Tool] = {}
        for item in tools or []:
            self.register(item)

    def register(self, item: Tool | Callable[..., Any]) -> Tool:
        """Register one tool and reject duplicate names."""
        wrapped = ensure_tool(item)
        if wrapped.name in self._tools:
            raise ValueError(f"Tool already registered: {wrapped.name}")
        self._tools[wrapped.name] = wrapped
        return wrapped

    def get(self, name: str) -> Tool:
        """Return one registered tool by name."""
        try:
            return self._tools[name]
        except KeyError as exc:
            raise KeyError(f"Tool not found: {name}") from exc

    def list_tools(self) -> list[str]:
        """Return registered tool names."""
        return sorted(self._tools)

    def schemas(self) -> list[dict[str, Any]]:
        """Return JSON-schema-style descriptions for all registered tools."""
        return [self._tools[name].to_schema() for name in self.list_tools()]

    def execute(self, call: ToolCall, *, require_approval: bool = False) -> ToolResult:
        """Execute one tool call and return a structured result."""
        if require_approval and requires_approval(call.tool_name):
            return ToolResult(
                tool_name=call.tool_name,
                success=False,
                error="approval_required",
                call_id=call.call_id,
                metadata={"approval_required": True},
            )
        if call.tool_name == "run_command":
            command = str(call.arguments.get("command", ""))
            if is_dangerous_command(command):
                return ToolResult(
                    tool_name=call.tool_name,
                    success=False,
                    error=f"unsafe command blocked: {command}",
                    call_id=call.call_id,
                    metadata={"unsafe": True},
                )
        tool = self._tools.get(call.tool_name)
        if tool is None:
            return ToolResult(
                tool_name=call.tool_name,
                success=False,
                error=f"Tool not found: {call.tool_name}",
                call_id=call.call_id,
            )
        try:
            result = tool.run(**call.arguments)
            return ToolResult(
                tool_name=call.tool_name,
                success=True,
                result=result,
                call_id=call.call_id,
            )
        except TypeError as exc:
            return ToolResult(
                tool_name=call.tool_name,
                success=False,
                error=f"Invalid arguments for {call.tool_name}: {exc}",
                call_id=call.call_id,
            )
        except (ToolExecutionError, UnsafeToolCallError) as exc:
            return ToolResult(
                tool_name=call.tool_name,
                success=False,
                error=str(exc),
                call_id=call.call_id,
            )


@dataclass
class ToolExecutionReport:
    """Report returned by tool execution loops."""

    task: str
    agent_name: str
    tool_calls: list[ToolCall] = field(default_factory=list)
    tool_results: list[ToolResult] = field(default_factory=list)
    final_output: str = ""
    success: bool = True
    steps: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        """Serialize the report."""
        return {
            "task": self.task,
            "agent_name": self.agent_name,
            "tool_calls": [call.to_dict() for call in self.tool_calls],
            "tool_results": [result.to_dict() for result in self.tool_results],
            "final_output": self.final_output,
            "success": self.success,
            "steps": self.steps,
        }

    def to_json(self, *, indent: int | None = 2) -> str:
        """Serialize the report as JSON."""
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=indent, default=_json_default)

    def to_markdown(self) -> str:
        """Serialize the report as Markdown."""
        calls = "\n".join(
            f"- `{call.tool_name}` `{json.dumps(call.arguments, default=_json_default)}`"
            for call in self.tool_calls
        ) or "- none"
        results = "\n".join(
            f"- `{result.tool_name}` success={result.success} error={result.error or ''}"
            for result in self.tool_results
        ) or "- none"
        return (
            f"# Tool Execution Report\n\n"
            f"## Task\n\n{self.task}\n\n"
            f"## Agent\n\n{self.agent_name}\n\n"
            f"## Success\n\n{self.success}\n\n"
            f"## Final Output\n\n{self.final_output}\n\n"
            f"## Tool Calls\n\n{calls}\n\n"
            f"## Tool Results\n\n{results}\n\n"
            f"## Steps\n\n```json\n{json.dumps(self.steps, indent=2, default=_json_default)}\n```\n"
        )
