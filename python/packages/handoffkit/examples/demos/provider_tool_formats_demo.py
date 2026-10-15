"""Provider tool format demo without external APIs."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from handoffkit import ProviderToolAdapter, tool

ROOT = Path(__file__).resolve().parents[2]
REPORTS_DIR = ROOT / "reports"


@tool
def add(a: int, b: int) -> int:
    """Add two integers."""
    return a + b


def _json_default(value: Any) -> Any:
    if hasattr(value, "to_dict"):
        return value.to_dict()
    return str(value)


def main() -> None:
    """Render provider-native tool schemas and parse provider tool calls."""
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    handoffkit_adapter = ProviderToolAdapter(provider_format="handoffkit")
    openai_adapter = ProviderToolAdapter(provider_format="openai")
    anthropic_adapter = ProviderToolAdapter(provider_format="anthropic")

    schemas = {
        "handoffkit": handoffkit_adapter.tools_to_provider_format([add]),
        "openai": openai_adapter.tools_to_provider_format([add]),
        "anthropic": anthropic_adapter.tools_to_provider_format([add]),
    }
    parsed_calls = {
        "openai": [
            call.to_dict()
            for call in openai_adapter.parse_tool_calls(
                {
                    "tool_calls": [
                        {
                            "id": "call_openai_1",
                            "type": "function",
                            "function": {"name": "add", "arguments": '{"a":2,"b":3}'},
                        }
                    ]
                }
            )
        ],
        "anthropic": [
            call.to_dict()
            for call in anthropic_adapter.parse_tool_calls(
                {
                    "content": [
                        {
                            "type": "tool_use",
                            "id": "toolu_1",
                            "name": "add",
                            "input": {"a": 5, "b": 8},
                        }
                    ]
                }
            )
        ],
    }
    payload = {"schemas": schemas, "parsed_calls": parsed_calls}
    parsed_json = json.dumps(parsed_calls, ensure_ascii=False, indent=2)
    markdown = (
        "# Provider Tool Formats Demo\n\n"
        "## Formats\n\n"
        f"- handoffkit tools: {len(schemas['handoffkit'])}\n"
        f"- openai tools: {len(schemas['openai'])}\n"
        f"- anthropic tools: {len(schemas['anthropic'])}\n\n"
        "## Parsed Calls\n\n"
        f"```json\n{parsed_json}\n```\n"
    )

    markdown_path = REPORTS_DIR / "provider_tool_formats_demo.md"
    json_path = REPORTS_DIR / "provider_tool_formats_demo.json"
    markdown_path.write_text(markdown, encoding="utf-8")
    json_text = json.dumps(payload, ensure_ascii=False, indent=2, default=_json_default)
    json_path.write_text(json_text, encoding="utf-8")

    print(f"HandoffKit format tools: {len(schemas['handoffkit'])}")
    print(f"OpenAI format tools: {len(schemas['openai'])}")
    print(f"Anthropic format tools: {len(schemas['anthropic'])}")
    print(f"OpenAI call id: {parsed_calls['openai'][0]['call_id']}")
    print(f"Anthropic call id: {parsed_calls['anthropic'][0]['call_id']}")
    print(f"Markdown report: {markdown_path}")
    print(f"JSON report: {json_path}")


if __name__ == "__main__":
    main()
