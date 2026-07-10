"""
Heuristic quality metrics for localization memories.

These scores are intentionally **heuristic** (rule-based), not an LLM judge:
transparent, cheap, and stable for dashboards. They do **not** measure literary
quality or native fluency.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

# Weights for the composite heuristic (must sum to 1.0 for documentation clarity)
WEIGHTS = {
    "coverage": 0.35,  # how much of catalog is translated
    "freshness": 0.25,  # not left identical to English
    "hygiene": 0.20,  # no broken \\n, empty, etc.
    "brevity": 0.10,  # not extremely longer than source
    "speakers": 0.10,  # speaker prefix consistency when glossary known
}


def compute_heuristic_quality(
    catalog: list[dict[str, Any]],
    memory: dict[str, str],
    *,
    lang: str = "es",
    glossary_speakers: dict[str, dict[str, str]] | None = None,
) -> dict[str, Any]:
    """
    Return a detailed heuristic report + score 0–100.

    Components (each 0–1, then weighted):
      coverage  = translated / playerish_catalog
      freshness = 1 - identical/translated
      hygiene   = 1 - (empty + backslash_n)/translated
      brevity   = 1 - too_long/translated
      speakers  = 1 - speaker_mismatch/speaker_total (or 1 if none)
    """
    playerish = 0
    translated = 0
    identical = 0
    empty = 0
    missing = 0
    backslash_n = 0
    too_long = 0
    speaker_total = 0
    speaker_mismatch = 0

    for row in catalog:
        en = row.get("text") or ""
        sid = row.get("id") or ""
        if not re.search(r"[A-Za-z\u00C0-\u024F\u0900-\u097F\u3400-\u9fff]", en):
            continue
        playerish += 1
        if sid not in memory:
            missing += 1
            continue
        tr = memory[sid]
        if not (tr or "").strip():
            empty += 1
            continue
        translated += 1
        if tr == en:
            identical += 1
        if "\\n" in tr:
            backslash_n += 1
        if len(en) > 0 and len(tr) > len(en) * 1.6 and len(tr) > 48:
            too_long += 1
        m = re.match(r"^([A-Za-z][A-Za-z0-9 \-]{0,30}):\s*", en)
        if m and glossary_speakers:
            speaker_total += 1
            sp = glossary_speakers.get(m.group(1).strip()) or {}
            pref = sp.get(lang)
            if pref and not (
                tr.startswith(pref + ":") or tr.startswith(m.group(1) + ":")
            ):
                speaker_mismatch += 1

    def ratio_ok(good: float, total: float) -> float:
        if total <= 0:
            return 1.0
        return max(0.0, min(1.0, good / total))

    coverage = ratio_ok(translated, playerish) if playerish else 0.0
    freshness = ratio_ok(translated - identical, translated) if translated else 0.0
    hygiene = (
        ratio_ok(translated - empty - backslash_n, translated) if translated else 0.0
    )
    brevity = ratio_ok(translated - too_long, translated) if translated else 0.0
    speakers = (
        ratio_ok(speaker_total - speaker_mismatch, speaker_total)
        if speaker_total
        else 1.0
    )

    components = {
        "coverage": round(coverage, 4),
        "freshness": round(freshness, 4),
        "hygiene": round(hygiene, 4),
        "brevity": round(brevity, 4),
        "speakers": round(speakers, 4),
    }
    score = 100.0 * sum(components[k] * WEIGHTS[k] for k in WEIGHTS)

    return {
        "method": "heuristic_v2",
        "method_note": (
            "Rule-based composite; not an LLM judge. "
            "Weights: " + ", ".join(f"{k}={v}" for k, v in WEIGHTS.items())
        ),
        "lang": lang,
        "score_0_100": round(score, 1),
        "components": components,
        "weights": WEIGHTS,
        "counts": {
            "playerish_catalog": playerish,
            "translated": translated,
            "missing": missing,
            "empty": empty,
            "identical_to_en": identical,
            "literal_backslash_n": backslash_n,
            "too_long_vs_en": too_long,
            "speaker_total": speaker_total,
            "speaker_mismatch": speaker_mismatch,
        },
    }


def write_quality_report(report: dict[str, Any], out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    lang = report.get("lang", "xx")
    path = out_dir / f"quality_{lang}.json"
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    md = out_dir / f"quality_{lang}.md"
    c = report.get("components") or {}
    counts = report.get("counts") or {}
    md.write_text(
        "\n".join(
            [
                f"# Heuristic quality — {lang}",
                "",
                f"**Score: {report.get('score_0_100')}/100** (`{report.get('method')}`)",
                "",
                report.get("method_note", ""),
                "",
                "## Components (0–1)",
                *[f"- {k}: {v}" for k, v in c.items()],
                "",
                "## Counts",
                *[f"- {k}: {v}" for k, v in counts.items()],
                "",
            ]
        ),
        encoding="utf-8",
    )
    return path
