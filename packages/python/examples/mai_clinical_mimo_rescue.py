"""Second-pass rescue for failed clinical MAI-style MiMo benchmark cases."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from examples.mai_clinical_mimo_benchmark import _is_match  # noqa: E402
from handoffkit.benchmarks.mai import (  # noqa: E402
    SequentialDoctorCase,
    build_sequential_doctor_cases,
)
from handoffkit.providers import OpenCodeGoProvider  # noqa: E402


def _extract_json_object(text: str) -> dict[str, Any]:
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = re.sub(r"^```(?:json)?", "", stripped, flags=re.I).strip()
        stripped = re.sub(r"```$", "", stripped).strip()
    start = stripped.find("{")
    end = stripped.rfind("}")
    if start >= 0 and end > start:
        stripped = stripped[start : end + 1]
    try:
        value = json.loads(stripped)
    except json.JSONDecodeError:
        return {}
    return value if isinstance(value, dict) else {}


def _prediction(value: str, parsed: dict[str, Any]) -> str:
    for key in ("rescue_diagnosis", "normalized_diagnosis", "final_diagnosis", "diagnosis"):
        item = parsed.get(key)
        if isinstance(item, str) and item.strip():
            return item.strip()
    match = re.search(r"(?:diagnosis|rescue_diagnosis)\s*[:=]\s*\"?([^\"\n,}]+)", value, re.I)
    if match:
        return match.group(1).strip()
    return value.strip().splitlines()[0][:180] if value.strip() else ""


def _rescue_prompt(case: SequentialDoctorCase, row: dict[str, Any]) -> str:
    stages = [
        {
            "stage": stage.get("stage"),
            "parsed": stage.get("parsed"),
        }
        for stage in row.get("stages", [])
    ]
    return f"""Return strict JSON only. No markdown. No prose outside JSON.
Educational benchmark only. Not medical advice.

You are a second-pass diagnostic rescue board. The first panel may have made one
of these mistakes:
- chose a broad parent disease instead of a specific syndrome/subtype,
- chose a secondary complication instead of the primary diagnosis,
- missed drug/toxin causality,
- ignored pathology or special-test clues,
- over-weighted a common diagnosis over a rare but specific diagnosis.

Do not use the known gold label; it is not provided. Choose one most specific
diagnosis supported by the case evidence.

JSON schema:
{{"summary": str, "first_prediction_error": str, "rescue_diagnosis": str,
"confidence": str, "evidence_for": [str], "evidence_against": [str],
"close_mimics": [str]}}

Case:
Opening: {case.opening}
History: {case.sections.get("history", "")}
Physical exam: {case.sections.get("physical_exam", "")}
Basic labs: {case.sections.get("basic_labs", "")}
Imaging: {case.sections.get("imaging", "")}
Pathology: {case.sections.get("pathology", "")}
Special tests: {case.sections.get("special_tests", "")}

First final prediction:
{row.get("prediction", "")}

Prior panel structured outputs:
{json.dumps(stages, ensure_ascii=False)[:24000]}
"""


def run_rescue(
    *,
    report_path: str | Path,
    model: str,
    max_tokens: int,
    timeout: float,
) -> dict[str, Any]:
    source = json.loads(Path(report_path).read_text(encoding="utf-8"))
    case_count = int(source.get("case_count", len(source.get("rows", []))))
    cases = {case.case.case_id: case for case in build_sequential_doctor_cases(case_count)}
    provider = OpenCodeGoProvider(model=model, timeout=timeout)
    rows = []
    started = time.time()
    for row in source.get("rows", []):
        case = cases.get(row.get("case_id", ""))
        if case is None:
            continue
        if row.get("correct") is True:
            rows.append({**row, "rescue_attempted": False, "final_correct": True})
            continue
        t0 = time.time()
        error = ""
        raw = ""
        try:
            raw = provider.generate(
                _rescue_prompt(case, row),
                temperature=0,
                max_tokens=max_tokens,
            )
        except Exception as exc:  # pragma: no cover - real provider path
            error = str(exc)
        parsed = _extract_json_object(raw)
        rescue_prediction = _prediction(raw, parsed)
        rescue_correct = _is_match(rescue_prediction, case.case.final_diagnosis, case.aliases)
        merged = {
            **row,
            "rescue_attempted": True,
            "rescue_prediction": rescue_prediction,
            "rescue_correct": rescue_correct,
            "final_prediction": (
                rescue_prediction if rescue_prediction else row.get("prediction", "")
            ),
            "final_correct": rescue_correct,
            "rescue_seconds": round(time.time() - t0, 2),
            "rescue_error": error[:400],
            "rescue_raw_len": len(raw),
            "rescue_parsed": parsed,
        }
        rows.append(merged)
        status = "OK" if rescue_correct else "MISS"
        print(
            f"{row.get('case_id')}: {status} | rescue={rescue_prediction!r} | "
            f"gold={case.case.final_diagnosis!r} | {merged['rescue_seconds']}s"
        )
    base_correct = sum(1 for row in source.get("rows", []) if row.get("correct") is True)
    final_correct = sum(1 for row in rows if row.get("final_correct") is True)
    report = {
        "name": f"OpenCode MiMo Clinical MAI-style Second-pass Rescue {case_count}",
        "model": model,
        "max_tokens": max_tokens,
        "case_count": case_count,
        "base_correct": base_correct,
        "final_correct": final_correct,
        "rescued": final_correct - base_correct,
        "base_accuracy": round(base_correct / case_count, 3) if case_count else 0.0,
        "final_accuracy": round(final_correct / case_count, 3) if case_count else 0.0,
        "seconds": round(time.time() - started, 2),
        "rows": rows,
        "source_report": str(report_path),
    }
    name = f"opencode_mimo_clinical_mai_{case_count}_rescue"
    reports_dir = Path("reports")
    reports_dir.mkdir(exist_ok=True)
    json_path = reports_dir / f"{name}.json"
    md_path = reports_dir / f"{name}.md"
    json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    md_path.write_text(_to_markdown(report), encoding="utf-8")
    return report


def _to_markdown(report: dict[str, Any]) -> str:
    rows = "\n".join(
        "| {case_id} | {gold} | {prediction} | {rescue} | {ok} |".format(
            case_id=row.get("case_id", ""),
            gold=str(row.get("gold", "")).replace("|", "/"),
            prediction=str(row.get("prediction", "")).replace("|", "/"),
            rescue=str(row.get("rescue_prediction", "")).replace("|", "/"),
            ok=row.get("final_correct"),
        )
        for row in report["rows"]
        if row.get("rescue_attempted")
    )
    return (
        f"# {report['name']}\n\n"
        "Educational benchmark only. Not medical advice.\n\n"
        "## Summary\n\n"
        f"- Model: `{report['model']}`\n"
        f"- Base correct: `{report['base_correct']}/{report['case_count']}`\n"
        f"- Base accuracy: `{report['base_accuracy']:.3f}`\n"
        f"- Final correct: `{report['final_correct']}/{report['case_count']}`\n"
        f"- Final accuracy: `{report['final_accuracy']:.3f}`\n"
        f"- Rescued: `{report['rescued']}`\n"
        f"- Seconds: `{report['seconds']}`\n\n"
        "## Rescued Attempts\n\n"
        "| Case | Gold | First Prediction | Rescue Prediction | Final Correct |\n"
        "| --- | --- | --- | --- | --- |\n"
        f"{rows}\n"
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--report",
        default="reports/opencode_mimo_clinical_mai_30.json",
        help="Source clinical MAI-style report JSON.",
    )
    parser.add_argument("--model", default=os.getenv("OPENCODE_GO_MODEL", "mimo-v2.5"))
    parser.add_argument("--max-tokens", type=int, default=32768)
    parser.add_argument("--timeout", type=float, default=300.0)
    args = parser.parse_args()
    if not os.getenv("OPENCODE_API_KEY"):
        raise SystemExit("OPENCODE_API_KEY is required.")
    report = run_rescue(
        report_path=args.report,
        model=args.model,
        max_tokens=args.max_tokens,
        timeout=args.timeout,
    )
    print(_to_markdown(report))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
