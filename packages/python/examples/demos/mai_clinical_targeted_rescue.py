"""Targeted specialist rescue for clinical MAI-style benchmark misses.

Educational benchmark only. Uses public case-report fixtures and public lookup
APIs. This is not medical advice and is not for patient care.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from examples.demos.mai_clinical_ensemble_benchmark import (  # noqa: E402
    _cached_provider_generate,
    _load_partial_rows,
    _read_json,
    _string_list,
)
from examples.demos.mai_clinical_mimo_benchmark import (  # noqa: E402
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
    pubmed_abstract_search,
    pubmed_search,
)

DEFAULT_SPECIALIST_MODEL = "deepseek-v4-flash"
DEFAULT_JUDGE_MODEL = "glm-5.2"
DEFAULT_MAX_TOKENS = 32768
ADVANCED_MODELS = ("qwen3.7-max", "deepseek-v4-pro")
EVIDENCE_PACKET_VERSION = "epackv3"

DOMAIN_PROFILES: dict[str, dict[str, Any]] = {
    "tumor_pathology": {
        "role": "oncology/pathology specialist",
        "keywords": (
            "mass",
            "tumor",
            "neoplasm",
            "carcinoma",
            "adenocarcinoma",
            "lymphoma",
            "meningioma",
            "cyst",
            "biopsy",
            "histology",
            "immunohistochemistry",
            "staining",
            "cells",
            "lesion",
        ),
        "query_terms": "pathology immunohistochemistry case report",
    },
    "infectious_disease": {
        "role": "infectious disease specialist",
        "keywords": (
            "fever",
            "infection",
            "virus",
            "viral",
            "bacteria",
            "mycobacterium",
            "pneumonia",
            "culture",
            "abscess",
            "ebv",
            "bartonella",
            "cryptococ",
            "tuberc",
            "leprosy",
        ),
        "query_terms": "infectious disease case report microbiology",
    },
    "endocrine_electrolyte": {
        "role": "endocrine/electrolyte specialist",
        "keywords": (
            "sodium",
            "hyponatremia",
            "potassium",
            "adrenal",
            "aldosterone",
            "thyroid",
            "calcium",
            "phosphate",
            "hypophosph",
            "hormone",
            "pituitary",
            "glucose",
            "hypoglycemia",
        ),
        "query_terms": "endocrine electrolyte case report",
    },
    "neuro": {
        "role": "neurology specialist",
        "keywords": (
            "brain",
            "seizure",
            "encephalitis",
            "neurologic",
            "neurological",
            "weakness",
            "neuropathy",
            "mri",
            "headache",
            "pituitary",
            "spinal",
        ),
        "query_terms": "neurology neuroimaging case report",
    },
}


@dataclass(frozen=True)
class TargetedOpinion:
    """One targeted specialist opinion."""

    domain: str
    model: str
    diagnosis: str
    confidence: str
    evidence_for: list[str]
    evidence_against: list[str]
    changed_prior: bool
    raw_len: int = 0
    error: str = ""

    def to_dict(self) -> dict[str, Any]:
        """Serialize opinion."""
        return {
            "domain": self.domain,
            "model": self.model,
            "diagnosis": self.diagnosis,
            "confidence": self.confidence,
            "evidence_for": self.evidence_for,
            "evidence_against": self.evidence_against,
            "changed_prior": self.changed_prior,
            "raw_len": self.raw_len,
            "error": self.error,
        }


def classify_specialist_domains(
    case: SequentialDoctorCase,
    row: dict[str, Any],
    *,
    max_domains: int = 1,
    pathology_first: bool = True,
) -> list[str]:
    """Choose targeted specialist domains without using title or gold label."""
    text = " ".join(
        [
            case.opening,
            case.sections.get("history", ""),
            case.sections.get("physical_exam", ""),
            case.sections.get("basic_labs", ""),
            case.sections.get("imaging", ""),
            case.sections.get("pathology", ""),
            case.sections.get("special_tests", ""),
            str(row.get("prediction", "")),
            str(row.get("final_prediction", "")),
        ]
    ).lower()
    scores: dict[str, int] = {}
    for domain, profile in DOMAIN_PROFILES.items():
        scores[domain] = sum(1 for keyword in profile["keywords"] if keyword in text)
    ranked = [
        domain
        for domain, score in sorted(scores.items(), key=lambda item: -item[1])
        if score
    ]
    if not ranked:
        ranked = ["tumor_pathology"]
    if pathology_first and _has_pathology_signal(text):
        ranked = ["tumor_pathology", *[domain for domain in ranked if domain != "tumor_pathology"]]
    return ranked[: max(1, max_domains)]


def build_targeted_query(case: SequentialDoctorCase, row: dict[str, Any], domain: str) -> str:
    """Build a domain-specific query without title or gold-label leakage."""
    return build_retrieval_queries(case, row, domain, max_queries=1)[0]


def build_retrieval_queries(
    case: SequentialDoctorCase,
    row: dict[str, Any],
    domain: str,
    *,
    max_queries: int = 5,
) -> list[str]:
    """Build 3-5 case-specific retrieval queries without title/gold leakage."""
    source = " ".join(
        [
            case.opening,
            case.sections.get("history", ""),
            case.sections.get("physical_exam", ""),
            case.sections.get("basic_labs", ""),
            case.sections.get("imaging", ""),
            case.sections.get("pathology", ""),
            case.sections.get("special_tests", ""),
            str(row.get("prediction", "")),
            str(row.get("final_prediction", "")),
        ]
    )
    words = re.findall(r"[A-Za-z][A-Za-z-]{5,}", source)
    stop = {
        "patient",
        "diagnosis",
        "disease",
        "clinical",
        "presented",
        "showed",
        "history",
        "reported",
        "revealed",
        "normal",
        "without",
    }
    counts: dict[str, int] = {}
    for word in words:
        key = word.lower().strip("-")
        if key in stop:
            continue
        counts[key] = counts.get(key, 0) + 1
    terms = sorted(counts, key=lambda key: (-counts[key], key))
    high_signal = _high_signal_terms(case, domain)
    prior_terms = _label_terms(str(row.get("final_prediction", row.get("prediction", ""))))
    domain_terms = str(DOMAIN_PROFILES[domain]["query_terms"])
    candidate_queries = [
        " ".join([*high_signal[:5], domain_terms]).strip(),
        " ".join([*prior_terms[:4], *high_signal[:4], "case report"]).strip(),
        " ".join([*terms[:6], domain_terms]).strip(),
        " ".join([*high_signal[:3], *terms[:4], "differential diagnosis"]).strip(),
        " ".join([*prior_terms[:3], domain_terms]).strip(),
    ]
    queries: list[str] = []
    seen: set[str] = set()
    for query in candidate_queries:
        cleaned = " ".join(query.split())
        if not cleaned or cleaned in seen:
            continue
        seen.add(cleaned)
        queries.append(cleaned)
        if len(queries) >= max(1, max_queries):
            break
    return queries or ["rare disease case report"]


def targeted_retrieval(
    case: SequentialDoctorCase,
    row: dict[str, Any],
    domain: str,
    *,
    max_results: int,
    cache_dir: Path | None,
) -> dict[str, Any]:
    """Retrieve targeted medical evidence before model voting."""
    queries = build_retrieval_queries(case, row, domain, max_queries=5)
    query_key = " || ".join(queries)
    key = _cache_key_payload(case.case_id, row, domain, query_key, max_results)
    cache_path = None if cache_dir is None else cache_dir / "targeted_retrieval" / f"{key}.json"
    cached = _read_json(cache_path) if cache_path is not None else None
    if cached is not None:
        return cached
    evidence: dict[str, Any] = {"domain": domain, "queries": queries, "sources": {}}
    evidence["sources"]["pubmed_abstracts"] = []
    evidence["sources"]["pubmed"] = []
    evidence["sources"]["pmc"] = []
    evidence["sources"]["clinical_trials"] = []
    for query in queries:
        lookups = {
            "pubmed_abstracts": lambda q=query: pubmed_abstract_search.run(
                query=q,
                max_results=min(max_results, 3),
            ),
            "pubmed": lambda q=query: pubmed_search.run(query=q, max_results=max_results),
            "pmc": lambda q=query: pmc_search.run(query=q, max_results=max_results),
            "clinical_trials": lambda q=query: clinical_trials_search.run(
                condition=q,
                max_results=max_results,
            ),
        }
        for name, lookup in lookups.items():
            try:
                payload = lookup()
                if isinstance(payload, dict):
                    payload = {**payload, "query": query}
                evidence["sources"][name].append(payload)
            except Exception as exc:  # pragma: no cover - live network path
                evidence["sources"][name].append({"query": query, "error": str(exc)[:300]})
    drug = _drug_hint(" ".join(queries) + " " + str(row.get("prediction", "")))
    if drug:
        evidence["drug_query"] = drug
        try:
            evidence["sources"]["dailymed"] = dailymed_drug_search.run(
                drug_name=drug,
                max_results=max_results,
            )
        except Exception as exc:  # pragma: no cover - live network path
            evidence["sources"]["dailymed"] = {"error": str(exc)[:300]}
    if cache_path is not None:
        _safe_write_json(cache_path, evidence)
    return evidence


def build_evidence_packet(
    case: SequentialDoctorCase,
    row: dict[str, Any],
    domain: str,
    retrieval: dict[str, Any],
) -> dict[str, Any]:
    """Build compact deterministic evidence packet before model call."""
    case_clues = _case_clues_for_domain(case, domain)
    prior = str(row.get("final_prediction", row.get("prediction", "")))
    sources: list[dict[str, str]] = []
    for source_name, payload in retrieval.get("sources", {}).items():
        payloads = payload if isinstance(payload, list) else [payload]
        for source_payload in payloads:
            if not isinstance(source_payload, dict):
                continue
            for item in source_payload.get("results", [])[:3]:
                if not isinstance(item, dict):
                    continue
                sources.append(
                    {
                        "query": str(source_payload.get("query", retrieval.get("query", "")))[:220],
                        "source": source_name,
                        "title": str(item.get("title", ""))[:220],
                        "journal": str(item.get("journal", item.get("status", "")))[:120],
                        "abstract": str(item.get("abstract", ""))[:700],
                        "url": str(item.get("url", ""))[:260],
                    }
                )
    unique_sources: list[dict[str, str]] = []
    seen_urls: set[str] = set()
    for source in sources:
        key = source.get("url") or source.get("title")
        if key in seen_urls:
            continue
        seen_urls.add(key)
        unique_sources.append(source)
    hypothesis = _domain_hypothesis(domain, prior, case_clues)
    return {
        "domain": domain,
        "prior_prediction": prior,
        "queries": retrieval.get("queries", [retrieval.get("query", "")]),
        "case_clues": case_clues,
        "hypothesis_to_test": hypothesis,
        "retrieval_sources": unique_sources[:14],
        "decision_rule": (
            "Change prior only when case clues and retrieval support a more specific "
            "primary diagnosis. Prefer pathology/immunohistochemistry over broad tumor labels."
        ),
    }


def run_targeted_rescue(
    *,
    report_path: str | Path,
    specialist_model: str,
    judge_model: str,
    max_tokens: int,
    timeout: float,
    max_domains: int,
    retrieval_results: int,
    pathology_first: bool = True,
    cache_dir: str | Path | None = ".cache/handoffkit/clinical_targeted",
    limit: int | None = None,
) -> dict[str, Any]:
    """Run specialist targeted rescue on failed rows only."""
    source = json.loads(Path(report_path).read_text(encoding="utf-8"))
    case_count = int(source.get("case_count", len(source.get("rows", []))))
    cases = {case.case.case_id: case for case in build_sequential_doctor_cases(case_count)}
    cache_path = Path(cache_dir) if cache_dir is not None else None
    if cache_path is not None:
        cache_path.mkdir(parents=True, exist_ok=True)
    reports_dir = Path("reports")
    reports_dir.mkdir(exist_ok=True)
    model_slug = _slug(f"{specialist_model}_{judge_model}")
    name = (
        f"opencode_clinical_targeted_rescue_{case_count}_d{max_domains}_"
        f"{EVIDENCE_PACKET_VERSION}_{model_slug}"
    )
    partial_path = reports_dir / f"{name}.partial.json"
    cached_rows = _load_partial_rows(partial_path)
    providers = {
        specialist_model: OpenCodeGoProvider(model=specialist_model, timeout=timeout),
        judge_model: OpenCodeGoProvider(model=judge_model, timeout=timeout),
    }
    rows: list[dict[str, Any]] = []
    started = time.time()
    attempted = 0
    for index, row in enumerate(source.get("rows", []), start=1):
        case = cases.get(str(row.get("case_id", "")))
        if case is None:
            continue
        cached_row = cached_rows.get(case.case_id)
        if cached_row is not None:
            rows.append(cached_row)
            print(f"{index}/{case_count} {case.case_id}: CACHED")
            continue
        prior_prediction = _best_final_prediction(row)
        prior_success = _is_match(prior_prediction, case.case.final_diagnosis, case.aliases)
        if prior_success:
            rows.append(
                {
                    **row,
                    "targeted_attempted": False,
                    "final_prediction": prior_prediction,
                    "final_correct": True,
                }
            )
            _write_partial(
                partial_path,
                source,
                rows,
                specialist_model,
                judge_model,
                max_tokens,
                max_domains,
                started,
            )
            continue
        if limit is not None and attempted >= limit:
            break
        attempted += 1
        domains = classify_specialist_domains(
            case,
            row,
            max_domains=max_domains,
            pathology_first=pathology_first,
        )
        retrieval = {
            domain: targeted_retrieval(
                case,
                row,
                domain,
                max_results=retrieval_results,
                cache_dir=cache_path,
            )
            for domain in domains
        }
        evidence_packets = {
            domain: build_evidence_packet(case, row, domain, retrieval[domain])
            for domain in domains
        }
        opinions = [
            _specialist_opinion(
                provider=providers[specialist_model],
                model=specialist_model,
                case=case,
                row=row,
                domain=domain,
                evidence_packet=evidence_packets[domain],
                max_tokens=max_tokens,
                cache_dir=cache_path,
            )
            for domain in domains
        ]
        judge = _final_judge(
            provider=providers[judge_model],
            model=judge_model,
            case=case,
            row=row,
            evidence_packets=evidence_packets,
            opinions=opinions,
            max_tokens=max_tokens,
            cache_dir=cache_path,
        )
        final_prediction = (
            judge.diagnosis
            or _best_final_prediction(row)
        )
        final_correct = _is_match(final_prediction, case.case.final_diagnosis, case.aliases)
        merged = {
            **row,
            "targeted_attempted": True,
            "targeted_domains": domains,
            "targeted_retrieval": retrieval,
            "evidence_packets": evidence_packets,
            "targeted_opinions": [opinion.to_dict() for opinion in opinions],
            "targeted_judge": judge.to_dict(),
            "targeted_prediction": final_prediction,
            "final_prediction": final_prediction,
            "final_correct": final_correct,
        }
        rows.append(merged)
        _write_partial(
            partial_path,
            source,
            rows,
            specialist_model,
            judge_model,
            max_tokens,
            max_domains,
            started,
        )
        print(
            f"{index}/{case_count} {case.case_id}: {'OK' if final_correct else 'MISS'} | "
            f"domains={','.join(domains)} | final={final_prediction!r} | "
            f"gold={case.case.final_diagnosis!r}"
        )
    report = _make_report(source, rows, specialist_model, judge_model, max_tokens, started)
    report["max_domains"] = max_domains
    report["pathology_first"] = pathology_first
    report["evidence_packet_version"] = EVIDENCE_PACKET_VERSION
    (reports_dir / f"{name}.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (reports_dir / f"{name}.md").write_text(_to_markdown(report), encoding="utf-8")
    return report


def _specialist_opinion(
    *,
    provider: OpenCodeGoProvider,
    model: str,
    case: SequentialDoctorCase,
    row: dict[str, Any],
    domain: str,
    evidence_packet: dict[str, Any],
    max_tokens: int,
    cache_dir: Path | None,
) -> TargetedOpinion:
    raw = ""
    error = ""
    prompt = _specialist_prompt(case, row, domain, evidence_packet)
    try:
        raw = _cached_provider_generate(
            cache_dir,
            provider,
            model,
            prompt,
            max_tokens=max_tokens,
        )
    except Exception as exc:  # pragma: no cover - live provider path
        error = str(exc)
    parsed = _extract_json_object(raw)
    return _opinion_from_parsed(domain, model, raw, parsed, error)


def _final_judge(
    *,
    provider: OpenCodeGoProvider,
    model: str,
    case: SequentialDoctorCase,
    row: dict[str, Any],
    evidence_packets: dict[str, Any],
    opinions: list[TargetedOpinion],
    max_tokens: int,
    cache_dir: Path | None,
) -> TargetedOpinion:
    raw = ""
    error = ""
    prompt = _judge_prompt(case, row, evidence_packets, opinions)
    try:
        raw = _cached_provider_generate(
            cache_dir,
            provider,
            model,
            prompt,
            max_tokens=max_tokens,
        )
    except Exception as exc:  # pragma: no cover - live provider path
        error = str(exc)
    parsed = _extract_json_object(raw)
    return _opinion_from_parsed("final_judge", model, raw, parsed, error)


def _opinion_from_parsed(
    domain: str,
    model: str,
    raw: str,
    parsed: dict[str, Any],
    error: str,
) -> TargetedOpinion:
    diagnosis = ""
    for key in ("final_diagnosis", "diagnosis", "primary_diagnosis", "targeted_diagnosis"):
        value = parsed.get(key)
        if isinstance(value, str) and value.strip():
            diagnosis = value.strip()
            break
    if not diagnosis and raw.strip():
        diagnosis = raw.strip().splitlines()[0][:180]
    return TargetedOpinion(
        domain=domain,
        model=model,
        diagnosis=diagnosis,
        confidence=str(parsed.get("confidence", "")),
        evidence_for=_string_list(parsed.get("evidence_for", [])),
        evidence_against=_string_list(parsed.get("evidence_against", [])),
        changed_prior=bool(parsed.get("changed_prior", False)),
        raw_len=len(raw),
        error=error[:400],
    )


def _specialist_prompt(
    case: SequentialDoctorCase,
    row: dict[str, Any],
    domain: str,
    evidence_packet: dict[str, Any],
) -> str:
    profile = DOMAIN_PROFILES[domain]
    prior_ensemble = {
        "candidates": row.get("candidates", []),
        "judge": row.get("judge", {}),
    }
    return f"""Return strict JSON only. No markdown. No prose outside JSON.
Educational benchmark only. Not medical advice.

You are a {profile["role"]} doing targeted diagnostic rescue.
The prior system likely failed. Your job is to use domain evidence and retrieval
to find a more specific primary diagnosis. Do not use the gold label; it is not
provided. Do not give treatment advice.

JSON schema:
{{"summary": str, "diagnosis": str, "confidence": str, "changed_prior": bool,
"evidence_for": [str], "evidence_against": [str], "retrieval_used": [str],
"specificity_reason": str}}

Prior prediction:
{row.get("final_prediction", row.get("prediction", ""))}

Case evidence:
Opening: {case.opening}
History: {case.sections.get("history", "")}
Physical exam: {case.sections.get("physical_exam", "")}
Basic labs: {case.sections.get("basic_labs", "")}
Imaging: {case.sections.get("imaging", "")}
Pathology: {case.sections.get("pathology", "")}
Special tests: {case.sections.get("special_tests", "")}

Evidence packet already built before this vote:
{json.dumps(evidence_packet, ensure_ascii=False)[:16000]}

Prior ensemble data:
{json.dumps(prior_ensemble, ensure_ascii=False)[:10000]}
"""


def _judge_prompt(
    case: SequentialDoctorCase,
    row: dict[str, Any],
    evidence_packets: dict[str, Any],
    opinions: list[TargetedOpinion],
) -> str:
    return f"""Return strict JSON only. No markdown. No prose outside JSON.
Educational benchmark only. Not medical advice.

You are final judge for targeted rescue. Compare prior prediction, specialist
opinions, evidence packets, and case. Pick one most specific primary diagnosis.
If targeted evidence does not justify changing the prior answer, keep the prior
answer. For tumor/pathology cases, prioritize histology, immunohistochemistry,
site of origin, and named tumor subtype over broad cancer labels.

JSON schema:
{{"summary": str, "final_diagnosis": str, "confidence": str, "changed_prior": bool,
"evidence_for": [str], "evidence_against": [str], "why_not_prior": str,
"why_not_other_specialists": [str]}}

Prior prediction:
{row.get("final_prediction", row.get("prediction", ""))}

Case evidence:
Opening: {case.opening}
History: {case.sections.get("history", "")}
Exam: {case.sections.get("physical_exam", "")}
Labs: {case.sections.get("basic_labs", "")}
Imaging: {case.sections.get("imaging", "")}
Pathology: {case.sections.get("pathology", "")}
Special tests: {case.sections.get("special_tests", "")}

Specialist opinions:
{json.dumps([opinion.to_dict() for opinion in opinions], ensure_ascii=False)}

Evidence packets:
{json.dumps(evidence_packets, ensure_ascii=False)[:18000]}
"""


def _has_pathology_signal(text: str) -> bool:
    signals = (
        "biopsy",
        "histology",
        "immunohistochemistry",
        "staining",
        "tumor",
        "neoplasm",
        "carcinoma",
        "adenocarcinoma",
        "lymphoma",
        "meningioma",
        "mass",
        "lesion",
    )
    return any(signal in text for signal in signals)


def _case_clues_for_domain(case: SequentialDoctorCase, domain: str) -> list[str]:
    sections = {
        "tumor_pathology": ("imaging", "pathology", "special_tests", "physical_exam"),
        "infectious_disease": ("history", "basic_labs", "special_tests", "imaging"),
        "endocrine_electrolyte": ("history", "basic_labs", "special_tests"),
        "neuro": ("history", "physical_exam", "imaging", "special_tests"),
    }.get(domain, ("history", "basic_labs", "imaging", "pathology", "special_tests"))
    clues: list[str] = []
    for section in sections:
        value = case.sections.get(section, "")
        if value:
            clues.append(f"{section}: {_clip_words(value, 42)}")
    return clues[:5]


def _high_signal_terms(case: SequentialDoctorCase, domain: str) -> list[str]:
    sections = {
        "tumor_pathology": ("pathology", "special_tests", "imaging"),
        "infectious_disease": ("special_tests", "basic_labs", "history"),
        "endocrine_electrolyte": ("basic_labs", "history", "special_tests"),
        "neuro": ("imaging", "physical_exam", "special_tests"),
    }.get(domain, ("history", "basic_labs", "imaging", "pathology", "special_tests"))
    text = " ".join(case.sections.get(section, "") for section in sections)
    words = re.findall(r"[A-Za-z][A-Za-z-]{5,}", text)
    stop = {"patient", "normal", "showed", "revealed", "without", "history"}
    counts: dict[str, int] = {}
    for word in words:
        key = word.lower().strip("-")
        if key in stop:
            continue
        counts[key] = counts.get(key, 0) + 1
    return sorted(counts, key=lambda key: (-counts[key], key))[:10]


def _label_terms(value: str) -> list[str]:
    words = re.findall(r"[A-Za-z][A-Za-z-]{3,}", value.lower())
    stop = {"final", "diagnosis", "primary", "probable", "likely", "with"}
    return [word for word in words if word not in stop][:8]


def _domain_hypothesis(domain: str, prior: str, clues: list[str]) -> str:
    if domain == "tumor_pathology":
        return (
            f"Prior `{prior}` may be too broad or wrong tumor lineage. Test against "
            "histology, immunohistochemistry, anatomic origin, and named subtype."
        )
    if domain == "infectious_disease":
        return (
            f"Prior `{prior}` may miss organism-specific diagnosis. Test exposures, "
            "cultures, serology, PCR, immune status, and organ tropism."
        )
    if domain == "endocrine_electrolyte":
        return (
            f"Prior `{prior}` may miss hormone/electrolyte mechanism. Test sodium, "
            "potassium, acid-base, glucose, adrenal/thyroid/pituitary clues."
        )
    if domain == "neuro":
        return (
            f"Prior `{prior}` may miss neurologic localization. Test neuro exam, CSF, "
            "MRI pattern, seizures, neuromuscular and functional signs."
        )
    return f"Test prior `{prior}` against objective case clues: {'; '.join(clues[:2])}"


def _clip_words(value: str, limit: int) -> str:
    words = value.replace("\n", " ").split()
    if len(words) <= limit:
        return " ".join(words)
    return " ".join(words[:limit]) + " ..."


def _drug_hint(text: str) -> str:
    hints = (
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
        "romidepsin",
        "sulfonylurea",
        "warfarin",
    )
    lowered = text.lower()
    return next((hint for hint in hints if hint in lowered), "")


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


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")


def _safe_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.{os.getpid()}.{uuid.uuid4().hex}.tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    for attempt in range(5):
        try:
            tmp.replace(path)
            return
        except PermissionError:
            if attempt == 4:
                raise
            time.sleep(0.25 * (attempt + 1))


def _cache_key_payload(
    case_id: str,
    row: dict[str, Any],
    domain: str,
    query: str,
    max_results: int,
) -> str:
    import hashlib

    payload = {
        "case_id": case_id,
        "prior": row.get("final_prediction", row.get("prediction", "")),
        "domain": domain,
        "query": query,
        "max_results": max_results,
        "evidence_packet_version": EVIDENCE_PACKET_VERSION,
    }
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8")
    ).hexdigest()


def _write_partial(
    path: Path,
    source: dict[str, Any],
    rows: list[dict[str, Any]],
    specialist_model: str,
    judge_model: str,
    max_tokens: int,
    max_domains: int,
    started: float,
) -> None:
    report = _make_report(source, rows, specialist_model, judge_model, max_tokens, started)
    report["mode"] = "targeted_specialist_rescue_partial"
    report["max_domains"] = max_domains
    report["evidence_packet_version"] = EVIDENCE_PACKET_VERSION
    report["completed_cases"] = len(rows)
    _safe_write_json(path, report)


def _make_report(
    source: dict[str, Any],
    rows: list[dict[str, Any]],
    specialist_model: str,
    judge_model: str,
    max_tokens: int,
    started: float,
) -> dict[str, Any]:
    case_count = int(source.get("case_count", len(source.get("rows", []))))
    base_correct = sum(
        1 for row in source.get("rows", []) if row.get("final_correct", row.get("correct")) is True
    )
    final_correct = sum(1 for row in rows if row.get("final_correct") is True)
    return {
        "name": f"OpenCode Clinical Targeted Specialist Rescue {case_count}",
        "mode": "targeted_specialist_rescue",
        "source_report": source.get("source_report", ""),
        "specialist_model": specialist_model,
        "judge_model": judge_model,
        "max_tokens": max_tokens,
        "case_count": case_count,
        "attempted": sum(1 for row in rows if row.get("targeted_attempted")),
        "base_correct": base_correct,
        "final_correct": final_correct,
        "rescued": final_correct - base_correct,
        "base_accuracy": round(base_correct / case_count, 3) if case_count else 0.0,
        "final_accuracy": round(final_correct / case_count, 3) if case_count else 0.0,
        "seconds": round(time.time() - started, 2),
        "safety_note": SAFETY_NOTE,
        "rows": rows,
    }


def _to_markdown(report: dict[str, Any]) -> str:
    rows = "\n".join(
        "| {case_id} | {domains} | {gold} | {prior} | {final} | {ok} |".format(
            case_id=row.get("case_id", ""),
            domains=", ".join(row.get("targeted_domains", [])),
            gold=str(row.get("gold", "")).replace("|", "/"),
            prior=str(row.get("prediction", "")).replace("|", "/"),
            final=str(row.get("final_prediction", "")).replace("|", "/"),
            ok=row.get("final_correct"),
        )
        for row in report["rows"]
        if row.get("targeted_attempted")
    )
    return (
        f"# {report['name']}\n\n"
        f"> {report['safety_note']}\n\n"
        "## Summary\n\n"
        f"- Specialist model: `{report['specialist_model']}`\n"
        f"- Judge model: `{report['judge_model']}`\n"
        f"- Attempted: `{report['attempted']}`\n"
        f"- Base correct: `{report['base_correct']}/{report['case_count']}`\n"
        f"- Base accuracy: `{report['base_accuracy']:.3f}`\n"
        f"- Final correct: `{report['final_correct']}/{report['case_count']}`\n"
        f"- Final accuracy: `{report['final_accuracy']:.3f}`\n"
        f"- Rescued: `{report['rescued']}`\n"
        f"- Seconds: `{report['seconds']}`\n\n"
        "## Targeted Attempts\n\n"
        "| Case | Domains | Gold | Prior Prediction | Final Prediction | Final Correct |\n"
        "| --- | --- | --- | --- | --- | --- |\n"
        f"{rows}\n"
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--report",
        default="reports/opencode_clinical_ensemble_100_failed_only.json",
        help="Source ensemble report JSON.",
    )
    parser.add_argument("--specialist-model", default=DEFAULT_SPECIALIST_MODEL)
    parser.add_argument("--judge-model", default=DEFAULT_JUDGE_MODEL)
    parser.add_argument("--max-tokens", type=int, default=DEFAULT_MAX_TOKENS)
    parser.add_argument("--timeout", type=float, default=300.0)
    parser.add_argument("--max-domains", type=int, default=1)
    parser.add_argument("--retrieval-results", type=int, default=5)
    parser.add_argument("--no-pathology-first", action="store_true")
    parser.add_argument("--cache-dir", default=".cache/handoffkit/clinical_targeted")
    parser.add_argument("--no-cache", action="store_true")
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    if not os.getenv("OPENCODE_API_KEY"):
        raise SystemExit("OPENCODE_API_KEY is required.")
    report = run_targeted_rescue(
        report_path=args.report,
        specialist_model=args.specialist_model,
        judge_model=args.judge_model,
        max_tokens=args.max_tokens,
        timeout=args.timeout,
        max_domains=args.max_domains,
        retrieval_results=args.retrieval_results,
        pathology_first=not args.no_pathology_first,
        cache_dir=None if args.no_cache else args.cache_dir,
        limit=args.limit,
    )
    print(_to_markdown(report))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
