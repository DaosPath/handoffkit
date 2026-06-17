"""Provider-agnostic tool call adapters."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

from handoffkit.structured import JsonOutputParser, OutputValidationError
from handoffkit.tool import Tool, ensure_tool
from handoffkit.tool_execution import ToolCall


def _json_default(value: Any) -> Any:
    """Return readable JSON fallback for non-serializable values."""
    if hasattr(value, "to_dict"):
        return value.to_dict()
    return str(value)


@dataclass
class ProviderCapabilities:
    """Serializable provider capability flags."""

    supports_structured_output: bool = False
    supports_tool_calling: bool = False
    supports_json_mode: bool = False
    supports_streaming: bool = False
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Serialize capabilities."""
        return {
            "supports_structured_output": self.supports_structured_output,
            "supports_tool_calling": self.supports_tool_calling,
            "supports_json_mode": self.supports_json_mode,
            "supports_streaming": self.supports_streaming,
            "metadata": self.metadata,
        }

    def to_json(self, *, indent: int | None = 2) -> str:
        """Serialize capabilities as JSON."""
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=indent, default=_json_default)


class ToolCallParser:
    """Parse provider-style tool calls into HandoffKit ToolCall objects."""

    def __init__(self) -> None:
        self.json_parser = JsonOutputParser()

    def parse(self, value: str | dict[str, Any]) -> list[ToolCall]:
        """Parse tool calls from text or a dictionary."""
        payload = self._payload(value)
        raw_calls = payload.get("tool_calls") or []
        if raw_calls is None:
            return []
        if not isinstance(raw_calls, list):
            raise OutputValidationError("tool_calls must be a list")
        return [self._parse_one(item) for item in raw_calls if isinstance(item, dict)]

    def _payload(self, value: str | dict[str, Any]) -> dict[str, Any]:
        if isinstance(value, dict):
            return value
        return self.json_parser.parse(value)

    def _parse_one(self, item: dict[str, Any]) -> ToolCall:
        if "function" in item and isinstance(item["function"], dict):
            function = item["function"]
            name = str(function.get("name", ""))
            arguments = self._arguments(function.get("arguments", {}))
            return ToolCall(tool_name=name, arguments=arguments)
        name = str(item.get("tool_name") or item.get("name") or "")
        arguments = self._arguments(item.get("arguments", {}))
        call_id = str(item.get("call_id") or "")
        metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
        call = ToolCall(tool_name=name, arguments=arguments, metadata=metadata)
        if call_id:
            call.call_id = call_id
        return call

    def _arguments(self, value: Any) -> dict[str, Any]:
        if value is None:
            return {}
        if isinstance(value, dict):
            return value
        if isinstance(value, str):
            try:
                parsed = json.loads(value or "{}")
            except json.JSONDecodeError as exc:
                message = f"tool call arguments are not valid JSON: {exc}"
                raise OutputValidationError(message) from exc
            if not isinstance(parsed, dict):
                raise OutputValidationError("tool call arguments JSON must be an object")
            return parsed
        raise OutputValidationError(
            f"tool call arguments must be a dict or JSON string, got {type(value).__name__}"
        )


class ProviderToolAdapter:
    """Normalize tools and provider tool calls without binding to one API."""

    def __init__(self, *, capabilities: ProviderCapabilities | None = None) -> None:
        self.capabilities = capabilities or ProviderCapabilities(
            supports_tool_calling=True,
            supports_json_mode=True,
        )
        self.parser = ToolCallParser()

    def tools_to_provider_format(
        self,
        tools: list[Tool] | tuple[Tool, ...] | list[Any] | tuple[Any, ...],
    ) -> list[dict[str, Any]]:
        """Return provider-neutral tool schema objects."""
        return [ensure_tool(item).to_schema() for item in tools]

    def parse_tool_calls(self, provider_response: str | dict[str, Any]) -> list[ToolCall]:
        """Parse provider response into normalized tool calls."""
        return self.parser.parse(provider_response)

    def parse_final(self, provider_response: str | dict[str, Any]) -> str | None:
        """Return final response text when present."""
        payload = (
            provider_response
            if isinstance(provider_response, dict)
            else self.parser._payload(provider_response)
        )
        final = payload.get("final")
        return None if final is None else str(final)

    def to_dict(self) -> dict[str, Any]:
        """Serialize this adapter configuration."""
        return {"capabilities": self.capabilities.to_dict()}
