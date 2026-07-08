"""Agent abstraction."""

from __future__ import annotations

import asyncio
import json
import shlex
from collections.abc import Callable, Sequence
from typing import Any

from handoffkit.context import ContextPack, ContextRunResult
from handoffkit.handoff import HandoffState
from handoffkit.memory import AgentMemory, MemoryStore
from handoffkit.provider_adapters import ProviderToolAdapter
from handoffkit.providers import BaseProvider, EchoProvider
from handoffkit.structured import (
    JsonOutputParser,
    OutputRepairer,
    OutputValidationError,
    StructuredOutputResult,
    StructuredOutputSchema,
)
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

    async def arun(
        self,
        task: str,
        *,
        handoff_state: HandoffState | None = None,
        **kwargs: Any,
    ) -> str:
        """Run the agent asynchronously on a task and return provider output."""
        prompt = self._build_prompt(task, handoff_state=handoff_state)
        self.memory.add("user", task, agent=self.name)
        output = await self.provider.agenerate(prompt, **kwargs)
        self.memory.add("assistant", output, agent=self.name)
        return output

    def run_with_tools(
        self,
        task: str,
        tools: Sequence[Tool | Callable[..., Any]] | None = None,
        max_steps: int = 5,
        require_approval: bool = False,
        tool_call_mode: str = "auto",
        provider_adapter: ProviderToolAdapter | None = None,
    ) -> ToolExecutionReport:
        """Run an agent with structured tool execution.

        EchoProvider uses a deterministic local command parser. Other providers
        can return JSON with `tool_calls` and/or `final`.
        """
        if tool_call_mode not in {"auto", "deterministic", "provider_json"}:
            raise ValueError("tool_call_mode must be 'auto', 'deterministic', or 'provider_json'")
        registry = ToolRegistry(self.tools)
        for item in tools or []:
            if ensure_tool(item).name not in registry.list_tools():
                registry.register(item)
        if tool_call_mode == "deterministic" or (
            tool_call_mode == "auto" and isinstance(self.provider, EchoProvider)
        ):
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
            provider_adapter=provider_adapter,
        )

    def run_structured(
        self,
        task: str,
        schema: StructuredOutputSchema,
        max_repair_attempts: int = 1,
        context: ContextPack | None = None,
        memory: MemoryStore | None = None,
    ) -> StructuredOutputResult:
        """Run the agent and validate provider output against a simple schema."""
        memories = memory.search(task, limit=5) if memory else []
        prompt = self._build_structured_prompt(
            task,
            schema=schema,
            context=context,
            memories=memories,
        )
        self.memory.add("user", task, agent=self.name)
        raw = self.provider.generate(prompt)
        self.memory.add("assistant", raw, agent=self.name)

        parser = JsonOutputParser()
        repairer = OutputRepairer()
        errors: list[str] = []
        repaired = False
        try:
            data = schema.validate(parser.parse(raw))
        except OutputValidationError as exc:
            errors.append(str(exc))
        else:
            return StructuredOutputResult(
                success=True,
                data=data,
                raw_output=raw,
                errors=[],
                schema_name=schema.name,
                repaired=repaired,
                metadata={
                    "agent": self.name,
                    "provider": self.provider.__class__.__name__,
                    "model": self.model,
                    "context_used": context is not None,
                    "memories_used": len(memories),
                },
            )

        if max_repair_attempts <= 0:
            return StructuredOutputResult(
                success=False,
                data=None,
                raw_output=raw,
                errors=errors,
                schema_name=schema.name,
                repaired=False,
                metadata={
                    "agent": self.name,
                    "provider": self.provider.__class__.__name__,
                    "model": self.model,
                    "context_used": context is not None,
                    "memories_used": len(memories),
                },
            )

        for _ in range(max_repair_attempts):
            try:
                repaired_text = repairer.repair(raw)
                repaired = True
                data = schema.validate(parser.parse(repaired_text))
            except OutputValidationError as exc:
                errors.append(str(exc))
                continue
            return StructuredOutputResult(
                success=True,
                data=data,
                raw_output=raw,
                errors=errors,
                schema_name=schema.name,
                repaired=True,
                metadata={
                    "agent": self.name,
                    "provider": self.provider.__class__.__name__,
                    "model": self.model,
                    "context_used": context is not None,
                    "memories_used": len(memories),
                },
            )
        return StructuredOutputResult(
            success=False,
            data=None,
            raw_output=raw,
            errors=errors,
            schema_name=schema.name,
            repaired=repaired,
            metadata={
                "agent": self.name,
                "provider": self.provider.__class__.__name__,
                "model": self.model,
                "context_used": context is not None,
                "memories_used": len(memories),
            },
        )

    async def arun_structured(
        self,
        task: str,
        schema: StructuredOutputSchema,
        max_repair_attempts: int = 1,
        context: ContextPack | None = None,
        memory: MemoryStore | None = None,
    ) -> StructuredOutputResult:
        """Run the agent asynchronously and validate provider output."""
        memories = memory.search(task, limit=5) if memory else []
        prompt = self._build_structured_prompt(
            task,
            schema=schema,
            context=context,
            memories=memories,
        )
        self.memory.add("user", task, agent=self.name)
        raw = await self.provider.agenerate(prompt)
        self.memory.add("assistant", raw, agent=self.name)

        parser = JsonOutputParser()
        repairer = OutputRepairer()
        errors: list[str] = []
        repaired = False
        metadata = {
            "agent": self.name,
            "provider": self.provider.__class__.__name__,
            "model": self.model,
            "context_used": context is not None,
            "memories_used": len(memories),
        }
        try:
            data = schema.validate(parser.parse(raw))
        except OutputValidationError as exc:
            errors.append(str(exc))
        else:
            return StructuredOutputResult(
                success=True,
                data=data,
                raw_output=raw,
                errors=[],
                schema_name=schema.name,
                repaired=repaired,
                metadata=metadata,
            )

        if max_repair_attempts <= 0:
            return StructuredOutputResult(
                success=False,
                data=None,
                raw_output=raw,
                errors=errors,
                schema_name=schema.name,
                repaired=False,
                metadata=metadata,
            )

        for _ in range(max_repair_attempts):
            try:
                repaired_text = repairer.repair(raw)
                repaired = True
                data = schema.validate(parser.parse(repaired_text))
            except OutputValidationError as exc:
                errors.append(str(exc))
                continue
            return StructuredOutputResult(
                success=True,
                data=data,
                raw_output=raw,
                errors=errors,
                schema_name=schema.name,
                repaired=True,
                metadata=metadata,
            )
        return StructuredOutputResult(
            success=False,
            data=None,
            raw_output=raw,
            errors=errors,
            schema_name=schema.name,
            repaired=repaired,
            metadata=metadata,
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

    async def arun_with_context(
        self,
        task: str,
        context: ContextPack | None = None,
        memory: MemoryStore | None = None,
        tools: Sequence[Tool | Callable[..., Any]] | None = None,
    ) -> ContextRunResult:
        """Run the agent asynchronously with retrieved project context and memory."""
        memories = memory.search(task, limit=5) if memory else []
        prompt = self._build_context_prompt(task, context=context, memories=memories)
        self.memory.add("user", task, agent=self.name)
        output = await self.provider.agenerate(prompt)
        self.memory.add("assistant", output, agent=self.name)
        if tools:
            tool_report = await self.arun_with_tools(task, tools=tools)
            output = f"{output}\n\nTool execution: {tool_report.final_output}"
        return ContextRunResult(
            final_output=output,
            context_used=context,
            memories_used=memories,
            success=True,
        )

    async def arun_with_tools(
        self,
        task: str,
        tools: Sequence[Tool | Callable[..., Any]] | None = None,
        max_steps: int = 5,
        require_approval: bool = False,
        tool_call_mode: str = "auto",
        provider_adapter: ProviderToolAdapter | None = None,
    ) -> ToolExecutionReport:
        """Run an agent with structured tool execution asynchronously."""
        return await asyncio.to_thread(
            self.run_with_tools,
            task,
            tools=tools,
            max_steps=max_steps,
            require_approval=require_approval,
            tool_call_mode=tool_call_mode,
            provider_adapter=provider_adapter,
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
        provider_adapter: ProviderToolAdapter | None,
    ) -> ToolExecutionReport:
        """Run provider JSON tool-call loop."""
        adapter = provider_adapter or ProviderToolAdapter()
        calls: list[ToolCall] = []
        results = []
        steps: list[dict[str, Any]] = []
        final_output = ""
        tool_call_error = False
        for step_index in range(max_steps):
            prompt = self._build_tool_prompt(
                task,
                registry=registry,
                results=results,
                adapter=adapter,
            )
            raw = self.provider.generate(prompt)
            self.memory.add("assistant", raw, agent=self.name)
            step: dict[str, Any] = {"step": step_index + 1, "provider_output": raw}
            try:
                payload = JsonOutputParser().parse(raw)
            except OutputValidationError:
                final_output = raw
                steps.append({**step, "mode": "plain_text"})
                break
            final_text = adapter.parse_final(payload)
            try:
                step_calls = adapter.parse_tool_calls(payload)
            except OutputValidationError as exc:
                final_output = str(exc)
                tool_call_error = True
                steps.append({**step, "mode": "tool_call_error", "error": str(exc)})
                break
            if final_text is not None and not step_calls:
                final_output = final_text
                steps.append({**step, "mode": "final"})
                break
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
            success=(
                all(result.success for result in results)
                and "max_steps" not in final_output
                and not tool_call_error
            ),
            steps=steps,
        )

    def _build_tool_prompt(
        self,
        task: str,
        *,
        registry: ToolRegistry,
        results: list[Any],
        adapter: ProviderToolAdapter,
    ) -> str:
        """Build a provider prompt that documents the JSON tool-call protocol."""
        tools = [registry.get(name) for name in registry.list_tools()]
        provider_tools = adapter.tools_to_provider_format(tools)
        return (
            f"Agent: {self.name}\n"
            f"Role: {self.role}\n"
            f"Task: {task}\n\n"
            f"Provider tool format: {adapter.provider_format}\n"
            f"Available tool schemas:\n"
            f"{json.dumps(provider_tools, indent=2)}\n\n"
            f"Previous tool results:\n"
            f"{json.dumps([result.to_dict() for result in results], indent=2, default=str)}\n\n"
            "Return JSON only. To call tools, return "
            '{"tool_calls":[{"tool_name":"name","arguments":{}}],"final":null}. '
            'To finish, return {"final":"Done"}.'
        )

    def _build_structured_prompt(
        self,
        task: str,
        *,
        schema: StructuredOutputSchema,
        context: ContextPack | None,
        memories: list[Any],
    ) -> str:
        """Build a provider prompt for JSON-only structured output."""
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
            "Return JSON only. Do not wrap it in Markdown. "
            "The JSON object must match this schema:\n"
            f"{json.dumps(schema.to_json_schema(), indent=2)}"
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
