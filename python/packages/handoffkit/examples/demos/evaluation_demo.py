"""Offline workflow evaluation demo."""

from __future__ import annotations

from handoffkit import Agent, HandoffProtocol, RunTrace, Team, WorkflowEvaluator, write_report_files


def main() -> None:
    """Evaluate a local team run and write reusable reports."""
    team = Team(
        agents=[
            Agent("Architect", "Plan implementation."),
            Agent("Coder", "Implement from handoff state."),
            Agent("Tester", "Review the result."),
        ],
        protocol=HandoffProtocol(mode="hybrid_state"),
    )
    result = team.run("Create a tiny Python CLI calculator.")
    trace = RunTrace.from_team_result(result, name="evaluation-demo")
    report = WorkflowEvaluator().evaluate(trace)
    write_report_files(report, "evaluation_demo")
    print(report.to_markdown())


if __name__ == "__main__":
    main()
