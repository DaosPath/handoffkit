"""Coding review recipe built on top of HandoffKit primitives."""

from __future__ import annotations

from pathlib import Path

from handoffkit import ContextPack, ContextRetriever, ProjectIndexer, RecipeRunner
from handoffkit.builtins import coding_review_recipe

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "examples" / "output" / "coding_review_recipe"
SAMPLE_PROJECT = OUTPUT_DIR / "sample_project"
REPORTS_DIR = ROOT / "reports"


def write_sample_files() -> None:
    """Create local files for deterministic review."""
    SAMPLE_PROJECT.mkdir(parents=True, exist_ok=True)
    (SAMPLE_PROJECT / "calculator.py").write_text(
        "\n".join(
            [
                "def divide(a: int, b: int) -> float:",
                "    if b == 0:",
                "        raise ValueError('division by zero')",
                "    return a / b",
            ]
        ),
        encoding="utf-8",
    )
    (SAMPLE_PROJECT / "test_calculator.py").write_text(
        "\n".join(
            [
                "from calculator import divide",
                "",
                "def test_divide():",
                "    assert divide(6, 3) == 2",
            ]
        ),
        encoding="utf-8",
    )


def main() -> None:
    """Run the coding review recipe over local indexed files."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    write_sample_files()

    documents = ProjectIndexer(str(SAMPLE_PROJECT)).index()
    matches = ContextRetriever(documents).search("divide calculator tests", limit=5)
    context = ContextPack(
        query="Review calculator divide behavior and tests.",
        documents=matches,
        summary="Local sample files for a coding review recipe.",
    )
    result = RecipeRunner(coding_review_recipe()).run(
        initial_task="Review the local calculator code.",
        context=context,
    )

    markdown_path = REPORTS_DIR / "coding_review_recipe.md"
    json_path = REPORTS_DIR / "coding_review_recipe.json"
    markdown_path.write_text(result.to_markdown(), encoding="utf-8")
    json_path.write_text(result.to_json(), encoding="utf-8")

    print(f"Recipe: {result.recipe_name}")
    print(f"Success: {result.success}")
    print(f"Context docs: {[doc.path for doc in matches]}")
    print(f"Markdown report: {markdown_path}")
    print(f"JSON report: {json_path}")


if __name__ == "__main__":
    main()
