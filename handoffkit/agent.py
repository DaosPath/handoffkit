"""Agent abstraction."""

from __future__ import annotations

import json
import shlex
from collections.abc import Callable, Sequence
from typing import Any

from handoffkit.context import ContextPack, ContextRunResult
from handoffkit.handoff import HandoffState
from handoffkit.memory import AgentMemory, MemoryStore
from handoffkit.providers import BaseProvider, EchoProvider
from handoffkit.tool import Tool, ensure_tool
from handoffkit.tool_execution import (
    ToolCall,
    ToolExecutionReport,
    ToolRegistry,
)


class Agent:
    """AI agent with a role, provider, memory, and executable tools."""

    def __init__(
        self,
        name: str,
        role: str,
        *,
        model: str = "echo",
        tools: Sequence[Tool | Callable[..., Any]] | None = None,
        provider: BaseProvider | None = None,
        memory: AgentMemory | None = None,
    ) -> None:
        if not name.strip():
            raise ValueError("Agent name cannot be empty.")
        if not role.strip():
            raise ValueError("Agent role cannot be empty.")
        self.name = name
        self.role = role
        self.model = model
        self.provider = provider or EchoProvider(model=model)
        self.memory = memory or AgentMemory()
        self.tools: list[Tool] = []
        for item in tools or []:
            self.add_tool(item)

    def add_tool(self, item: Tool | Callable[..., Any]) -> Tool:
        """Add a tool or callable to this agent."""
        wrapped = ensure_tool(item)
        self.tools.append(wrapped)
        return wrapped

    def describe(self) -> dict[str, Any]:
        """Return a structured description of the agent."""
        return {
            "name": self.name,
            "role": self.role,
            "model": self.model,
            "provider": self.provider.__class__.__name__,
            "tools": [tool.to_dict() for tool in self.tools],
        }

    def run_tool(self, name: str, **kwargs: Any) -> Any:
        """Run one registered tool by name."""
        for item in self.tools:
            if item.name == name:
                return item.run(**kwargs)
        raise ValueError(f"Tool not found for agent {self.name!r}: {name}")

    def run(self, task: str, *, handoff_state: HandoffState | None = None, **kwargs: Any) -> str:
        """Run the agent on a task and return provider output."""
        prompt = self._build_prompt(task, handoff_state=handoff_state)
        self.memory.add("user", task, agent=self.name)
        output = self.provider.generate(prompt, **kwargs)
        self.memory.add("assistant", output, agent=self.name)
        return output

    def run_with_tools(
        self,
        task: str,
        tools: Sequence[Tool | Callable[..., Any]] | None = None,
        max_steps: int = 5,
        require_approval: bool = False,
    ) -> ToolExecutionReport:
        """Run an agent with structured tool execution.

        EchoProvider uses a deterministic local command parser. Other providers
        can return JSON with `tool_calls` and/or `final`.
        """
        registry = ToolRegistry(self.tools)
        for item in tools or []:
            if ensure_tool(item).name not in registry.list_tools():
                registry.register(item)
        if isinstance(self.provider, EchoProvider):
            return self._run_local_tool_mode(
                task,
                registry=registry,
                require_approval=require_approval,
            )
        return self._run_provider_tool_loop(
            task,
            registry=registry,
            max_steps=max_steps,
            require_approval=require_approval,
        )

    def run_with_context(
        self,
        task: str,
        context: ContextPack | None = None,
        memory: MemoryStore | None = None,
        tools: Sequence[Tool | Callable[..., Any]] | None = None,
    ) -> ContextRunResult:
        """Run the agent with retrieved project context and structured memory."""
        memories = memory.search(task, limit=5) if memory else []
        prompt = self._build_context_prompt(task, context=context, memories=memories)
        self.memory.add("user", task, agent=self.name)
        output = self.provider.generate(prompt)
        self.memory.add("assistant", output, agent=self.name)
        if tools:
            tool_report = self.run_with_tools(task, tools=tools)
            output = f"{output}\n\nTool execution: {tool_report.final_output}"
        return ContextRunResult(
            final_output=output,
            context_used=context,
            memories_used=memories,
            success=True,
        )

    def _run_local_tool_mode(
        self,
        task: str,
        *,
        registry: ToolRegistry,
        require_approval: bool,
    ) -> ToolExecutionReport:
        """Run deterministic local tool calls for common file/shell tasks."""
        calls = self._infer_local_tool_calls(task, registry)
        results = [registry.execute(call, require_approval=require_approval) for call in calls]
        if not calls:
            final_output = (
                "No deterministic local tool call matched the task. "
                "This mode only handles simple read/list/write/run command requests."
            )
        elif all(result.success for result in results):
            final_output = "Completed deterministic local tool execution."
        else:
            final_output = "Tool execution completed with errors."
        return ToolExecutionReport(
            task=task,
            agent_name=self.name,
            tool_calls=calls,
            tool_results=results,
            final_output=final_output,
            success=bool(calls) and all(result.success for result in results),
            steps=[
                {
                    "mode": "deterministic_local",
                    "tool_calls": [call.to_dict() for call in calls],
                    "tool_results": [result.to_dict() for result in results],
                }
            ],
        )

    def _infer_local_tool_calls(self, task: str, registry: ToolRegistry) -> list[ToolCall]:
        """Infer simple local tool calls from plain English task text."""
        lowered = task.lower()
        tokens = shlex.split(task)
        available = set(registry.list_tools())

        def after_phrase(*phrases: str) -> str:
            for phrase in phrases:
                index = lowered.find(phrase)
                if index >= 0:
                    return task[index + len(phrase) :].strip().strip("'\"")
            return ""

        if "read file" in lowered and "read_file" in available:
            path = after_phrase("read file") or (tokens[-1] if tokens else "")
            return [ToolCall("read_file", {"path": path})]
        if "list files" in lowered and "list_files" in available:
            path = after_phrase("list files", "list files in") or "."
            return [ToolCall("list_files", {"path": path})]
        if "run command" in lowered and "run_command" in available:
            command = after_phrase("run command")
            return [ToolCall("run_command", {"command": command})]
        if "write file" in lowered and "write_file" in available:
            path = tokens[2] if len(tokens) >= 3 else "output.txt"
            content = after_phrase("content") or ""
            return [ToolCall("write_file", {"path": path, "content": content})]
        return []

    def _run_provider_tool_loop(
        self,
        task: str,
        *,
        registry: ToolRegistry,
        max_steps: int,
        require_approval: bool,
    ) -> ToolExecutionReport:
        """Run provider JSON tool-call loop."""
        calls: list[ToolCall] = []
        results = []
        steps: list[dict[str, Any]] = []
        final_output = ""
        for step_index in range(max_steps):
            prompt = self._build_tool_prompt(task, registry=registry, results=results)
            raw = self.provider.generate(prompt)
            self.memory.add("assistant", raw, agent=self.name)
            step: dict[str, Any] = {"step": step_index + 1, "provider_output": raw}
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                final_output = raw
                steps.append({**step, "mode": "plain_text"})
                break
            if not isinstance(payload, dict):
                final_output = raw
                steps.append({**step, "mode": "non_object_json"})
                break
            if payload.get("final") is not None and not payload.get("tool_calls"):
                final_output = str(payload["final"])
                steps.append({**step, "mode": "final"})
                break
            raw_calls = payload.get("tool_calls") or []
            step_calls = [
                ToolCall.from_dict(item)
                for item in raw_calls
                if isinstance(item, dict)
            ]
            step_results = [
                registry.execute(call, require_approval=require_approval)
                for call in step_calls
            ]
            calls.extend(step_calls)
            results.extend(step_results)
            steps.append(
                {
                    **step,
                    "mode": "tool_calls",
                    "tool_calls": [call.to_dict() for call in step_calls],
                    "tool_results": [result.to_dict() for result in step_results],
                }
            )
            if not step_calls:
                final_output = str(payload.get("final") or "")
                break
        else:
            final_output = "Stopped after max_steps to avoid an infinite tool loop."
        return ToolExecutionReport(
            task=task,
            agent_name=self.name,
            tool_calls=calls,
            tool_results=results,
            final_output=final_output,
            success=all(result.success for result in results) and "max_steps" not in final_output,
            steps=steps,
        )

    def _build_tool_prompt(
        self,
        task: str,
        *,
        registry: ToolRegistry,
        results: list[Any],
    ) -> str:
        """Build a provider prompt that documents the JSON tool-call protocol."""
        return (
            f"Agent: {self.name}\n"
            f"Role: {self.role}\n"
            f"Task: {task}\n\n"
            f"Available tool schemas:\n{json.dumps(registry.schemas(), indent=2)}\n\n"
            f"Previous tool results:\n"
            f"{json.dumps([result.to_dict() for result in results], indent=2, default=str)}\n\n"
            "Return JSON only. To call tools, return "
            '{"tool_calls":[{"tool_name":"name","arguments":{}}],"final":null}. '
            'To finish, return {"final":"Done"}.'
        )

    def _build_context_prompt(
        self,
        task: str,
        *,
        context: ContextPack | None,
        memories: list[Any],
    ) -> str:
        """Build prompt with context and memory summaries."""
        context_text = context.to_markdown() if context else "No context pack."
        memory_text = "\n".join(f"- {item.kind}: {item.content}" for item in memories)
        if not memory_text:
            memory_text = "No relevant structured memories."
        return (
            f"Agent: {self.name}\n"
            f"Role: {self.role}\n"
            f"Task: {task}\n\n"
            f"Project context:\n{context_text}\n\n"
            f"Relevant memory:\n{memory_text}\n\n"
            "Use the provided context and memories. "
            "Report useful progress, decisions, errors if any, and next steps."
        )

    def _build_prompt(self, task: str, *, handoff_state: HandoffState | None) -> str:
        tool_lines = "\n".join(
            f"- {tool.name}: {tool.description or 'No description'}"
            for tool in self.tools
        )
        if not tool_lines:
            tool_lines = "- No tools registered"
        memory_text = self.memory.to_text(count=4) or "No prior memory."
        handoff_text = handoff_state.to_json(indent=None) if handoff_state else "No handoff state."
        return (
            f"Agent: {self.name}\n"
            f"Role: {self.role}\n"
            f"Task: {task}\n\n"
            f"Tools:\n{tool_lines}\n\n"
            f"Recent memory:\n{memory_text}\n\n"
            f"Handoff state:\n{handoff_text}\n\n"
            "Respond with useful progress, decisions, errors if any, and next steps."
        )

    def __repr__(self) -> str:
        return f"Agent(name={self.name!r}, role={self.role!r})"
