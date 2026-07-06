"""Build a curated 100-case fixture from MedCaseReasoning.

The generated fixture is deterministic and uses the public test split only.
"""

from __future__ import annotations

import csv
import json
import re
import urllib.request
from pathlib import Path

SOURCE_URL = (
    "https://huggingface.co/datasets/zou-lab/MedCaseReasoning/resolve/main/"
    "medcasereasoning_core.csv"
)
OUTPUT = Path("handoffkit/doctor_cases_100.py")


def _word_count(value: str) -> int:
    return len(re.findall(r"\w+", value))


def _diagnosis_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def _valid(row: dict[str, str]) -> bool:
    diagnosis = row.get("final_diagnosis", "").strip()
    prompt = row.get("case_prompt", "").strip()
    reasoning = row.get("diagnostic_reasoning", "").strip()
    pmcid = row.get("pmcid", "").strip()
    return (
        row.get("split") == "test"
        and pmcid.startswith("PMC")
        and len(diagnosis) >= 4
        and _word_count(prompt) >= 90
        and _word_count(reasoning) >= 20
        and "unknown" not in diagnosis.lower()
    )


def build(limit: int = 100) -> list[dict[str, str]]:
    request = urllib.request.Request(
        SOURCE_URL,
        headers={"User-Agent": "handoffkit/1.3 fixture-builder"},
    )
    selected: list[dict[str, str]] = []
    seen: set[str] = set()
    with urllib.request.urlopen(request, timeout=120) as response:
        text = (line.decode("utf-8", errors="replace") for line in response)
        reader = csv.DictReader(text)
        for index, row in enumerate(reader):
            if not _valid(row):
                continue
            key = _diagnosis_key(row["final_diagnosis"])
            if key in seen:
                continue
            seen.add(key)
            selected.append(
                {
                    "case_id": f"medcase100-{len(selected):04d}",
                    "pmcid": row["pmcid"].strip(),
                    "title": row["title"].strip(),
                    "journal": row["journal"].strip(),
                    "article_link": row["article_link"].strip(),
                    "publication_date": row["publication_date"].strip(),
                    "case_prompt": row["case_prompt"].strip(),
                    "diagnostic_reasoning": row["diagnostic_reasoning"].strip(),
                    "final_diagnosis": row["final_diagnosis"].strip(),
                    "source_row": str(index),
                }
            )
            if len(selected) >= limit:
                break
    if len(selected) < limit:
        raise RuntimeError(f"Only selected {len(selected)} valid cases.")
    return selected


def write_fixture(cases: list[dict[str, str]]) -> None:
    OUTPUT.write_text(
        "# ruff: noqa: E501\n"
        '"""One hundred curated real open-access diagnostic cases.\n\n'
        "Source: zou-lab/MedCaseReasoning public test split on Hugging Face.\n"
        "Derived from PMC Open Access case reports. Dataset card lists MIT license.\n"
        'This fixture is for educational benchmark demos, not medical advice.\n'
        '"""\n\n'
        "from __future__ import annotations\n\n"
        f"DOCTOR_CASES_100 = {json.dumps(cases, ensure_ascii=False, indent=2)}\n",
        encoding="utf-8",
    )


def main() -> int:
    cases = build(100)
    write_fixture(cases)
    print(f"Wrote {len(cases)} cases to {OUTPUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
