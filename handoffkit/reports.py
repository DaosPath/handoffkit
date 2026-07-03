"""Utilities for writing and loading HandoffKit reports."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def _json_default(value: Any) -> Any:
    """Return readable JSON fallback for non-serializable values."""
    if hasattr(value, "to_dict"):
        return value.to_dict()
    return str(value)


def _report_to_json(report: Any) -> str:
    if hasattr(report, "to_json"):
        return str(report.to_json())
    if hasattr(report, "to_dict"):
        return json.dumps(report.to_dict(), ensure_ascii=False, indent=2, default=_json_default)
    if isinstance(report, dict):
        return json.dumps(report, ensure_ascii=False, indent=2, default=_json_default)
    raise TypeError("report must provide to_json(), to_dict(), or be a dictionary")


def _report_to_markdown(report: Any) -> str:
    if hasattr(report, "to_markdown"):
        return str(report.to_markdown())
    if hasattr(report, "to_dict"):
        payload = report.to_dict()
    elif isinstance(report, dict):
        payload = report
    else:
        raise TypeError("report must provide to_markdown(), to_dict(), or be a dictionary")
    return f"# Report\n\n```json\n{json.dumps(payload, indent=2, default=_json_default)}\n```\n"


def write_report_files(
    report: Any,
    name: str,
    output_dir: str | Path = "reports",
) -> tuple[Path, Path]:
    """Write JSON and Markdown report files and return their paths."""
    target = Path(output_dir)
    target.mkdir(parents=True, exist_ok=True)
    safe_name = name.removesuffix(".json").removesuffix(".md")
    json_path = target / f"{safe_name}.json"
    markdown_path = target / f"{safe_name}.md"
    json_path.write_text(_report_to_json(report), encoding="utf-8")
    markdown_path.write_text(_report_to_markdown(report), encoding="utf-8")
    return json_path, markdown_path


def load_report_json(path: str | Path) -> dict[str, Any]:
    """Load a JSON report from disk."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("report JSON must decode to an object")
    return data
