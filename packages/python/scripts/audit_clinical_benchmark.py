"""Audit clinical benchmark reports for infra errors and rescue quality."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from examples.mai_clinical_mimo_benchmark import _is_match, _prediction_from_stage  # noqa: E402
from handoffkit.mai_benchmark import build_sequential_doctor_cases  # noqa: E402

RATE_LIMIT_MARKERS = ("429", "rate limit", "rate_limit", "too many requests")
CRITICAL_STAGES = {
    "Evidence Extractor",
    "Differential Builder",
    "Test Steward",
    "Specialist Consult Panel",
    "Adversarial Challenger",
    "Final Diagnostic Judge",
    "Diagnostic Label Normalizer",
}


def audit_report(path: str | Path) -> dict[str, Any]:
    """Compute benchmark quality metrics from a saved report."""
    report_path = Path(path)
    data = json.loads(report_path.read_text(encoding="utf-8"))
    rows = [row for row in data.get("rows", []) if isinstance(row, dict)]
    source_case_count = int(data.get("source_case_count", data.get("case_count", len(rows))))
    cases = {
        case.case.case_id: case
        for case in build_sequential_doctor_cases(source_case_count)
    }
    audited_rows = [_audit_row(row, cases) for row in rows]
    final_correct = sum(1 for row in audited_rows if row["final_correct"])
    base_correct = sum(1 for row in audited_rows if row["base_correct"])
    infra_rows = [row for row in audited_rows if row["infra_error"]]
    clean_rows = [row for row in audited_rows if not row["infra_error"]]
    attempted_rows = [row for row in audited_rows if row["rescue_attempted"]]
    corrected_by_rescue = [
        row for row in attempted_rows if not row["base_correct"] and row["final_correct"]
    ]
    harmful_rescues = [
        row for row in attempted_rows if row["base_correct"] and not row["final_correct"]
    ]
    normalizer_gain = sum(1 for row in audited_rows if row["normalizer_gain"])
    normalizer_loss = sum(1 for row in audited_rows if row["normalizer_loss"])
    result = {
        "source_report": str(report_path),
        "case_count": len(audited_rows),
        "global_correct": final_correct,
        "global_accuracy": _ratio(final_correct, len(audited_rows)),
        "clean_case_count": len(clean_rows),
        "clean_correct": sum(1 for row in clean_rows if row["final_correct"]),
        "clean_accuracy": _ratio(
            sum(1 for row in clean_rows if row["final_correct"]),
            len(clean_rows),
        ),
        "infra_error_count": len(infra_rows),
        "infra_error_rate": _ratio(len(infra_rows), len(audited_rows)),
        "rate_limit_count": sum(1 for row in audited_rows if row["rate_limit_error"]),
        "empty_stage_count": sum(1 for row in audited_rows if row["empty_stage_error"]),
        "base_correct": base_correct,
        "base_accuracy": _ratio(base_correct, len(audited_rows)),
        "rescue_attempted": len(attempted_rows),
        "rescue_gain": final_correct - base_correct,
        "rescue_precision": _ratio(len(corrected_by_rescue), len(attempted_rows)),
        "harmful_rescue_count": len(harmful_rescues),
        "harmful_rescue_rate": _ratio(len(harmful_rescues), len(attempted_rows)),
        "label_normalization_gain": normalizer_gain,
        "label_normalization_loss": normalizer_loss,
        "rows": audited_rows,
    }
    return result


def aggregate_audits(paths: list[str | Path]) -> dict[str, Any]:
    """Aggregate metrics across multiple clinical benchmark reports."""
    audits = [audit_report(path) for path in paths]
    rows = [row for audit in audits for row in audit["rows"]]
    final_correct = sum(1 for row in rows if row["final_correct"])
    base_correct = sum(1 for row in rows if row["base_correct"])
    infra_rows = [row for row in rows if row["infra_error"]]
    clean_rows = [row for row in rows if not row["infra_error"]]
    attempted_rows = [row for row in rows if row["rescue_attempted"]]
    corrected_by_rescue = [
        row for row in attempted_rows if not row["base_correct"] and row["final_correct"]
    ]
    harmful_rescues = [
        row for row in attempted_rows if row["base_correct"] and not row["final_correct"]
    ]
    return {
        "source_reports": [str(Path(path)) for path in paths],
        "case_count": len(rows),
        "global_correct": final_correct,
        "global_accuracy": _ratio(final_correct, len(rows)),
        "clean_case_count": len(clean_rows),
        "clean_correct": sum(1 for row in clean_rows if row["final_correct"]),
        "clean_accuracy": _ratio(
            sum(1 for row in clean_rows if row["final_correct"]),
            len(clean_rows),
        ),
        "infra_error_count": len(infra_rows),
        "infra_error_rate": _ratio(len(infra_rows), len(rows)),
        "rate_limit_count": sum(1 for row in rows if row["rate_limit_error"]),
        "empty_stage_count": sum(1 for row in rows if row["empty_stage_error"]),
        "base_correct": base_correct,
        "base_accuracy": _ratio(base_correct, len(rows)),
        "rescue_attempted": len(attempted_rows),
        "rescue_gain": final_correct - base_correct,
        "rescue_precision": _ratio(len(corrected_by_rescue), len(attempted_rows)),
        "harmful_rescue_count": len(harmful_rescues),
        "harmful_rescue_rate": _ratio(len(harmful_rescues), len(attempted_rows)),
        "label_normalization_gain": sum(1 for row in rows if row["normalizer_gain"]),
        "label_normalization_loss": sum(1 for row in rows if row["normalizer_loss"]),
        "rows": rows,
    }


def audit_to_markdown(audit: dict[str, Any]) -> str:
    """Render audit as Markdown."""
    infra_rows = "\n".join(
        "| {case_id} | {rate} | {empty} | {stages} |".format(
            case_id=row["case_id"],
            rate=row["rate_limit_error"],
            empty=row["empty_stage_error"],
            stages=", ".join(row["infra_stages"]),
        )
        for row in audit["rows"]
        if row["infra_error"]
    )
    return (
        "# Clinical Benchmark Audit\n\n"
        f"- Source: `{audit.get('source_report', 'aggregate')}`\n"
        f"- Source reports: `{len(audit.get('source_reports', []))}`\n"
        f"- Global accuracy: `{audit['global_correct']}/{audit['case_count']}` "
        f"= `{audit['global_accuracy']:.3f}`\n"
        f"- Clean accuracy: `{audit['clean_correct']}/{audit['clean_case_count']}` "
        f"= `{audit['clean_accuracy']:.3f}`\n"
        f"- Infra errors: `{audit['infra_error_count']}` "
        f"= `{audit['infra_error_rate']:.3f}`\n"
        f"- Rate-limit cases: `{audit['rate_limit_count']}`\n"
        f"- Empty-stage cases: `{audit['empty_stage_count']}`\n"
        f"- Base accuracy: `{audit['base_correct']}/{audit['case_count']}` "
        f"= `{audit['base_accuracy']:.3f}`\n"
        f"- Rescue gain: `{audit['rescue_gain']}`\n"
        f"- Rescue precision: `{audit['rescue_precision']:.3f}`\n"
        f"- Harmful rescue rate: `{audit['harmful_rescue_rate']:.3f}` "
        f"({audit['harmful_rescue_count']} cases)\n"
        f"- Label normalization gain/loss: "
        f"`+{audit['label_normalization_gain']}/-{audit['label_normalization_loss']}`\n\n"
        "## Infra Error Cases\n\n"
        "| Case | Rate Limit | Empty Stage | Stages |\n"
        "| --- | --- | --- | --- |\n"
        f"{infra_rows or '| none | false | false | none |'}\n"
    )


def _audit_row(row: dict[str, Any], cases: dict[str, Any]) -> dict[str, Any]:
    case_id = str(row.get("case_id", ""))
    case = cases.get(case_id)
    gold = str(row.get("gold") or (case.case.final_diagnosis if case else ""))
    aliases = case.aliases if case else []
    base_prediction = str(row.get("prediction", ""))
    final_prediction = _best_final_prediction(row)
    base_correct = bool(row.get("correct"))
    final_correct = bool(row.get("final_correct", row.get("correct")))
    if case is not None:
        base_correct = _is_match(base_prediction, gold, aliases)
        final_correct = _is_match(final_prediction, gold, aliases)
    infra = _infra_from_stages(row.get("stages", []))
    judge_correct, normalizer_correct = _normalizer_effect(row, gold, aliases)
    return {
        "case_id": case_id,
        "gold": gold,
        "base_prediction": base_prediction,
        "final_prediction": final_prediction,
        "base_correct": base_correct,
        "final_correct": final_correct,
        "rescue_attempted": bool(
            row.get("rescue_attempted")
            or row.get("ensemble_attempted")
            or row.get("targeted_attempted")
        ),
        "infra_error": infra["infra_error"],
        "rate_limit_error": infra["rate_limit_error"],
        "empty_stage_error": infra["empty_stage_error"],
        "infra_stages": infra["infra_stages"],
        "normalizer_gain": judge_correct is False and normalizer_correct is True,
        "normalizer_loss": judge_correct is True and normalizer_correct is False,
    }


def _infra_from_stages(stages: Any) -> dict[str, Any]:
    infra_stages: list[str] = []
    rate_limit = False
    empty_stage = False
    if not isinstance(stages, list):
        return {
            "infra_error": False,
            "rate_limit_error": False,
            "empty_stage_error": False,
            "infra_stages": [],
        }
    for stage in stages:
        if not isinstance(stage, dict):
            continue
        name = str(stage.get("stage", "unknown"))
        error = str(stage.get("error", ""))
        raw = str(stage.get("raw", ""))
        parsed = stage.get("parsed")
        text = f"{error} {raw}".lower()
        has_rate = any(marker in text for marker in RATE_LIMIT_MARKERS)
        is_empty = name in CRITICAL_STAGES and not error and not raw.strip() and not parsed
        has_error = bool(error.strip()) or has_rate or is_empty
        if has_error:
            infra_stages.append(name)
        rate_limit = rate_limit or has_rate
        empty_stage = empty_stage or is_empty
    return {
        "infra_error": bool(infra_stages),
        "rate_limit_error": rate_limit,
        "empty_stage_error": empty_stage,
        "infra_stages": infra_stages,
    }


def _best_final_prediction(row: dict[str, Any]) -> str:
    for key in (
        "targeted_prediction",
        "final_prediction",
        "rescue_prediction",
        "prediction",
    ):
        value = row.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _normalizer_effect(
    row: dict[str, Any],
    gold: str,
    aliases: list[str],
) -> tuple[bool | None, bool | None]:
    stages = row.get("stages", [])
    if not isinstance(stages, list):
        return None, None
    judge = next(
        (
            stage
            for stage in stages
            if isinstance(stage, dict) and stage.get("stage") == "Final Diagnostic Judge"
        ),
        None,
    )
    normalizer = next(
        (
            stage
            for stage in stages
            if isinstance(stage, dict) and stage.get("stage") == "Diagnostic Label Normalizer"
        ),
        None,
    )
    if judge is None or normalizer is None:
        return None, None
    judge_prediction = _prediction_from_stage(judge)
    normalizer_prediction = _prediction_from_stage(normalizer)
    return (
        _is_match(judge_prediction, gold, aliases),
        _is_match(normalizer_prediction, gold, aliases),
    )


def _ratio(numerator: int, denominator: int) -> float:
    return round(numerator / denominator, 3) if denominator else 0.0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("report", nargs="+")
    parser.add_argument("--aggregate", action="store_true")
    parser.add_argument("--output-dir", default="reports")
    args = parser.parse_args()
    audit = aggregate_audits(args.report) if args.aggregate else audit_report(args.report[0])
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    stem = (
        "clinical_benchmark_aggregate_audit"
        if args.aggregate
        else Path(args.report[0]).stem + "_audit"
    )
    json_path = output_dir / f"{stem}.json"
    md_path = output_dir / f"{stem}.md"
    json_path.write_text(json.dumps(audit, ensure_ascii=False, indent=2), encoding="utf-8")
    md_path.write_text(audit_to_markdown(audit), encoding="utf-8")
    print(audit_to_markdown(audit))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
