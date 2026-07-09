"""Run tracing primitives for replayable HandoffKit workflows."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from handoffkit.handoff import HandoffState


def _json_default(value: Any) -> Any:
    """Return readable JSON fallback for non-serializable values."""
    if hasattr(value, "to_dict"):
        return value.to_dict()
    return str(value)


def _stable_run_id(prefix: str, payload: dict[str, Any]) -> str:
    """Return a stable compact run id for deterministic demos and tests."""
    encoded = json.dumps(payload, sort_keys=True, default=_json_default).encode("utf-8")
    return f"{prefix}-{hashlib.sha256(encoded).hexdigest()[:12]}"


def _maybe_handoff(value: Any) -> HandoffState | dict[str, Any] | None:
    """Return a handoff object or dictionary from mixed serialized inputs."""
    if value is None:
        return None
    if isinstance(value, HandoffState):
        return value
    if isinstance(value, dict):
        expected = {"task", "from_agent", "to_agent"}
        if expected.issubset(value):
            return HandoffState.from_dict(value)
        return value
    return None


@dataclass
class TraceEvent:
    """One event attached to a trace step."""

    kind: str
    message: str
    timestamp: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Serialize this event."""
        return {
            "kind": self.kind,
            "message": self.message,
            "timestamp": self.timestamp,
            "metadata": self.metadata,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> TraceEvent:
        """Create a trace event from a dictionary."""
        return cls(
            kind=str(data.get("kind", "")),
            message=str(data.get("message", "")),
            timestamp=str(data.get("timestamp", "")),
            metadata=data.get("metadata") if isinstance(data.get("metadata"), dict) else {},
        )


@dataclass
class TraceStep:
    """One replayable step in a run trace."""

    name: str
    agent: str = ""
    task: str = ""
    mode: str = ""
    success: bool = True
    output: str = ""
    handoff: HandoffState | dict[str, Any] | None = None
    tool_results: list[Any] = field(default_factory=list)
    events: list[TraceEvent] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Serialize this trace step."""
        return {
            "name": self.name,
            "agent": self.agent,
            "task": self.task,
            "mode": self.mode,
            "success": self.success,
            "output": self.output,
            "handoff": (
                self.handoff.to_dict()
                if hasattr(self.handoff, "to_dict")
                else self.handoff
            ),
            "tool_results": [
                result.to_dict() if hasattr(result, "to_dict") else result
                for result in self.tool_results
            ],
            "events": [event.to_dict() for event in self.events],
            "metadata": self.metadata,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> TraceStep:
        """Create a trace step from a dictionary."""
        return cls(
            name=str(data.get("name", "")),
            agent=str(data.get("agent", "")),
            task=str(data.get("task", "")),
            mode=str(data.get("mode", "")),
            success=bool(data.get("success", True)),
            output=str(data.get("output", "")),
            handoff=_maybe_handoff(data.get("handoff")),
            tool_results=(
                data.get("tool_results") if isinstance(data.get("tool_results"), list) else []
            ),
            events=[
                TraceEvent.from_dict(event)
                for event in data.get("events", [])
                if isinstance(event, dict)
            ],
            metadata=data.get("metadata") if isinstance(data.get("metadata"), dict) else {},
        )


@dataclass
class RunTrace:
    """Replayable trace for a team, recipe, or tool execution run."""

    run_id: str
    name: str
    success: bool
    final_output: str
    steps: list[TraceStep] = field(default_factory=list)
    handoffs: list[HandoffState | dict[str, Any]] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Serialize this trace."""
        return {
            "run_id": self.run_id,
            "name": self.name,
            "success": self.success,
            "final_output": self.final_output,
            "steps": [step.to_dict() for step in self.steps],
            "handoffs": [
                handoff.to_dict() if hasattr(handoff, "to_dict") else handoff
                for handoff in self.handoffs
            ],
            "metadata": self.metadata,
        }

    def to_json(self, *, indent: int | None = 2) -> str:
        """Serialize this trace as JSON."""
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=indent, default=_json_default)

    def to_timeline(self) -> str:
        """Render trace execution timeline as structured text."""
        lines = [
            f"# Execution Timeline: {self.name} (Run ID: {self.run_id})",
            f"- Success: {str(self.success).lower()}",
            f"- Total Steps: {len(self.steps)}",
            f"- Total Handoffs: {len(self.handoffs)}",
            "",
            "## Timeline",
        ]

        for i, step in enumerate(self.steps, start=1):
            agent_name = step.agent or "Unknown"
            lines.append(f"{i}. [{agent_name}] -> Task: {step.task}")
            lines.append(f"   - Mode: {step.mode or 'default'}")
            lines.append(f"   - Success: {str(step.success).lower()}")
            lines.append(f"   - Tools Used: {len(step.tool_results)}")
            if step.output:
                cleaned_output = step.output.replace("\n", " ")
                preview = (
                    cleaned_output[:60] + "..."
                    if len(cleaned_output) > 60
                    else cleaned_output
                )
                lines.append(f"   - Output Preview: {preview}")
            if step.handoff:
                h = step.handoff
                from_a = h.from_agent if hasattr(h, "from_agent") else h.get("from_agent", "")
                to_a = h.to_agent if hasattr(h, "to_agent") else h.get("to_agent", "")
                lines.append(f"   - [Handoff] -> {from_a} to {to_a}")

        return "\n".join(lines)

    def to_markdown(self) -> str:
        """Serialize this trace as Markdown."""
        steps = "\n".join(
            (
                f"- `{step.name}` agent={step.agent or 'n/a'} "
                f"mode={step.mode or 'n/a'} success={step.success}"
            )
            for step in self.steps
        ) or "- none"
        handoffs = "\n".join(
            (
                f"- `{handoff.from_agent}` -> `{handoff.to_agent}`: {handoff.task}"
                if isinstance(handoff, HandoffState)
                else f"- `{handoff.get('from_agent', '')}` -> "
                f"`{handoff.get('to_agent', '')}`: {handoff.get('task', '')}"
            )
            for handoff in self.handoffs
        ) or "- none"
        return (
            f"# Run Trace: {self.name}\n\n"
            f"## Run ID\n\n{self.run_id}\n\n"
            f"## Success\n\n{self.success}\n\n"
            f"## Final Output\n\n{self.final_output}\n\n"
            f"## Steps\n\n{steps}\n\n"
            f"## Handoffs\n\n{handoffs}\n"
        )

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> RunTrace:
        """Create a run trace from a dictionary."""
        return cls(
            run_id=str(data.get("run_id", "")),
            name=str(data.get("name", "")),
            success=bool(data.get("success", False)),
            final_output=str(data.get("final_output", "")),
            steps=[
                TraceStep.from_dict(step)
                for step in data.get("steps", [])
                if isinstance(step, dict)
            ],
            handoffs=[
                item
                for item in (_maybe_handoff(handoff) for handoff in data.get("handoffs", []))
                if item is not None
            ],
            metadata=data.get("metadata") if isinstance(data.get("metadata"), dict) else {},
        )

    @classmethod
    def from_json(cls, value: str) -> RunTrace:
        """Create a run trace from a JSON string."""
        data = json.loads(value)
        if not isinstance(data, dict):
            raise ValueError("RunTrace JSON must decode to an object.")
        return cls.from_dict(data)

    @classmethod
    def from_team_result(
        cls,
        result: Any,
        *,
        run_id: str = "",
        name: str = "team-run",
    ) -> RunTrace:
        """Create a trace from a TeamRunResult-like object."""
        handoffs = list(getattr(result, "handoffs", []))
        outputs = list(getattr(result, "agent_outputs", []))
        steps = []
        for index, output in enumerate(outputs):
            handoff = handoffs[index - 1] if index > 0 and index - 1 < len(handoffs) else None
            steps.append(
                TraceStep(
                    name=f"step-{index + 1}",
                    agent=str(getattr(output, "agent", "")),
                    task=str(getattr(result, "task", "")),
                    mode="team",
                    success=True,
                    output=str(getattr(output, "output", "")),
                    handoff=handoff,
                    events=[TraceEvent(kind="agent_output", message="Agent produced output.")],
                )
            )
        payload = {
            "name": name,
            "task": getattr(result, "task", ""),
            "final_output": getattr(result, "final_output", ""),
            "steps": [step.to_dict() for step in steps],
        }
        return cls(
            run_id=run_id or _stable_run_id("team", payload),
            name=name,
            success=True,
            final_output=str(getattr(result, "final_output", "")),
            steps=steps,
            handoffs=handoffs,
            metadata={"source": "TeamRunResult", "task": getattr(result, "task", "")},
        )

    @classmethod
    def from_recipe_result(
        cls,
        result: Any,
        *,
        run_id: str = "",
        name: str = "",
    ) -> RunTrace:
        """Create a trace from a RecipeRunResult-like object."""
        step_results = list(getattr(result, "step_results", []))
        handoffs = list(getattr(result, "handoff_states", []))
        steps = []
        for index, item in enumerate(step_results):
            if not isinstance(item, dict):
                continue
            handoff = handoffs[index - 1] if index > 0 and index - 1 < len(handoffs) else None
            steps.append(
                TraceStep(
                    name=str(item.get("step_name", f"step-{index + 1}")),
                    agent=str(item.get("agent_name", "")),
                    task=str(item.get("task", "")),
                    mode=str(item.get("mode", "recipe")),
                    success=bool(item.get("success", False)),
                    output=str(item.get("output", "")),
                    handoff=handoff,
                    metadata=item.get("metadata") if isinstance(item.get("metadata"), dict) else {},
                    events=[TraceEvent(kind="recipe_step", message="Recipe step completed.")],
                )
            )
        trace_name = name or str(getattr(result, "recipe_name", "recipe-run"))
        payload = {
            "name": trace_name,
            "final_output": getattr(result, "final_output", ""),
            "steps": [step.to_dict() for step in steps],
        }
        return cls(
            run_id=run_id or _stable_run_id("recipe", payload),
            name=trace_name,
            success=bool(getattr(result, "success", False)),
            final_output=str(getattr(result, "final_output", "")),
            steps=steps,
            handoffs=handoffs,
            metadata={"source": "RecipeRunResult", "recipe": trace_name},
        )

    @classmethod
    def from_tool_execution_report(
        cls,
        report: Any,
        *,
        run_id: str = "",
        name: str = "tool-execution",
    ) -> RunTrace:
        """Create a trace from a ToolExecutionReport-like object."""
        tool_results = list(getattr(report, "tool_results", []))
        step_dicts = list(getattr(report, "steps", []))
        if step_dicts:
            steps = [
                TraceStep(
                    name=f"tool-step-{index + 1}",
                    agent=str(getattr(report, "agent_name", "")),
                    task=str(getattr(report, "task", "")),
                    mode=str(step.get("mode", "tools")) if isinstance(step, dict) else "tools",
                    success=bool(getattr(report, "success", False)),
                    output=str(getattr(report, "final_output", "")),
                    tool_results=tool_results,
                    metadata=step if isinstance(step, dict) else {},
                    events=[TraceEvent(kind="tool_execution", message="Tool loop step recorded.")],
                )
                for index, step in enumerate(step_dicts)
            ]
        else:
            steps = [
                TraceStep(
                    name="tool-step-1",
                    agent=str(getattr(report, "agent_name", "")),
                    task=str(getattr(report, "task", "")),
                    mode="tools",
                    success=bool(getattr(report, "success", False)),
                    output=str(getattr(report, "final_output", "")),
                    tool_results=tool_results,
                    events=[TraceEvent(kind="tool_execution", message="Tool report recorded.")],
                )
            ]
        payload = {
            "name": name,
            "task": getattr(report, "task", ""),
            "final_output": getattr(report, "final_output", ""),
            "steps": [step.to_dict() for step in steps],
        }
        return cls(
            run_id=run_id or _stable_run_id("tools", payload),
            name=name,
            success=bool(getattr(report, "success", False)),
            final_output=str(getattr(report, "final_output", "")),
            steps=steps,
            metadata={"source": "ToolExecutionReport", "agent": getattr(report, "agent_name", "")},
        )

    @staticmethod
    def json_schema() -> dict[str, Any]:
        """Return a JSON-schema-like contract for RunTrace."""
        return {
            "title": "RunTrace",
            "type": "object",
            "properties": {
                "run_id": {"type": "string"},
                "name": {"type": "string"},
                "success": {"type": "boolean"},
                "final_output": {"type": "string"},
                "steps": {"type": "array"},
                "handoffs": {"type": "array"},
                "metadata": {"type": "object"},
            },
            "required": ["run_id", "name", "success", "final_output"],
            "additionalProperties": True,
        }


class FileTraceStore:
    """File-backed storage for JSON run traces."""

    def __init__(self, root: str | Path = "traces") -> None:
        self.root = Path(root)

    def save(self, trace: RunTrace, *, name: str | None = None) -> Path:
        """Save a trace and return its JSON path."""
        self.root.mkdir(parents=True, exist_ok=True)
        filename = f"{name or trace.run_id}.json"
        path = self.root / filename
        path.write_text(trace.to_json(), encoding="utf-8")
        return path

    def load(self, name_or_path: str | Path) -> RunTrace:
        """Load a trace by path or file name."""
        path = Path(name_or_path)
        if not path.is_absolute():
            path = self.root / path
        if path.suffix != ".json":
            path = path.with_suffix(".json")
        return RunTrace.from_json(path.read_text(encoding="utf-8"))

    def list(self) -> list[Path]:
        """List trace JSON files."""
        if not self.root.exists():
            return []
        return sorted(self.root.glob("*.json"))
