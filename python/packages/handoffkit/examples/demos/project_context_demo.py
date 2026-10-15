"""Project context indexing and retrieval demo."""

from __future__ import annotations

from pathlib import Path

from handoffkit import ContextPack, ContextRetriever, ProjectIndexer

ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = ROOT / "examples" / "output" / "project_context_demo"
SAMPLE_PROJECT = OUTPUT_DIR / "sample_project"
REPORTS_DIR = ROOT / "reports"


def write_sample_project() -> None:
    """Create a tiny project for deterministic retrieval."""
    SAMPLE_PROJECT.mkdir(parents=True, exist_ok=True)
    (SAMPLE_PROJECT / "calculator.py").write_text(
        "\n".join(
            [
                "def add(a: int, b: int) -> int:",
                "    return a + b",
                "",
                "def divide(a: int, b: int) -> float:",
                "    if b == 0:",
                "        raise ValueError('division by zero')",
                "    return a / b",
            ]
        ),
        encoding="utf-8",
    )
    (SAMPLE_PROJECT / "README.md").write_text(
        "Calculator CLI\n\nUse argparse. Test add, subtract, multiply, and divide.",
        encoding="utf-8",
    )
    ignored = SAMPLE_PROJECT / "dist"
    ignored.mkdir(exist_ok=True)
    (ignored / "generated.txt").write_text("This file should not be indexed.", encoding="utf-8")


def main() -> None:
    """Index a sample project and write a context report."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    write_sample_project()

    documents = ProjectIndexer(str(SAMPLE_PROJECT)).index()
    retriever = ContextRetriever(documents)
    query = "argparse divide tests"
    matches = retriever.search(query, limit=3)
    pack = ContextPack(query=query, documents=matches)

    markdown_path = REPORTS_DIR / "project_context_demo.md"
    json_path = REPORTS_DIR / "project_context_demo.json"
    markdown_path.write_text(pack.to_markdown(), encoding="utf-8")
    json_path.write_text(pack.to_json(), encoding="utf-8")

    print(f"Documents indexed: {len(documents)}")
    print(f"Query: {query}")
    print(f"Matches: {[doc.path for doc in matches]}")
    print(f"Markdown report: {markdown_path}")
    print(f"JSON report: {json_path}")


if __name__ == "__main__":
    main()
