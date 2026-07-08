"""Provider JSON tool-call loop demo without API usage."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from handoffkit import Agent
from handoffkit.providers import BaseProvider
from handoffkit.tools.filesystem import read_file

ROOT = Path(__file__).resolve().parents[1]
SAMPLE = ROOT / "examples" / "output" / "tool_execution_demo" / "sample.txt"


class FakeToolCallProvider(BaseProvider):
    """Fake provider that returns JSON tool calls, then a final answer."""

    model = "fake-json-tool-provider"

    def __init__(self) -> None:
        self.calls = 0

    def generate(self, prompt: str, **kwargs: Any) -> str:
        """Return one tool call, then a final JSON response."""
        self.calls += 1
        if self.calls == 1:
            return json.dumps(
                {
                    "tool_calls": [
                        {
                            "tool_name": "read_file",
                            "arguments": {"path": str(SAMPLE)},
                        }
                    ],
                    "final": None,
                }
            )
        return json.dumps({"final": "I read the file successfully."})


def main() -> None:
    """Run fake provider tool-call loop."""
    SAMPLE.parent.mkdir(parents=True, exist_ok=True)
    if not SAMPLE.exists():
        SAMPLE.write_text("HandoffKit tool execution demo.\n", encoding="utf-8")

    agent = Agent(
        name="FakeProviderAgent",
        role="Use provider JSON tool calls.",
        provider=FakeToolCallProvider(),
        tools=[read_file],
    )
    report = agent.run_with_tools("Read the sample file with a tool.")
    print(f"Tool calls: {[call.tool_name for call in report.tool_calls]}")
    print(f"Tool results: {[result.success for result in report.tool_results]}")
    print(f"Final output: {report.final_output}")


if __name__ == "__main__":
    main()
