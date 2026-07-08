"""Provider tool adapter demo without external APIs."""

from __future__ import annotations

import json
from pathlib import Path

from handoffkit import ProviderToolAdapter, ToolRegistry, tool

ROOT = Path(__file__).resolve().parents[1]
REPORTS_DIR = ROOT / "reports"


@tool
def label(value: str) -> str:
    """Return a labeled value."""
    return f"label:{value}"


def main() -> None:
    """Parse a provider-style tool call and execute it locally."""
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    adapter = ProviderToolAdapter()
    registry = ToolRegistry([label])
    provider_response = {
        "tool_calls": [
            {
                "id": "call_provider_adapter_demo",
                "function": {
                    "name": "label",
                    "arguments": '{"value":"provider-adapter"}',
                }
            }
        ],
        "final": None,
    }
    provider_tools = adapter.tools_to_provider_format([label])
    tool_calls = adapter.parse_tool_calls(provider_response)
    tool_results = [registry.execute(call) for call in tool_calls]
    report = {
        "provider_tools": provider_tools,
        "tool_calls": [call.to_dict() for call in tool_calls],
        "tool_results": [result.to_dict() for result in tool_results],
        "capabilities": adapter.capabilities.to_dict(),
    }

    markdown = (
        "# Provider Tool Adapter Demo\n\n"
        f"## Tool Calls\n\n{tool_calls[0].tool_name if tool_calls else 'none'}\n\n"
        f"## Result\n\n{tool_results[0].result if tool_results else 'none'}\n\n"
        "## Report\n\n```json\n"
        f"{json.dumps(report, indent=2)}\n"
        "```\n"
    )
    markdown_path = REPORTS_DIR / "provider_tool_adapter_demo.md"
    json_path = REPORTS_DIR / "provider_tool_adapter_demo.json"
    markdown_path.write_text(markdown, encoding="utf-8")
    json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Provider tools: {len(provider_tools)}")
    print(f"Tool calls: {len(tool_calls)}")
    print(f"Tool result: {tool_results[0].result if tool_results else 'none'}")
    print(f"Markdown report: {markdown_path}")
    print(f"JSON report: {json_path}")


if __name__ == "__main__":
    main()
