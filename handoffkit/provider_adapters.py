"""Provider-agnostic tool call adapters."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Literal

from handoffkit.structured import JsonOutputParser, OutputValidationError
from handoffkit.tool import Tool, ensure_tool
from handoffkit.tool_execution import ToolCall

ProviderToolFormat = Literal["handoffkit", "openai", "anthropic"]
SUPPORTED_PROVIDER_FORMATS: set[str] = {"handoffkit", "openai", "anthropic"}


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
    provider: str = ""
    tool_format: str = "handoffkit"
    supports_parallel_tool_calls: bool = False
    strict_json_schema: bool = False

    def to_dict(self) -> dict[str, Any]:
        """Serialize capabilities."""
        return {
            "supports_structured_output": self.supports_structured_output,
            "supports_tool_calling": self.supports_tool_calling,
            "supports_json_mode": self.supports_json_mode,
            "supports_streaming": self.supports_streaming,
            "metadata": self.metadata,
            "provider": self.provider,
            "tool_format": self.tool_format,
            "supports_parallel_tool_calls": self.supports_parallel_tool_calls,
            "strict_json_schema": self.strict_json_schema,
        }

    def to_json(self, *, indent: int | None = 2) -> str:
        """Serialize capabilities as JSON."""
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=indent, default=_json_default)


class ToolCallParser:
    """Parse provider-style tool calls into HandoffKit ToolCall objects."""

    def __init__(self, *, provider_format: ProviderToolFormat = "handoffkit") -> None:
        self.json_parser = JsonOutputParser()
        self.provider_format = self._normalize_format(provider_format)

    def parse(
        self,
        value: str | dict[str, Any],
        *,
        provider_format: ProviderToolFormat | None = None,
    ) -> list[ToolCall]:
        """Parse tool calls from text or a dictionary."""
        payload = self._payload(value)
        selected = self._normalize_format(provider_format or self.provider_format)
        if selected == "anthropic":
            return self._parse_anthropic(payload)
        return self._parse_tool_calls_array(payload)

    def _normalize_format(self, provider_format: str) -> ProviderToolFormat:
        if provider_format not in SUPPORTED_PROVIDER_FORMATS:
            raise ValueError(
                "provider_format must be 'handoffkit', 'openai', or 'anthropic'"
            )
        return provider_format  # type: ignore[return-value]

    def _payload(self, value: str | dict[str, Any]) -> dict[str, Any]:
        if isinstance(value, dict):
            return value
        return self.json_parser.parse(value)

    def _parse_tool_calls_array(self, payload: dict[str, Any]) -> list[ToolCall]:
        raw_calls = payload.get("tool_calls") or []
        if raw_calls is None:
            return []
        if not isinstance(raw_calls, list):
            raise OutputValidationError("tool_calls must be a list")
        calls: list[ToolCall] = []
        for item in raw_calls:
            if not isinstance(item, dict):
                raise OutputValidationError("tool_calls items must be objects")
            calls.append(self._parse_one(item))
        return calls

    def _parse_anthropic(self, payload: dict[str, Any]) -> list[ToolCall]:
        raw_content = payload.get("content", payload.get("tool_calls", [])) or []
        if not isinstance(raw_content, list):
            raise OutputValidationError("anthropic content/tool_calls must be a list")
        calls: list[ToolCall] = []
        for item in raw_content:
            if not isinstance(item, dict):
                raise OutputValidationError("anthropic content items must be objects")
            if item.get("type") != "tool_use" and "input" not in item:
                continue
            if not item.get("name"):
                raise OutputValidationError("anthropic tool_use name is required")
            call = ToolCall(
                tool_name=str(item.get("name", "")),
                arguments=self._arguments(item.get("input", {})),
                call_id=str(item.get("id") or item.get("call_id") or ""),
                metadata={"provider_format": "anthropic"},
            )
            if not call.call_id:
                call.call_id = ToolCall(call.tool_name, call.arguments).call_id
            calls.append(call)
        return calls

    def _parse_one(self, item: dict[str, Any]) -> ToolCall:
        call_id = str(item.get("call_id") or item.get("id") or "")
        if "function" in item and isinstance(item["function"], dict):
            function = item["function"]
            name = str(function.get("name", ""))
            if not name:
                raise OutputValidationError("openai function tool call name is required")
            arguments = self._arguments(function.get("arguments", {}))
            call = ToolCall(
                tool_name=name,
                arguments=arguments,
                metadata={"provider_format": "openai"},
            )
            if call_id:
                call.call_id = call_id
            return call
        if item.get("type") == "tool_use" or "input" in item:
            if not item.get("name"):
                raise OutputValidationError("anthropic tool_use name is required")
            call = ToolCall(
                tool_name=str(item.get("name", "")),
                arguments=self._arguments(item.get("input", {})),
                metadata={"provider_format": "anthropic"},
            )
            if call_id:
                call.call_id = call_id
            return call
        name = str(item.get("tool_name") or item.get("name") or "")
        if not name:
            raise OutputValidationError("tool call name is required")
        arguments = self._arguments(item.get("arguments", {}))
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

    def __init__(
        self,
        *,
        capabilities: ProviderCapabilities | None = None,
        provider_format: ProviderToolFormat | None = None,
    ) -> None:
        selected_format = provider_format or (
            capabilities.tool_format if capabilities else "handoffkit"
        )
        self.provider_format = self._normalize_format(selected_format)
        self.capabilities = capabilities or ProviderCapabilities(
            supports_tool_calling=True,
            supports_json_mode=True,
            tool_format=self.provider_format,
        )
        self.capabilities.tool_format = self.provider_format
        self.parser = ToolCallParser(provider_format=self.provider_format)

    def _normalize_format(self, provider_format: str) -> ProviderToolFormat:
        if provider_format not in SUPPORTED_PROVIDER_FORMATS:
            raise ValueError(
                "provider_format must be 'handoffkit', 'openai', or 'anthropic'"
            )
        return provider_format  # type: ignore[return-value]

    def tools_to_provider_format(
        self,
        tools: list[Tool] | tuple[Tool, ...] | list[Any] | tuple[Any, ...],
        provider_format: ProviderToolFormat | None = None,
    ) -> list[dict[str, Any]]:
        """Return tool schemas in the requested provider format."""
        selected = self._normalize_format(provider_format or self.provider_format)
        schemas = [ensure_tool(item).to_schema() for item in tools]
        if selected == "handoffkit":
            return schemas
        if selected == "openai":
            return [
                {
                    "type": "function",
                    "function": {
                        "name": schema["name"],
                        "description": schema.get("description", ""),
                        "parameters": schema.get("parameters", {"type": "object"}),
                    },
                }
                for schema in schemas
            ]
        return [
            {
                "name": schema["name"],
                "description": schema.get("description", ""),
                "input_schema": schema.get("parameters", {"type": "object"}),
            }
            for schema in schemas
        ]

    def parse_tool_calls(
        self,
        provider_response: str | dict[str, Any],
        provider_format: ProviderToolFormat | None = None,
    ) -> list[ToolCall]:
        """Parse provider response into normalized tool calls."""
        return self.parser.parse(provider_response, provider_format=provider_format)

    def parse_final(self, provider_response: str | dict[str, Any]) -> str | None:
        """Return final response text when present."""
        payload = (
            provider_response
            if isinstance(provider_response, dict)
            else self.parser._payload(provider_response)
        )
        final = payload.get("final") or payload.get("output_text")
        if final is not None:
            return str(final)
        content = payload.get("content")
        if isinstance(content, list):
            text_parts = [
                str(item.get("text", ""))
                for item in content
                if isinstance(item, dict) and item.get("type") in {"text", "output_text"}
            ]
            return "\n".join(part for part in text_parts if part) or None
        return None

    def to_dict(self) -> dict[str, Any]:
        """Serialize this adapter configuration."""
        return {
            "provider_format": self.provider_format,
            "capabilities": self.capabilities.to_dict(),
        }
