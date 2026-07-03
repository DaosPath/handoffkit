"""Tests for provider tool adapters."""

from __future__ import annotations

import json
from typing import Any

from handoffkit import (
    Agent,
    ProviderCapabilities,
    ProviderToolAdapter,
    ToolCallParser,
    tool,
)
from handoffkit.providers import BaseProvider


@tool
def read_file(path: str) -> str:
    """Read a file."""
    return f"read:{path}"


class ProviderJsonFakeProvider(BaseProvider):
    """Fake provider returning provider-style tool calls."""

    model = "fake-provider-json"

    def __init__(self, outputs: list[str]) -> None:
        self.outputs = outputs
        self.index = 0

    def generate(self, prompt: str, **kwargs: Any) -> str:
        """Return next configured output."""
        output = self.outputs[min(self.index, len(self.outputs) - 1)]
        self.index += 1
        return output


def test_provider_capabilities_serialization() -> None:
    capabilities = ProviderCapabilities(
        supports_structured_output=True,
        supports_tool_calling=True,
        supports_json_mode=True,
        metadata={"provider": "fake"},
        provider="fake",
        tool_format="openai",
        supports_parallel_tool_calls=True,
        strict_json_schema=True,
    )

    assert capabilities.to_dict()["supports_tool_calling"] is True
    payload = json.loads(capabilities.to_json())
    assert payload["metadata"]["provider"] == "fake"
    assert payload["provider"] == "fake"
    assert payload["tool_format"] == "openai"
    assert payload["supports_parallel_tool_calls"] is True
    assert payload["strict_json_schema"] is True


def test_provider_tool_adapter_tools_to_provider_format() -> None:
    adapter = ProviderToolAdapter()

    schema = adapter.tools_to_provider_format([read_file])[0]

    assert schema["name"] == "read_file"
    assert schema["parameters"]["properties"]["path"]["type"] == "string"


def test_provider_tool_adapter_parse_handoffkit_json_tool_calls() -> None:
    adapter = ProviderToolAdapter()

    calls = adapter.parse_tool_calls(
        {"tool_calls": [{"tool_name": "read_file", "arguments": {"path": "README.md"}}]}
    )

    assert calls[0].tool_name == "read_file"
    assert calls[0].arguments == {"path": "README.md"}


def test_provider_tool_adapter_parse_function_style_tool_calls() -> None:
    adapter = ProviderToolAdapter()

    calls = adapter.parse_tool_calls(
        {
            "tool_calls": [
                {
                    "function": {
                        "name": "read_file",
                        "arguments": '{"path":"README.md"}',
                    }
                }
            ]
        }
    )

    assert calls[0].tool_name == "read_file"
    assert calls[0].arguments == {"path": "README.md"}


def test_tool_call_parser_args_dict() -> None:
    calls = ToolCallParser().parse(
        {"tool_calls": [{"tool_name": "read_file", "arguments": {"path": "README.md"}}]}
    )

    assert calls[0].arguments["path"] == "README.md"


def test_tool_call_parser_args_json_string() -> None:
    calls = ToolCallParser().parse(
        {
            "tool_calls": [
                {"tool_name": "read_file", "arguments": '{"path":"README.md"}'},
            ]
        }
    )

    assert calls[0].arguments["path"] == "README.md"


def test_agent_run_with_tools_provider_json_mode() -> None:
    provider = ProviderJsonFakeProvider(
        [
            json.dumps(
                {
                    "tool_calls": [
                        {
                            "function": {
                                "name": "read_file",
                                "arguments": '{"path":"README.md"}',
                            }
                        }
                    ],
                    "final": None,
                }
            ),
            json.dumps({"final": "Done."}),
        ]
    )
    agent = Agent("ProviderAgent", "Use provider tools.", provider=provider, tools=[read_file])

    report = agent.run_with_tools("Read README.", tool_call_mode="provider_json")

    assert report.success is True
    assert report.tool_results[0].result == "read:README.md"
    assert report.final_output == "Done."


def test_agent_run_with_tools_provider_json_final_only() -> None:
    provider = ProviderJsonFakeProvider([json.dumps({"final": "Done."})])
    agent = Agent("ProviderAgent", "Use provider tools.", provider=provider, tools=[read_file])

    report = agent.run_with_tools("Finish.", tool_call_mode="provider_json")

    assert report.success is True
    assert report.final_output == "Done."


def test_agent_run_with_tools_provider_json_invalid_arguments_fails() -> None:
    provider = ProviderJsonFakeProvider(
        [
            json.dumps(
                {
                    "tool_calls": [
                        {
                            "function": {
                                "name": "read_file",
                                "arguments": "not-json",
                            }
                        }
                    ]
                }
            )
        ]
    )
    agent = Agent("ProviderAgent", "Use provider tools.", provider=provider, tools=[read_file])

    report = agent.run_with_tools("Read.", tool_call_mode="provider_json")

    assert report.success is False
    assert "not valid JSON" in report.final_output


def test_agent_run_with_tools_deterministic_mode_still_works() -> None:
    agent = Agent("LocalAgent", "Use local tools.", tools=[read_file])

    report = agent.run_with_tools("read file README.md", tool_call_mode="deterministic")

    assert report.success is True
    assert report.tool_results[0].result == "read:README.md"



def test_provider_tool_adapter_openai_tool_format() -> None:
    schema = ProviderToolAdapter(provider_format="openai").tools_to_provider_format([read_file])[0]

    assert schema["type"] == "function"
    assert schema["function"]["name"] == "read_file"
    assert schema["function"]["parameters"]["properties"]["path"]["type"] == "string"


def test_provider_tool_adapter_anthropic_tool_format() -> None:
    adapter = ProviderToolAdapter(provider_format="anthropic")
    schema = adapter.tools_to_provider_format([read_file])[0]

    assert schema["name"] == "read_file"
    assert schema["input_schema"]["properties"]["path"]["type"] == "string"


def test_provider_tool_adapter_preserves_openai_call_id() -> None:
    calls = ProviderToolAdapter(provider_format="openai").parse_tool_calls(
        {
            "tool_calls": [
                {
                    "id": "call_123",
                    "type": "function",
                    "function": {"name": "read_file", "arguments": '{"path":"README.md"}'},
                }
            ]
        }
    )

    assert calls[0].call_id == "call_123"
    assert calls[0].metadata["provider_format"] == "openai"


def test_provider_tool_adapter_parses_anthropic_tool_use() -> None:
    calls = ProviderToolAdapter(provider_format="anthropic").parse_tool_calls(
        {
            "content": [
                {"type": "text", "text": "I will inspect the file."},
                {
                    "type": "tool_use",
                    "id": "toolu_123",
                    "name": "read_file",
                    "input": {"path": "README.md"},
                },
            ]
        }
    )

    assert calls[0].tool_name == "read_file"
    assert calls[0].arguments == {"path": "README.md"}
    assert calls[0].call_id == "toolu_123"
    assert calls[0].metadata["provider_format"] == "anthropic"


def test_agent_run_with_tools_provider_adapter_argument() -> None:
    provider = ProviderJsonFakeProvider(
        [
            json.dumps(
                {
                    "content": [
                        {
                            "type": "tool_use",
                            "id": "toolu_run",
                            "name": "read_file",
                            "input": {"path": "README.md"},
                        }
                    ]
                }
            ),
            json.dumps({"content": [{"type": "text", "text": "Done."}]}),
        ]
    )
    agent = Agent("ProviderAgent", "Use provider tools.", provider=provider, tools=[read_file])
    adapter = ProviderToolAdapter(provider_format="anthropic")

    report = agent.run_with_tools(
        "Read README.",
        tool_call_mode="provider_json",
        provider_adapter=adapter,
    )

    assert report.success is True
    assert report.tool_calls[0].call_id == "toolu_run"
    assert report.tool_results[0].result == "read:README.md"
    assert report.final_output == "Done."
