"""Recompute clinical-equivalence accuracy for a saved benchmark report."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from examples.mai_clinical_mimo_benchmark import _is_match  # noqa: E402
from handoffkit.benchmarks.mai import build_sequential_doctor_cases  # noqa: E402


def rescore_report(path: str | Path) -> dict[str, Any]:
    """Return rescored report summary without modifying the source file."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    case_count = int(data.get("case_count", len(data.get("rows", []))))
    cases = {case.case.case_id: case for case in build_sequential_doctor_cases(case_count)}
    rows = []
    for row in data.get("rows", []):
        case = cases.get(str(row.get("case_id", "")))
        if case is None:
            continue
        prediction = str(row.get("final_prediction") or row.get("prediction") or "")
        correct = _is_match(prediction, case.case.final_diagnosis, case.aliases)
        rows.append(
            {
                "case_id": case.case_id,
                "gold": case.case.final_diagnosis,
                "prediction": prediction,
                "correct": correct,
            }
        )
    correct_count = sum(1 for row in rows if row["correct"])
    return {
        "source_report": str(path),
        "case_count": len(rows),
        "correct": correct_count,
        "accuracy": round(correct_count / len(rows), 3) if rows else 0.0,
        "rows": rows,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("report")
    args = parser.parse_args()
    print(json.dumps(rescore_report(args.report), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
