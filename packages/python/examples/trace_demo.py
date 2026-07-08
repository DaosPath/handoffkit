"""Run trace demo without external APIs."""

from __future__ import annotations

from pathlib import Path

from handoffkit import Agent, HandoffProtocol, RunTrace, Team, write_report_files

ROOT = Path(__file__).resolve().parents[1]
REPORTS_DIR = ROOT / "reports"


def main() -> None:
    """Run a local team workflow and write a replayable trace report."""
    team = Team(
        agents=[
            Agent("Architect", "Create implementation plans."),
            Agent("Coder", "Implement from structured handoffs."),
            Agent("Tester", "Review implementation evidence."),
        ],
        protocol=HandoffProtocol(mode="hybrid_state"),
    )
    result = team.run("Create a small Python CLI calculator with tests.")
    trace = RunTrace.from_team_result(result, name="trace-demo")
    json_path, markdown_path = write_report_files(trace, "trace_demo", REPORTS_DIR)

    print(f"Trace success: {trace.success}")
    print(f"Steps: {len(trace.steps)}")
    print(f"Handoffs: {len(trace.handoffs)}")
    print(f"Markdown report: {markdown_path}")
    print(f"JSON report: {json_path}")


if __name__ == "__main__":
    main()
