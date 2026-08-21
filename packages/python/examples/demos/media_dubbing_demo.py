"""Offline screen-dubbing workflow demo.

This demo does not call OCR, ASR, TTS, or video APIs. It shows the agent
recipe, OCR+ASR consensus, and long-context producer prompt a real
Chinese-to-Spanish screen dub would use.
"""

from __future__ import annotations

from pathlib import Path

from handoffkit._cli.media import build_media_demo_report
from handoffkit.reports import write_report_files

ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = ROOT / "examples" / "output" / "media_dubbing_demo"
REPORTS_DIR = ROOT / "reports"


def build_demo_report():
    """Build a deterministic Chinese-to-Spanish screen-dubbing report."""
    return build_media_demo_report(OUTPUT_DIR)


def main() -> None:
    """Run the offline media dubbing demo and write reports."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    report = build_demo_report()
    json_path, markdown_path = write_report_files(report, "media_dubbing_demo", REPORTS_DIR)
    print("HandoffKit media dubbing demo")
    print(f"Pipeline: {report.metadata.get('pipeline_stages')}")
    print(f"Agent recipe: {report.metadata.get('agent_recipe')}")
    print(f"Segments: {len(report.transcript_segments)}")
    print(f"Speakers: {len(report.speakers)}")
    print(f"Output directory: {OUTPUT_DIR}")
    print(f"Markdown report: {markdown_path}")
    print(f"JSON report: {json_path}")


if __name__ == "__main__":
    main()
