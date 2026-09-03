"""Structured memory demo."""

from __future__ import annotations

from pathlib import Path

from handoffkit import JsonMemoryStore, MemoryReport

ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = ROOT / "examples" / "output" / "memory_demo"
REPORTS_DIR = ROOT / "reports"


def main() -> None:
    """Create, search, and report structured memories."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)

    store = JsonMemoryStore(str(OUTPUT_DIR / "memory.json"))
    store.clear()
    stored = [
        store.add(
            "Calculator CLI should use argparse and pure functions.",
            kind="decision",
            tags=["calculator", "cli"],
        ),
        store.add(
            "Tester agent must verify divide-by-zero behavior.",
            kind="test-note",
            tags=["calculator", "tests"],
        ),
    ]

    query = "calculator cli tests"
    matches = store.search(query, limit=5)
    report = MemoryReport(
        memories_stored=stored,
        searches_executed=[query],
        final_result=f"Found {len(matches)} relevant memories.",
    )

    markdown_path = REPORTS_DIR / "memory_demo.md"
    json_path = REPORTS_DIR / "memory_demo.json"
    markdown_path.write_text(report.to_markdown(), encoding="utf-8")
    json_path.write_text(report.to_json(), encoding="utf-8")

    print(f"Memories stored: {len(stored)}")
    print(f"Search query: {query}")
    print(f"Matches: {[item.kind for item in matches]}")
    print(f"Markdown report: {markdown_path}")
    print(f"JSON report: {json_path}")


if __name__ == "__main__":
    main()
