"""Agent abstraction."""

from __future__ import annotations

from collections.abc import Callable, Sequence
from typing import Any

from handoffkit.handoff import HandoffState
from handoffkit.memory import AgentMemory
from handoffkit.providers import BaseProvider, EchoProvider
from handoffkit.tool import Tool, ensure_tool


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
