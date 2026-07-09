"""MAI-style ensemble rescue benchmark with controlled medical retrieval.

Educational benchmark only. Uses public case-report fixtures and public lookup
APIs. This is not medical advice and is not for patient care.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from examples.mai_clinical_mimo_benchmark import (  # noqa: E402
    SAFETY_NOTE,
    _extract_json_object,
    _is_match,
)
from handoffkit.benchmarks.mai import (  # noqa: E402
    SequentialDoctorCase,
    build_sequential_doctor_cases,
)
from handoffkit.providers import OpenCodeGoProvider  # noqa: E402
from handoffkit.tools.medical import (  # noqa: E402
    clinical_trials_search,
    dailymed_drug_search,
    pmc_search,
    pubmed_search,
)

DEFAULT_MODELS = ("mimo-v2.5", "deepseek-v4-flash", "glm-5.2")
DEFAULT_MAX_TOKENS = 32768
STOPWORDS = {
    "about",
    "after",
    "because",
    "before",
    "being",
    "blood",
    "case",
    "clinical",
    "diagnosis",
    "disease",
    "during",
    "found",
    "from",
    "have",
    "patient",
    "patients",
    "presented",
    "showed",
    "that",
    "their",
    "there",
    "these",
    "this",
    "with",
    "were",
}
DRUG_HINTS = {
    "aspirin",
    "carbamazepine",
    "ceftriaxone",
    "ciprofloxacin",
    "doxycycline",
    "glyburide",
    "ibuprofen",
    "imatinib",
    "insulin",
    "methotrexate",
    "nivolumab",
    "pembrolizumab",
    "prednisone",
    "rituximab",
    "sulfonylurea",
    "warfarin",
}


@dataclass(frozen=True)
class EnsembleCandidate:
    """One model vote."""

    model: str
    diagnosis: str
    confidence: str
    evidence_for: list[str]
    evidence_against: list[str]
    raw_len: int = 0
    error: str = ""

    def to_dict(self) -> dict[str, Any]:
        """Serialize candidate."""
        return {
            "model": self.model,
            "diagnosis": self.diagnosis,
            "confidence": self.confidence,
            "evidence_for": self.evidence_for,
            "evidence_against": self.evidence_against,
            "raw_len": self.raw_len,
            "error": self.error,
        }


def normalize_label(value: str) -> str:
    """Normalize a clinical label for grouping, not for final scoring."""
    value = value.lower()
    value = re.sub(r"\b(final|diagnosis|primary|probable|likely)\b", " ", value)
    value = re.sub(r"[^a-z0-9]+", " ", value)
    return " ".join(word for word in value.split() if word not in STOPWORDS)


def labels_equivalent(left: str, right: str) -> bool:
    """Return true when two labels are close enough for voting."""
    if not left.strip() or not right.strip():
        return False
    if normalize_label(left) == normalize_label(right):
        return True
    return _is_match(left, right, []) or _is_match(right, left, [])


def choose_vote_winner(candidates: list[EnsembleCandidate]) -> tuple[str, dict[str, Any]]:
    """Choose majority winner if at least two models agree."""
    groups: list[list[EnsembleCandidate]] = []
    for candidate in candidates:
        if not candidate.diagnosis.strip():
            continue
        for group in groups:
            if labels_equivalent(candidate.diagnosis, group[0].diagnosis):
                group.append(candidate)
                break
        else:
            groups.append([candidate])
    groups.sort(key=len, reverse=True)
    if not groups:
        return "", {"strategy": "empty", "agreeing_models": []}
    winner = groups[0]
    if len(winner) >= 2:
        return winner[0].diagnosis, {
            "strategy": "majority_vote",
            "agreeing_models": [item.model for item in winner],
            "vote_count": len(winner),
        }
    return winner[0].diagnosis, {
        "strategy": "plurality_fallback",
        "agreeing_models": [winner[0].model],
        "vote_count": 1,
    }


def build_retrieval_query(case: SequentialDoctorCase, row: dict[str, Any]) -> str:
    """Build a controlled search query without title or gold-label leakage."""
    text_parts = [
        case.opening,
        case.sections.get("history", ""),
        case.sections.get("physical_exam", ""),
        case.sections.get("basic_labs", ""),
        str(row.get("prediction", "")),
    ]
    text = " ".join(text_parts)
    words = re.findall(r"[A-Za-z][A-Za-z-]{4,}", text)
    ranked: dict[str, int] = {}
    for word in words:
        key = word.lower().strip("-")
        if key in STOPWORDS or len(key) < 5:
            continue
        ranked[key] = ranked.get(key, 0) + 1
    terms = sorted(ranked, key=lambda item: (-ranked[item], item))[:8]
    return " ".join(terms) or "rare disease case report"


def controlled_medical_retrieval(
    case: SequentialDoctorCase,
    row: dict[str, Any],
    *,
    max_results: int = 3,
    cache_dir: Path | None = None,
) -> dict[str, Any]:
    """Run public evidence lookups with no gold-label or title query."""
    query = build_retrieval_query(case, row)
    evidence: dict[str, Any] = {"query": query, "sources": {}}
    lookups = {
        "pubmed": lambda: pubmed_search.run(query=f"{query} case report", max_results=max_results),
        "pmc": lambda: pmc_search.run(query=f"{query} case report", max_results=max_results),
        "clinical_trials": lambda: clinical_trials_search.run(
            condition=query,
            max_results=max_results,
        ),
    }
    text = f"{query} {row.get('prediction', '')}".lower()
    drug_terms = sorted(hint for hint in DRUG_HINTS if hint in text)
    if drug_terms:
        lookups["dailymed"] = lambda: dailymed_drug_search.run(
            drug_name=drug_terms[0],
            max_results=max_results,
        )
        evidence["drug_query"] = drug_terms[0]
    for name, lookup in lookups.items():
        try:
            evidence["sources"][name] = _cached_lookup(
                cache_dir,
                "retrieval",
                {
                    "tool": name,
                    "query": query,
                    "drug_query": evidence.get("drug_query", ""),
                    "max_results": max_results,
                },
                lookup,
            )
        except Exception as exc:  # pragma: no cover - live network path
            evidence["sources"][name] = {"error": str(exc)[:300]}
    return evidence


def run_ensemble_rescue(
    *,
    report_path: str | Path,
    models: list[str],
    judge_model: str,
    max_tokens: int,
    timeout: float,
    include_doubtful: bool,
    use_retrieval: bool,
    retrieval_results: int,
    cache_dir: str | Path | None = ".cache/handoffkit/clinical_ensemble",
) -> dict[str, Any]:
    """Run ensemble only on failed or doubtful source rows."""
    source = json.loads(Path(report_path).read_text(encoding="utf-8"))
    case_count = int(source.get("case_count", len(source.get("rows", []))))
    cases = {case.case.case_id: case for case in build_sequential_doctor_cases(case_count)}
    providers = {
        model: OpenCodeGoProvider(model=model, timeout=timeout)
        for model in sorted(set([*models, judge_model]))
    }
    rows: list[dict[str, Any]] = []
    started = time.time()
    reports_dir = Path("reports")
    reports_dir.mkdir(exist_ok=True)
    cache_path = Path(cache_dir) if cache_dir is not None else None
    if cache_path is not None:
        cache_path.mkdir(parents=True, exist_ok=True)
    scope = "failed_and_doubtful" if include_doubtful else "failed_only"
    name = f"opencode_clinical_ensemble_{case_count}_{scope}"
    partial_path = reports_dir / f"{name}.partial.json"
    cached_rows = _load_partial_rows(partial_path)
    for index, row in enumerate(source.get("rows", []), start=1):
        case = cases.get(str(row.get("case_id", "")))
        if case is None:
            continue
        cached_row = cached_rows.get(case.case_id)
        if cached_row is not None:
            rows.append(cached_row)
            print(f"{index}/{case_count} {case.case_id}: CACHED")
            continue
        prior_success = row.get("final_correct", row.get("correct")) is True
        should_rescue = not prior_success or (
            include_doubtful and _row_is_doubtful(row)
        )
        if not should_rescue:
            rows.append({**row, "ensemble_attempted": False, "final_correct": True})
            _write_partial_report(
                partial_path,
                source,
                rows,
                models,
                judge_model,
                max_tokens,
                use_retrieval,
                started,
            )
            continue
        evidence = (
            controlled_medical_retrieval(
                case,
                row,
                max_results=retrieval_results,
                cache_dir=cache_path,
            )
            if use_retrieval
            else {"query": "", "sources": {}}
        )
        candidates = [
            _model_candidate(
                provider=providers[model],
                model=model,
                case=case,
                row=row,
                evidence=evidence,
                max_tokens=max_tokens,
                cache_dir=cache_path,
            )
            for model in models
        ]
        voted_prediction, vote = choose_vote_winner(candidates)
        judge = _judge_candidate(
            provider=providers[judge_model],
            model=judge_model,
            case=case,
            row=row,
            evidence=evidence,
            candidates=candidates,
            voted_prediction=voted_prediction,
            max_tokens=max_tokens,
            cache_dir=cache_path,
        )
        final_prediction = judge.diagnosis or voted_prediction
        final_correct = _is_match(final_prediction, case.case.final_diagnosis, case.aliases)
        merged = {
            **row,
            "ensemble_attempted": True,
            "retrieval": evidence,
            "candidates": [candidate.to_dict() for candidate in candidates],
            "vote": vote,
            "judge": judge.to_dict(),
            "final_prediction": final_prediction,
            "final_correct": final_correct,
        }
        rows.append(merged)
        _write_partial_report(
            partial_path,
            source,
            rows,
            models,
            judge_model,
            max_tokens,
            use_retrieval,
            started,
        )
        print(
            f"{index}/{case_count} {case.case_id}: "
            f"{'OK' if final_correct else 'MISS'} | final={final_prediction!r} | "
            f"gold={case.case.final_diagnosis!r}"
        )
    base_correct = sum(
        1 for row in source.get("rows", []) if row.get("final_correct", row.get("correct")) is True
    )
    final_correct = sum(1 for row in rows if row.get("final_correct") is True)
    report = {
        "name": f"OpenCode Clinical Ensemble Rescue {case_count}",
        "mode": "ensemble_rescue_with_controlled_retrieval",
        "source_report": str(report_path),
        "models": models,
        "judge_model": judge_model,
        "max_tokens": max_tokens,
        "retrieval_enabled": use_retrieval,
        "rescue_scope": scope,
        "case_count": case_count,
        "attempted": sum(1 for row in rows if row.get("ensemble_attempted")),
        "base_correct": base_correct,
        "final_correct": final_correct,
        "rescued": final_correct - base_correct,
        "base_accuracy": round(base_correct / case_count, 3) if case_count else 0.0,
        "final_accuracy": round(final_correct / case_count, 3) if case_count else 0.0,
        "seconds": round(time.time() - started, 2),
        "safety_note": SAFETY_NOTE,
        "rows": rows,
    }
    (reports_dir / f"{name}.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (reports_dir / f"{name}.md").write_text(_to_markdown(report), encoding="utf-8")
    return report


def _row_is_doubtful(row: dict[str, Any]) -> bool:
    text = json.dumps(row.get("stages", []), ensure_ascii=False).lower()
    return any(term in text for term in ("low", "uncertain", "equivocal", "possible"))


def _model_candidate(
    *,
    provider: OpenCodeGoProvider,
    model: str,
    case: SequentialDoctorCase,
    row: dict[str, Any],
    evidence: dict[str, Any],
    max_tokens: int,
    cache_dir: Path | None,
) -> EnsembleCandidate:
    error = ""
    prompt = _candidate_prompt(case, row, evidence, model)
    try:
        raw = _cached_provider_generate(
            cache_dir,
            provider,
            model,
            prompt,
            max_tokens=max_tokens,
        )
    except Exception as exc:  # pragma: no cover - real provider path
        raw = ""
        error = str(exc)
    parsed = _extract_json_object(raw)
    return _candidate_from_parsed(model, raw, parsed, error)


def _judge_candidate(
    *,
    provider: OpenCodeGoProvider,
    model: str,
    case: SequentialDoctorCase,
    row: dict[str, Any],
    evidence: dict[str, Any],
    candidates: list[EnsembleCandidate],
    voted_prediction: str,
    max_tokens: int,
    cache_dir: Path | None,
) -> EnsembleCandidate:
    error = ""
    prompt = _judge_prompt(case, row, evidence, candidates, voted_prediction)
    try:
        raw = _cached_provider_generate(
            cache_dir,
            provider,
            model,
            prompt,
            max_tokens=max_tokens,
        )
    except Exception as exc:  # pragma: no cover - real provider path
        raw = ""
        error = str(exc)
    parsed = _extract_json_object(raw)
    return _candidate_from_parsed(model, raw, parsed, error)


def _candidate_from_parsed(
    model: str,
    raw: str,
    parsed: dict[str, Any],
    error: str = "",
) -> EnsembleCandidate:
    diagnosis = ""
    for key in ("final_diagnosis", "diagnosis", "primary_diagnosis", "normalized_diagnosis"):
        if isinstance(parsed.get(key), str) and parsed[key].strip():
            diagnosis = parsed[key].strip()
            break
    if not diagnosis:
        diagnosis = raw.strip().splitlines()[0][:180] if raw.strip() else ""
    return EnsembleCandidate(
        model=model,
        diagnosis=diagnosis,
        confidence=str(parsed.get("confidence", "")),
        evidence_for=_string_list(parsed.get("evidence_for", [])),
        evidence_against=_string_list(parsed.get("evidence_against", [])),
        raw_len=len(raw),
        error=error[:400],
    )


def _string_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item) for item in value[:8]]
    if isinstance(value, str) and value.strip():
        return [value.strip()]
    return []


def _cache_key(payload: dict[str, Any]) -> str:
    encoded = json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _read_json(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None
    return value if isinstance(value, dict) else None


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def _cached_lookup(
    cache_dir: Path | None,
    namespace: str,
    key_payload: dict[str, Any],
    callback: Any,
) -> dict[str, Any]:
    if cache_dir is None:
        value = callback()
        return value if isinstance(value, dict) else {"data": value}
    path = cache_dir / namespace / f"{_cache_key(key_payload)}.json"
    cached = _read_json(path)
    if cached is not None:
        return cached
    value = callback()
    payload = value if isinstance(value, dict) else {"data": value}
    _write_json(path, payload)
    return payload


def _cached_provider_generate(
    cache_dir: Path | None,
    provider: OpenCodeGoProvider,
    model: str,
    prompt: str,
    *,
    max_tokens: int,
) -> str:
    key_payload = {
        "model": model,
        "prompt": prompt,
        "temperature": 0,
        "max_tokens": max_tokens,
    }
    if cache_dir is not None:
        path = cache_dir / "model_calls" / f"{_cache_key(key_payload)}.json"
        cached = _read_json(path)
        if cached is not None and isinstance(cached.get("raw"), str):
            return str(cached["raw"])
    raw = provider.generate(prompt, temperature=0, max_tokens=max_tokens)
    if cache_dir is not None:
        _write_json(path, {"model": model, "raw": raw, "raw_len": len(raw)})
    return raw


def _load_partial_rows(partial_path: Path) -> dict[str, dict[str, Any]]:
    partial = _read_json(partial_path)
    if partial is None:
        return {}
    rows = partial.get("rows")
    if not isinstance(rows, list):
        return {}
    cached: dict[str, dict[str, Any]] = {}
    for row in rows:
        if isinstance(row, dict) and isinstance(row.get("case_id"), str):
            cached[row["case_id"]] = row
    return cached


def _write_partial_report(
    partial_path: Path,
    source: dict[str, Any],
    rows: list[dict[str, Any]],
    models: list[str],
    judge_model: str,
    max_tokens: int,
    use_retrieval: bool,
    started: float,
) -> None:
    case_count = int(source.get("case_count", len(source.get("rows", []))))
    base_correct = sum(
        1 for row in source.get("rows", []) if row.get("final_correct", row.get("correct")) is True
    )
    final_correct = sum(1 for row in rows if row.get("final_correct") is True)
    _write_json(
        partial_path,
        {
            "name": f"OpenCode Clinical Ensemble Rescue {case_count} partial",
            "mode": "ensemble_rescue_partial",
            "models": models,
            "judge_model": judge_model,
            "max_tokens": max_tokens,
            "retrieval_enabled": use_retrieval,
            "case_count": case_count,
            "completed_cases": len(rows),
            "base_correct": base_correct,
            "final_correct_so_far": final_correct,
            "seconds": round(time.time() - started, 2),
            "rows": rows,
        },
    )


def _candidate_prompt(
    case: SequentialDoctorCase,
    row: dict[str, Any],
    retrieval: dict[str, Any],
    model: str,
) -> str:
    return f"""Return strict JSON only. No markdown. No prose outside JSON.
Educational benchmark only. Not medical advice.

You are one independent diagnostic reviewer in a multi-model ensemble.
Model role: {model}

Use the case evidence, prior panel output, and controlled public retrieval.
Do not use the gold label; it is not provided. Prefer the most specific
primary diagnosis, not a broad parent disease or secondary complication.

JSON schema:
{{"summary": str, "diagnosis": str, "confidence": str, "evidence_for": [str],
"evidence_against": [str], "retrieval_used": [str], "close_mimics": [str]}}

Case evidence:
Opening: {case.opening}
History: {case.sections.get("history", "")}
Physical exam: {case.sections.get("physical_exam", "")}
Basic labs: {case.sections.get("basic_labs", "")}
Imaging: {case.sections.get("imaging", "")}
Pathology: {case.sections.get("pathology", "")}
Special tests: {case.sections.get("special_tests", "")}

Prior prediction:
{row.get("prediction", "")}

Prior panel stages:
{json.dumps(row.get("stages", []), ensure_ascii=False)[:18000]}

Controlled retrieval:
{json.dumps(retrieval, ensure_ascii=False)[:12000]}
"""


def _judge_prompt(
    case: SequentialDoctorCase,
    row: dict[str, Any],
    retrieval: dict[str, Any],
    candidates: list[EnsembleCandidate],
    voted_prediction: str,
) -> str:
    return f"""Return strict JSON only. No markdown. No prose outside JSON.
Educational benchmark only. Not medical advice.

You are the final diagnostic judge. Use model votes and evidence.
If two or more models agree and evidence supports them, keep the vote.
If they disagree, choose the diagnosis best supported by specific objective
findings and controlled retrieval. Avoid broad labels and secondary events.

JSON schema:
{{"summary": str, "final_diagnosis": str, "confidence": str, "vote_reason": str,
"evidence_for": [str], "evidence_against": [str], "why_not_other_votes": [str]}}

Case opening and key sections:
Opening: {case.opening}
History: {case.sections.get("history", "")}
Exam: {case.sections.get("physical_exam", "")}
Labs: {case.sections.get("basic_labs", "")}
Imaging: {case.sections.get("imaging", "")}
Pathology: {case.sections.get("pathology", "")}
Special tests: {case.sections.get("special_tests", "")}

Prior prediction:
{row.get("prediction", "")}

Vote winner:
{voted_prediction}

Model candidates:
{json.dumps([candidate.to_dict() for candidate in candidates], ensure_ascii=False)}

Controlled retrieval:
{json.dumps(retrieval, ensure_ascii=False)[:12000]}
"""


def _to_markdown(report: dict[str, Any]) -> str:
    rows = "\n".join(
        "| {case_id} | {gold} | {prediction} | {final} | {ok} |".format(
            case_id=row.get("case_id", ""),
            gold=str(row.get("gold", "")).replace("|", "/"),
            prediction=str(row.get("prediction", "")).replace("|", "/"),
            final=str(row.get("final_prediction", row.get("prediction", ""))).replace("|", "/"),
            ok=row.get("final_correct", row.get("correct")),
        )
        for row in report["rows"]
        if row.get("ensemble_attempted")
    )
    return (
        f"# {report['name']}\n\n"
        f"> {report['safety_note']}\n\n"
        "## Summary\n\n"
        f"- Models: `{', '.join(report['models'])}`\n"
        f"- Judge model: `{report['judge_model']}`\n"
        f"- Retrieval enabled: `{report['retrieval_enabled']}`\n"
        f"- Attempted: `{report['attempted']}`\n"
        f"- Base correct: `{report['base_correct']}/{report['case_count']}`\n"
        f"- Base accuracy: `{report['base_accuracy']:.3f}`\n"
        f"- Final correct: `{report['final_correct']}/{report['case_count']}`\n"
        f"- Final accuracy: `{report['final_accuracy']:.3f}`\n"
        f"- Rescued: `{report['rescued']}`\n"
        f"- Seconds: `{report['seconds']}`\n\n"
        "## Ensemble Attempts\n\n"
        "| Case | Gold | Prior Prediction | Final Prediction | Final Correct |\n"
        "| --- | --- | --- | --- | --- |\n"
        f"{rows}\n"
    )


def _parse_models(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--report",
        default="reports/opencode_mimo_clinical_mai_100_rescue.json",
        help="Source benchmark report JSON.",
    )
    parser.add_argument("--models", default=",".join(DEFAULT_MODELS))
    parser.add_argument("--judge-model", default="glm-5.2")
    parser.add_argument("--max-tokens", type=int, default=DEFAULT_MAX_TOKENS)
    parser.add_argument("--timeout", type=float, default=300.0)
    parser.add_argument("--include-doubtful", action="store_true")
    parser.add_argument("--no-retrieval", action="store_true")
    parser.add_argument("--retrieval-results", type=int, default=3)
    parser.add_argument("--cache-dir", default=".cache/handoffkit/clinical_ensemble")
    parser.add_argument("--no-cache", action="store_true")
    args = parser.parse_args()
    if not os.getenv("OPENCODE_API_KEY"):
        raise SystemExit("OPENCODE_API_KEY is required.")
    report = run_ensemble_rescue(
        report_path=args.report,
        models=_parse_models(args.models),
        judge_model=args.judge_model,
        max_tokens=args.max_tokens,
        timeout=args.timeout,
        include_doubtful=args.include_doubtful,
        use_retrieval=not args.no_retrieval,
        retrieval_results=args.retrieval_results,
        cache_dir=None if args.no_cache else args.cache_dir,
    )
    print(_to_markdown(report))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
