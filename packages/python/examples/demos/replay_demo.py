"""Replay demo without external APIs or re-execution."""

from __future__ import annotations

from pathlib import Path

from handoffkit import Agent, HandoffProtocol, ReplayRunner, RunTrace, Team, write_report_files

ROOT = Path(__file__).resolve().parents[2]
REPORTS_DIR = ROOT / "reports"


def main() -> None:
    """Create a trace, summarize it, and write replay reports."""
    team = Team(
        agents=[Agent("Planner", "Plan work."), Agent("Reviewer", "Review work.")],
        protocol=HandoffProtocol(mode="hybrid_state"),
    )
    trace = RunTrace.from_team_result(
        team.run("Prepare a local release checklist."),
        name="replay-demo-source",
    )
    summary = ReplayRunner(trace).summary()
    json_path, markdown_path = write_report_files(summary, "replay_demo", REPORTS_DIR)

    print(f"Replay success: {summary.success}")
    print(f"Steps: {summary.step_count}")
    print(f"Handoffs: {summary.handoff_count}")
    print(f"Markdown report: {markdown_path}")
    print(f"JSON report: {json_path}")


if __name__ == "__main__":
    main()
