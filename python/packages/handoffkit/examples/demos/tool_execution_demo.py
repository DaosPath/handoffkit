"""Local deterministic tool execution demo."""

from __future__ import annotations

from pathlib import Path

from handoffkit import Agent
from handoffkit.tools.filesystem import list_files, read_file, write_file

ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = ROOT / "examples" / "output" / "tool_execution_demo"
REPORTS_DIR = ROOT / "reports"


def main() -> None:
    """Run local tool execution and write reports."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    sample = OUTPUT_DIR / "sample.txt"
    sample.write_text("HandoffKit tool execution demo.\n", encoding="utf-8")

    agent = Agent(
        name="FileAgent",
        role="Use tools to inspect files.",
        tools=[read_file, write_file, list_files],
    )
    report = agent.run_with_tools(f"read file {sample}")

    markdown_path = REPORTS_DIR / "tool_execution_demo.md"
    json_path = REPORTS_DIR / "tool_execution_demo.json"
    markdown_path.write_text(report.to_markdown(), encoding="utf-8")
    json_path.write_text(report.to_json(), encoding="utf-8")

    print(f"Tool calls: {[call.tool_name for call in report.tool_calls]}")
    print(f"Tool results: {[result.success for result in report.tool_results]}")
    print(f"Final output: {report.final_output}")
    print(f"Markdown report: {markdown_path}")
    print(f"JSON report: {json_path}")


if __name__ == "__main__":
    main()
