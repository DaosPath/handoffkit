"""Handoff quality metrics demo without external APIs."""

from __future__ import annotations

from pathlib import Path

from handoffkit import HandoffQualityEvaluator, HandoffState

ROOT = Path(__file__).resolve().parents[1]
REPORTS_DIR = ROOT / "reports"


def build_state() -> HandoffState:
    """Build a deterministic handoff state for quality scoring."""
    return HandoffState(
        task="Create a Python CLI calculator.",
        from_agent="Architect",
        to_agent="Coder",
        summary="Build a dependency-free argparse calculator with pure operations and tests.",
        decisions=["Use argparse for CLI parsing.", "Keep math operations in pure functions."],
        important_files=["calculator.py", "test_calculator.py"],
        next_steps=["Implement calculator.py", "Write pytest coverage", "Run pytest -q"],
        context_refs=["README.md#real-task-demo"],
        metadata={"errors_checked": True},
    )


def main() -> None:
    """Evaluate one handoff state and write Markdown/JSON reports."""
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    report = HandoffQualityEvaluator().evaluate(build_state())

    markdown_path = REPORTS_DIR / "handoff_quality_demo.md"
    json_path = REPORTS_DIR / "handoff_quality_demo.json"
    markdown_path.write_text(report.to_markdown(), encoding="utf-8")
    json_path.write_text(report.to_json(), encoding="utf-8")

    print(f"Handoff quality success: {report.success}")
    print(f"Score: {report.score:.3f}")
    print(f"Grade: {report.grade}")
    print(f"Markdown report: {markdown_path}")
    print(f"JSON report: {json_path}")


if __name__ == "__main__":
    main()
