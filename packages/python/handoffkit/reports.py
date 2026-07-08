"""Utilities for writing and loading HandoffKit reports."""

# ruff: noqa: E501

from __future__ import annotations

import json
from html import escape
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


def _report_to_dict(report: Any) -> dict[str, Any]:
    if hasattr(report, "to_dict"):
        payload = report.to_dict()
    elif isinstance(report, dict):
        payload = report
    else:
        payload = json.loads(_report_to_json(report))
    if not isinstance(payload, dict):
        raise ValueError("report must serialize to a JSON object")
    return payload


def _list_items(items: Any, *, empty: str = "None recorded.") -> str:
    if not isinstance(items, list) or not items:
        return f'<p class="empty">{escape(empty)}</p>'
    return "<ul>" + "".join(f"<li>{escape(str(item))}</li>" for item in items) + "</ul>"


def _file_items(items: Any) -> str:
    if not isinstance(items, list) or not items:
        return '<p class="empty">No files attached.</p>'
    return "".join(
        f'<div class="file-pill"><span class="file-icon"></span>{escape(str(item))}</div>'
        for item in items
    )


def _handoff_timeline(handoffs: Any) -> str:
    if not isinstance(handoffs, list) or not handoffs:
        return '<p class="empty">No handoffs found.</p>'
    rows: list[str] = []
    for index, handoff in enumerate(handoffs, start=1):
        if not isinstance(handoff, dict):
            continue
        from_agent = escape(str(handoff.get("from_agent", "Agent")))
        to_agent = escape(str(handoff.get("to_agent", "Next")))
        decisions = len(handoff.get("decisions", []) or [])
        files = len(handoff.get("important_files", []) or handoff.get("files", []) or [])
        errors = len(handoff.get("errors", []) or [])
        rows.append(
            '<div class="timeline-item">'
            f'<div class="timeline-index">{index}</div>'
            '<div>'
            f'<h3>{from_agent} <span>&rarr;</span> {to_agent}</h3>'
            f'<p>{decisions} decisions / {files} files / {errors} errors</p>'
            "</div>"
            "</div>"
        )
    return "".join(rows) or '<p class="empty">No handoffs found.</p>'


def render_report_html(report: Any) -> str:
    """Render a report object or dict as a polished standalone HTML document."""
    payload = _report_to_dict(report)
    title = str(payload.get("title") or payload.get("name") or "HandoffKit Report")
    command = str(payload.get("command") or "handoffkit report runs/latest")
    pain = str(payload.get("pain") or "Structured handoff report with replayable state transfer.")
    free_text = str(payload.get("free_text_summary") or "Free-text summaries lose decisions, files, risks, and next steps.")
    lost_context = payload.get("lost_context", [])
    preserved_context = payload.get("preserved_context", [])
    handoffs = payload.get("handoffs", [])
    replay = payload.get("replay", {})
    validation = payload.get("validation", {})
    quality = payload.get("quality", {})
    artifacts = payload.get("artifacts", {})

    score = quality.get("score", payload.get("score", 0.0))
    try:
        score_float = float(score)
    except (TypeError, ValueError):
        score_float = 0.0
    score_percent = max(0, min(100, round(score_float * 100)))
    grade = escape(str(quality.get("grade", "n/a")))
    validation_success = bool(validation.get("success", payload.get("success", False)))
    replay_steps = replay.get("step_count", "n/a") if isinstance(replay, dict) else "n/a"
    replay_handoffs = replay.get("handoff_count", "n/a") if isinstance(replay, dict) else "n/a"

    all_files: list[str] = []
    if isinstance(handoffs, list):
        for handoff in handoffs:
            if isinstance(handoff, dict):
                all_files.extend(handoff.get("important_files", []) or handoff.get("files", []) or [])
    if isinstance(artifacts, dict):
        all_files.extend(str(value) for value in artifacts.values())

    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{escape(title)}</title>
  <style>
    :root {{
      --bg: #f5f8fc;
      --surface: #ffffff;
      --ink: #0f172a;
      --muted: #5b6b83;
      --line: #dbe4f0;
      --blue: #2563eb;
      --cyan: #06b6d4;
      --green: #10b981;
      --amber: #f59e0b;
      --shadow: 0 24px 70px rgba(15, 23, 42, 0.10);
      --radius: 18px;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      color: var(--ink);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background:
        radial-gradient(circle at top left, rgba(37, 99, 235, 0.13), transparent 34rem),
        radial-gradient(circle at top right, rgba(16, 185, 129, 0.12), transparent 30rem),
        var(--bg);
      line-height: 1.55;
    }}
    .shell {{ max-width: 1180px; margin: 0 auto; padding: 32px 24px 56px; }}
    .hero {{
      position: relative;
      overflow: hidden;
      border: 1px solid rgba(148, 163, 184, 0.32);
      border-radius: 28px;
      padding: 34px;
      color: #f8fafc;
      background: linear-gradient(135deg, #07111f 0%, #101b33 54%, #073126 100%);
      box-shadow: var(--shadow);
    }}
    .hero::before {{
      content: "";
      position: absolute;
      inset: 0;
      background:
        linear-gradient(90deg, var(--blue), var(--cyan), var(--green), var(--amber));
      height: 5px;
    }}
    .eyebrow {{
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 13px;
      border: 1px solid rgba(125, 211, 252, 0.35);
      border-radius: 999px;
      color: #a5f3fc;
      background: rgba(8, 47, 73, 0.55);
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }}
    h1 {{ margin: 18px 0 10px; font-size: clamp(34px, 5vw, 56px); line-height: 1.02; letter-spacing: -0.04em; }}
    .hero p {{ max-width: 760px; margin: 0; color: #cbd5e1; font-size: 18px; }}
    .command {{
      margin-top: 26px;
      display: inline-flex;
      max-width: 100%;
      padding: 14px 18px;
      border-radius: 14px;
      background: rgba(2, 6, 23, 0.8);
      border: 1px solid rgba(148, 163, 184, 0.25);
      color: #d1fae5;
      font-family: "JetBrains Mono", Consolas, monospace;
      font-weight: 700;
      overflow-wrap: anywhere;
    }}
    .metrics {{ display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; margin: 22px 0; }}
    .metric {{
      background: rgba(255,255,255,0.82);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 18px;
      box-shadow: 0 12px 30px rgba(15, 23, 42, 0.05);
    }}
    .metric span {{ display: block; color: var(--muted); font-size: 12px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; }}
    .metric strong {{ display: block; margin-top: 6px; font-size: 28px; letter-spacing: -0.03em; }}
    .metric small {{ display: block; margin-top: 2px; color: var(--muted); font-weight: 800; }}
    .grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 22px; margin-top: 22px; }}
    .card {{
      background: rgba(255,255,255,0.92);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      box-shadow: 0 18px 55px rgba(15, 23, 42, 0.07);
      overflow: hidden;
    }}
    .card header {{
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 18px 20px;
      border-bottom: 1px solid var(--line);
      background: linear-gradient(180deg, #ffffff, #f8fafc);
    }}
    .card h2 {{ margin: 0; font-size: 15px; letter-spacing: 0.06em; text-transform: uppercase; }}
    .card-body {{ padding: 20px; }}
    .before {{ border-top: 4px solid #f43f5e; }}
    .after {{ border-top: 4px solid var(--green); }}
    blockquote {{
      margin: 0;
      padding: 18px;
      border-left: 4px solid #f43f5e;
      border-radius: 12px;
      background: #fff1f2;
      font-weight: 700;
    }}
    ul {{ margin: 0; padding: 0; list-style: none; }}
    li {{
      display: flex;
      gap: 10px;
      padding: 11px 0;
      border-bottom: 1px solid #eef2f7;
      font-weight: 650;
    }}
    li::before {{ content: ""; width: 8px; height: 8px; margin-top: 9px; border-radius: 50%; background: var(--green); flex: 0 0 auto; }}
    .before li::before {{ background: #f43f5e; }}
    .timeline-item {{
      display: grid;
      grid-template-columns: 42px 1fr;
      gap: 14px;
      padding: 14px;
      border: 1px solid #e6edf7;
      border-radius: 14px;
      background: #f8fafc;
      margin-bottom: 12px;
    }}
    .timeline-index {{
      width: 42px;
      height: 42px;
      display: grid;
      place-items: center;
      border-radius: 12px;
      color: #ffffff;
      font-weight: 900;
      background: linear-gradient(135deg, var(--blue), var(--cyan));
    }}
    .timeline-item h3 {{ margin: 0; font-size: 16px; }}
    .timeline-item h3 span {{ color: var(--blue); }}
    .timeline-item p {{ margin: 3px 0 0; color: var(--muted); font-family: "JetBrains Mono", Consolas, monospace; font-size: 13px; }}
    .files {{ display: grid; gap: 10px; }}
    .file-pill {{
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 13px 14px;
      border: 1px solid #dbeafe;
      border-radius: 12px;
      background: #f8fbff;
      font-family: "JetBrains Mono", Consolas, monospace;
      font-weight: 800;
      overflow-wrap: anywhere;
    }}
    .file-icon {{ width: 14px; height: 18px; border: 2px solid var(--blue); border-radius: 3px; flex: 0 0 auto; }}
    .status {{
      display: inline-flex;
      align-items: center;
      padding: 7px 12px;
      border-radius: 999px;
      background: #dcfce7;
      color: #047857;
      font-size: 12px;
      font-weight: 900;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }}
    .empty {{ margin: 0; color: var(--muted); }}
    footer {{ margin-top: 24px; color: var(--muted); font-size: 13px; text-align: center; }}
    @media (max-width: 860px) {{
      .shell {{ padding: 18px 14px 36px; }}
      .hero {{ padding: 24px; }}
      .metrics, .grid {{ grid-template-columns: 1fr; }}
    }}
  </style>
</head>
<body>
  <main class="shell">
    <section class="hero">
      <span class="eyebrow">HandoffKit report</span>
      <h1>{escape(title)}</h1>
      <p>{escape(pain)}</p>
      <div class="command">$ {escape(command)}</div>
    </section>

    <section class="metrics">
      <div class="metric"><span>Quality</span><strong>{score_percent}%</strong></div>
      <div class="metric"><span>Grade</span><strong>{grade}</strong></div>
      <div class="metric"><span>Validation</span><strong>{"Passed" if validation_success else "Review"}</strong></div>
      <div class="metric">
        <span>Replay</span>
        <strong>{escape(str(replay_steps))} steps</strong>
        <small>{escape(str(replay_handoffs))} handoffs</small>
      </div>
    </section>

    <section class="grid">
      <article class="card before">
        <header><h2>Context soup loses</h2></header>
        <div class="card-body">
          <blockquote>{escape(free_text)}</blockquote>
          <div style="height:16px"></div>
          {_list_items(lost_context)}
        </div>
      </article>
      <article class="card after">
        <header><h2>Contract handoff preserves</h2><span class="status">structured</span></header>
        <div class="card-body">{_list_items(preserved_context)}</div>
      </article>
    </section>

    <section class="grid">
      <article class="card">
        <header><h2>Handoff timeline</h2></header>
        <div class="card-body">{_handoff_timeline(handoffs)}</div>
      </article>
      <article class="card">
        <header><h2>Attached files and artifacts</h2></header>
        <div class="card-body files">{_file_items(all_files)}</div>
      </article>
    </section>

    <footer>Generated by HandoffKit. Offline by default, replayable, and safe to inspect.</footer>
  </main>
</body>
</html>
"""


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


def write_report_html(report: Any, path: str | Path) -> Path:
    """Write a polished standalone HTML report and return its path."""
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(render_report_html(report), encoding="utf-8")
    return target


def load_report_json(path: str | Path) -> dict[str, Any]:
    """Load a JSON report from disk."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("report JSON must decode to an object")
    return data
