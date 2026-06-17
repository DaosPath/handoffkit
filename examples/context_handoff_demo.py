"""Context-aware Architect -> Coder -> Tester handoff demo."""

from __future__ import annotations

from pathlib import Path

from handoffkit import (
    Agent,
    ContextPack,
    ContextRetriever,
    HandoffProtocol,
    JsonMemoryStore,
    ProjectIndexer,
)

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "examples" / "output" / "context_handoff_demo"
SAMPLE_PROJECT = OUTPUT_DIR / "sample_project"
REPORTS_DIR = ROOT / "reports"


def write_sample_project() -> None:
    """Create deterministic files for the context demo."""
    SAMPLE_PROJECT.mkdir(parents=True, exist_ok=True)
    (SAMPLE_PROJECT / "README.md").write_text(
        "Calculator CLI\n\nUse argparse and keep calculator operations pure.",
        encoding="utf-8",
    )
    (SAMPLE_PROJECT / "test_plan.md").write_text(
        "Test add, subtract, multiply, divide, and divide-by-zero behavior.",
        encoding="utf-8",
    )


def main() -> None:
    """Pass context references through a three-agent workflow."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    write_sample_project()

    memory = JsonMemoryStore(str(OUTPUT_DIR / "memory.json"))
    memory.clear()
    memory.add(
        "Use argparse for the CLI and pure functions for arithmetic.",
        kind="decision",
        tags=["calculator", "architecture"],
    )

    documents = ProjectIndexer(str(SAMPLE_PROJECT)).index()
    matches = ContextRetriever(documents).search("calculator argparse tests", limit=3)
    context = ContextPack(
        query="Create a Python CLI calculator plan.",
        documents=matches,
        memories=memory.search("calculator argparse", limit=3),
    )

    architect = Agent("Architect", "Create implementation plans.")
    coder = Agent("Coder", "Implement from structured state.")
    tester = Agent("Tester", "Validate behavior and report evidence.")
    protocol = HandoffProtocol(mode="hybrid_state")

    architect_result = architect.run_with_context(
        "Create a concise architecture plan for a Python CLI calculator.",
        context=context,
        memory=memory,
    )
    coder_state = protocol.transfer(
        from_agent=architect,
        to_agent=coder,
        task="Implement the calculator CLI from the architecture plan.",
        summary=architect_result.final_output,
        decisions=["Use argparse.", "Keep arithmetic functions pure."],
        important_files=[doc.path for doc in matches],
        next_steps=["Create calculator.py.", "Create pytest coverage."],
        context_refs=[doc.path for doc in matches],
    )
    tester_state = protocol.transfer(
        from_agent=coder,
        to_agent=tester,
        task="Validate the calculator CLI implementation.",
        summary="Coder received context-aware handoff and implementation constraints.",
        decisions=coder_state.decisions,
        important_files=coder_state.important_files,
        next_steps=["Run pytest.", "Report failures with context references."],
        context_refs=coder_state.context_refs,
    )

    report = "\n".join(
        [
            "# Context Handoff Demo",
            "",
            "## Context Pack",
            "",
            context.to_markdown(),
            "",
            "## Coder Handoff",
            "",
            coder_state.to_json(),
            "",
            "## Tester Handoff",
            "",
            tester_state.to_json(),
            "",
        ]
    )
    report_path = REPORTS_DIR / "context_handoff_demo.md"
    report_path.write_text(report, encoding="utf-8")

    print(f"Context documents: {[doc.path for doc in matches]}")
    print(f"Coder context_refs: {coder_state.context_refs}")
    print(f"Tester context_refs: {tester_state.context_refs}")
    print(f"Report: {report_path}")


if __name__ == "__main__":
    main()
