from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.audit_clinical_benchmark import aggregate_audits, audit_report  # noqa: E402


def test_audit_report_separates_infra_and_rescue_metrics(tmp_path: Path) -> None:
    report = {
        "case_count": 1,
        "rows": [
            {
                "case_id": "medcase-1",
                "gold": "Condition A",
                "prediction": "Condition B",
                "correct": False,
                "final_prediction": "Condition A",
                "final_correct": True,
                "targeted_attempted": True,
                "stages": [
                    {
                        "stage": "Evidence Extractor",
                        "error": "HTTP 429 rate limit exceeded",
                        "raw": "",
                        "parsed": {},
                    }
                ],
            }
        ],
    }
    path = tmp_path / "report.json"
    path.write_text(json.dumps(report), encoding="utf-8")

    audit = audit_report(path)

    assert audit["global_accuracy"] == 1.0
    assert audit["clean_case_count"] == 0
    assert audit["infra_error_count"] == 1
    assert audit["rate_limit_count"] == 1
    assert audit["rescue_gain"] == 1
    assert audit["rescue_precision"] == 1.0


def test_aggregate_audits_combines_multiple_shards(tmp_path: Path) -> None:
    report_a = {
        "case_count": 1,
        "rows": [{"case_id": "a", "gold": "A", "prediction": "A", "correct": True}],
    }
    report_b = {
        "case_count": 1,
        "rows": [{"case_id": "b", "gold": "B", "prediction": "C", "correct": False}],
    }
    path_a = tmp_path / "a.json"
    path_b = tmp_path / "b.json"
    path_a.write_text(json.dumps(report_a), encoding="utf-8")
    path_b.write_text(json.dumps(report_b), encoding="utf-8")

    audit = aggregate_audits([path_a, path_b])

    assert audit["case_count"] == 2
    assert audit["global_correct"] == 1
    assert audit["global_accuracy"] == 0.5
    assert len(audit["source_reports"]) == 2
