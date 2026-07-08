"""Provider tool format matrix demo without external APIs."""

from __future__ import annotations

from pathlib import Path

from handoffkit import ProviderToolAdapter, tool, write_report_files

ROOT = Path(__file__).resolve().parents[1]
REPORTS_DIR = ROOT / "reports"


@tool
def add(a: int, b: int) -> int:
    """Add two integers."""
    return a + b


def main() -> None:
    """Write a matrix of supported provider tool formats."""
    formats = ["handoffkit", "openai", "anthropic"]
    matrix = {}
    for provider_format in formats:
        adapter = ProviderToolAdapter(provider_format=provider_format)
        matrix[provider_format] = {
            "adapter": adapter.to_dict(),
            "tools": adapter.tools_to_provider_format([add]),
        }
    report = {
        "success": True,
        "formats": formats,
        "matrix": matrix,
    }
    json_path, markdown_path = write_report_files(report, "provider_matrix_demo", REPORTS_DIR)

    print("Provider matrix success: True")
    print(f"Formats: {', '.join(formats)}")
    print(f"Markdown report: {markdown_path}")
    print(f"JSON report: {json_path}")


if __name__ == "__main__":
    main()
