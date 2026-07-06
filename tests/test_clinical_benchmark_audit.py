from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.audit_clinical_benchmark import audit_report  # noqa: E402


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
