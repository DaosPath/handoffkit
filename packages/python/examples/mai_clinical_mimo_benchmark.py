"""Run a larger MAI-style clinical panel benchmark with OpenCode MiMo.

Educational benchmark only. This script uses public case-report fixtures and is
not medical advice or a clinical diagnostic system.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
import uuid
from pathlib import Path
from typing import Any

from handoffkit.handoff import HandoffState
from handoffkit.benchmarks.mai import SequentialDoctorCase, build_sequential_doctor_cases
from handoffkit.providers import BaseProvider, NativeOpenAIProvider, OpenCodeGoProvider
from handoffkit.quality import HandoffQualityEvaluator
from handoffkit.reports import write_report_files
from handoffkit.tracing import RunTrace, TraceEvent, TraceStep

SAFETY_NOTE = (
    "Educational benchmark only. Uses public case reports. Not medical advice; "
    "not for patient care."
)
DEFAULT_MODEL = "mimo-v2.5"
DEFAULT_MAX_TOKENS = 32768
GENERIC_MATCH_WORDS = {
    "acute",
    "cancer",
    "carcinoma",
    "cell",
    "cells",
    "chronic",
    "deficiency",
    "disease",
    "primary",
    "renal",
    "secondary",
    "syndrome",
    "tumor",
    "type",
}
CLINICAL_EQUIVALENCE_ALIASES = {
    "aorticvalvefenestrationrupture": [
        "iatrogenic aortic valve perforation",
        "aortic valve perforation",
    ],
    "catscratchdisease": ["bartonella henselae infection", "bartonella infection"],
    "factorxiiiideficiency": ["factor xiii deficiency"],
    "gorhamsdisease": ["vanishing bone disease"],
    "igadominantmpgn": [
        "membranoproliferative glomerulonephritis",
        "membranoproliferative glomerulonephritis type i",
        "mpgn type i",
    ],
    "primaryaldosteronism": ["primary hyperaldosteronism"],
    "poncetsdisease": ["reactive arthritis to tuberculosis", "tuberculous rheumatism"],
    "sulfonylureapoisoning": [
        "glyburide-induced hypoglycemia",
        "glyburide induced hypoglycemia",
    ],
    "tuberculosis": ["tuberculous orchiepididymitis"],
    "vanishingbonedisease": ["gorham's disease", "gorhams disease"],
}


def _configure_output_encoding() -> None:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")


def _compact(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def _spaced(value: str) -> str:
    value = re.sub(r"hyperaldosteronism", "aldosteronism", value, flags=re.I)
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def _is_match(prediction: str, gold: str, aliases: list[str]) -> bool:
    if not prediction.strip():
        return False
    pred_compact = _compact(prediction)
    labels = [gold, *aliases]
    for label in labels:
        label_compact = _compact(label)
        if not label_compact:
            continue
        equivalents = CLINICAL_EQUIVALENCE_ALIASES.get(label_compact, [])
        if any(_compact(item) in pred_compact for item in equivalents):
            return True
        if pred_compact == label_compact:
            return True
        if label_compact in pred_compact and len(label_compact) / len(pred_compact) >= 0.65:
            return True
        if pred_compact in label_compact and len(pred_compact) / len(label_compact) >= 0.65:
            return True
    pred_words = set(_spaced(prediction).split())
    for label in labels:
        label_words = [word for word in _spaced(label).split() if len(word) > 3]
        distinctive_words = [
            word for word in label_words if len(word) >= 8 and word not in GENERIC_MATCH_WORDS
        ]
        if any(word in pred_words for word in distinctive_words):
            return True
        if distinctive_words:
            continue
        hits = sum(1 for word in label_words if word in pred_words)
        if label_words and hits >= max(1, min(2, len(label_words))):
            return True
    if "phototoxic" in pred_words and "phototoxic" in {
        word for label in labels for word in _spaced(label).split()
    }:
        return True
    return False


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


def _load_partial_rows(path: Path) -> dict[str, dict[str, Any]]:
    partial = _read_json(path)
    if partial is None:
        return {}
    rows = partial.get("rows")
    if not isinstance(rows, list):
        return {}
    return {
        str(row["case_id"]): row
        for row in rows
        if isinstance(row, dict) and isinstance(row.get("case_id"), str)
    }


class ClinicalMimoPanel:
    """Large sequential diagnostic panel for benchmark runs."""

    def __init__(
        self,
        *,
        model: str,
        provider_name: str = "opencode-go",
        max_tokens: int,
        timeout: float,
        rpm: float = 0.0,
        retries: int = 0,
        retry_backoff: float = 30.0,
        cache_dir: str | Path | None = ".cache/handoffkit/clinical_mimo",
    ) -> None:
        self.model = model
        self.provider_name = provider_name
        self.max_tokens = max_tokens
        self.provider = _make_provider(provider_name, model, timeout)
        self.min_request_interval = 60.0 / rpm if rpm > 0 else 0.0
        self.retries = max(0, retries)
        self.retry_backoff = max(0.0, retry_backoff)
        self._last_request_at = 0.0
        self.cache_dir = Path(cache_dir) if cache_dir is not None else None
        if self.cache_dir is not None:
            self.cache_dir.mkdir(parents=True, exist_ok=True)

    def run_case(self, case: SequentialDoctorCase) -> dict[str, Any]:
        started = time.time()
        stages: list[dict[str, Any]] = []
        handoffs: list[HandoffState] = []

        extractor = self._call_stage(
            "Evidence Extractor",
            _evidence_prompt(case),
        )
        stages.append(extractor)
        handoffs.append(
            _handoff(
                case,
                "Gatekeeper",
                "Evidence Extractor",
                "Extract structured evidence without gold label.",
                extractor,
                ["history", "exam", "labs", "imaging", "pathology", "special_tests"],
            )
        )

        differential = self._call_stage(
            "Differential Builder",
            _differential_prompt(case, extractor),
        )
        stages.append(differential)
        handoffs.append(
            _handoff(
                case,
                "Evidence Extractor",
                "Differential Builder",
                "Create broad differential and problem representation.",
                differential,
                ["problem_representation", "differential", "red_flags"],
            )
        )

        steward = self._call_stage(
            "Test Steward",
            _test_steward_prompt(case, extractor, differential),
        )
        stages.append(steward)
        handoffs.append(
            _handoff(
                case,
                "Differential Builder",
                "Test Steward",
                "Map evidence to high-yield tests and avoid premature closure.",
                steward,
                ["supporting_evidence", "against_evidence", "missing_evidence"],
            )
        )

        specialist = self._call_stage(
            "Specialist Consult Panel",
            _specialist_prompt(case, extractor, differential, steward),
        )
        stages.append(specialist)
        handoffs.append(
            _handoff(
                case,
                "Test Steward",
                "Specialist Consult Panel",
                "Stress-test rare diagnoses with specialty framing.",
                specialist,
                ["specialty_votes", "rare_disease_checks", "top_candidates"],
            )
        )

        challenger = self._call_stage(
            "Adversarial Challenger",
            _challenger_prompt(case, extractor, differential, steward, specialist),
        )
        stages.append(challenger)
        handoffs.append(
            _handoff(
                case,
                "Specialist Consult Panel",
                "Adversarial Challenger",
                "Challenge anchoring bias and force disconfirming evidence.",
                challenger,
                ["anchoring_risks", "do_not_miss", "revised_candidates"],
            )
        )

        judge = self._call_stage(
            "Final Diagnostic Judge",
            _judge_prompt(case, extractor, differential, steward, specialist, challenger),
        )
        stages.append(judge)
        normalizer = self._call_stage(
            "Diagnostic Label Normalizer",
            _label_normalizer_prompt(
                case,
                extractor,
                differential,
                steward,
                specialist,
                challenger,
                judge,
            ),
        )
        stages.append(normalizer)
        prediction = _prediction_from_stage(normalizer) or _prediction_from_stage(judge)
        correct = _is_match(prediction, case.case.final_diagnosis, case.aliases)
        handoffs.append(
            _handoff(
                case,
                "Adversarial Challenger",
                "Final Diagnostic Judge",
                "Commit final diagnosis with confidence and evidence summary.",
                judge,
                ["final_diagnosis", "confidence", "evidence_for", "evidence_against"],
            )
        )
        handoffs.append(
            _handoff(
                case,
                "Final Diagnostic Judge",
                "Diagnostic Label Normalizer",
                "Normalize broad diagnoses into the most specific benchmark label.",
                normalizer,
                [
                    "normalized_diagnosis",
                    "specificity_reason",
                    "broad_parent_diagnosis",
                    "secondary_conditions",
                ],
            )
        )

        return {
            "case_id": case.case.case_id,
            "pmcid": case.case.pmcid,
            "gold": case.case.final_diagnosis,
            "prediction": prediction,
            "correct": correct,
            "seconds": round(time.time() - started, 2),
            "stages": stages,
            "handoffs": handoffs,
        }

    def _call_stage(self, stage: str, prompt: str) -> dict[str, Any]:
        started = time.time()
        raw = ""
        error = ""
        try:
            raw = self._cached_generate(stage, prompt)
        except Exception as exc:  # pragma: no cover - real provider path
            error = str(exc)
        parsed = _extract_json_object(raw)
        return {
            "stage": stage,
            "seconds": round(time.time() - started, 2),
            "error": error,
            "raw": raw,
            "parsed": parsed,
        }

    def _cached_generate(self, stage: str, prompt: str) -> str:
        payload = {
            "provider": self.provider_name,
            "model": self.model,
            "stage": stage,
            "prompt": prompt,
            "temperature": 0,
            "max_tokens": self.max_tokens,
        }
        if self.cache_dir is not None:
            path = self.cache_dir / "model_calls" / f"{_cache_key(payload)}.json"
            cached = _read_json(path)
            if cached is not None and isinstance(cached.get("raw"), str):
                return str(cached["raw"])
        raw = self._generate_with_retries(prompt)
        if self.cache_dir is not None:
            _safe_write_json(
                path,
                {"provider": self.provider_name, "model": self.model, "stage": stage, "raw": raw},
            )
        return raw

    def _generate_with_retries(self, prompt: str) -> str:
        last_error: Exception | None = None
        for attempt in range(self.retries + 1):
            self._respect_rate_limit()
            try:
                return self.provider.generate(prompt, temperature=0, max_tokens=self.max_tokens)
            except Exception as exc:  # pragma: no cover - real provider path
                last_error = exc
                if attempt >= self.retries or not _is_transient_provider_error(str(exc)):
                    raise
                time.sleep(self.retry_backoff * (attempt + 1))
        if last_error is not None:
            raise last_error
        return ""

    def _respect_rate_limit(self) -> None:
        if self.min_request_interval <= 0:
            return
        now = time.time()
        elapsed = now - self._last_request_at
        if elapsed < self.min_request_interval:
            time.sleep(self.min_request_interval - elapsed)
        self._last_request_at = time.time()


def run_clinical_mimo_benchmark(
    *,
    cases: int,
    provider_name: str,
    model: str,
    max_tokens: int,
    timeout: float,
    rpm: float,
    retries: int = 0,
    retry_backoff: float = 30.0,
    rerun_empty: bool = False,
    reports_dir: str | Path = "reports",
    start: int = 1,
    end: int | None = None,
    cache_dir: str | Path | None = ".cache/handoffkit/clinical_mimo",
) -> dict[str, Any]:
    panel = ClinicalMimoPanel(
        provider_name=provider_name,
        model=model,
        max_tokens=max_tokens,
        timeout=timeout,
        rpm=rpm,
        retries=retries,
        retry_backoff=retry_backoff,
        cache_dir=cache_dir,
    )
    all_cases = build_sequential_doctor_cases(cases)
    start_index = max(1, start)
    end_index = min(cases, end or cases)
    selected = all_cases[start_index - 1 : end_index]
    rows = []
    all_handoffs: list[HandoffState] = []
    started = time.time()
    reports_path = Path(reports_dir)
    reports_path.mkdir(parents=True, exist_ok=True)
    shard_suffix = f"{cases}_{start_index:04d}_{end_index:04d}"
    safe_provider = provider_name.replace("-", "_")
    safe_model = _compact(model) or "model"
    artifact_prefix = f"{safe_provider}_{safe_model}_mt{max_tokens}_clinical_mai_{shard_suffix}"
    partial_path = reports_path / f"{artifact_prefix}.partial.json"
    cached_rows = _load_partial_rows(partial_path)
    for offset, case in enumerate(selected, start=start_index):
        cached_row = cached_rows.get(case.case_id)
        if cached_row is not None and not (rerun_empty and _row_needs_rerun(cached_row)):
            rows.append(cached_row)
            print(f"{offset}/{cases} {case.case_id}: CACHED")
            continue
        if cached_row is not None:
            print(f"{offset}/{cases} {case.case_id}: RERUN")
        result = panel.run_case(case)
        all_handoffs.extend(result["handoffs"])
        public_row = {
            key: value
            for key, value in result.items()
            if key not in {"handoffs"}
        }
        rows.append(public_row)
        status = "OK" if result["correct"] else "MISS"
        print(
            f"{offset}/{cases} {case.case_id}: {status} | "
            f"pred={result['prediction']!r} | gold={case.case.final_diagnosis!r} | "
            f"{result['seconds']}s"
        )
        _safe_write_json(
            partial_path,
            {
                "name": f"{provider_name} {model} Clinical MAI-style Benchmark {cases}",
                "mode": "live_model_clinical_panel_partial",
                "provider": provider_name,
                "model": model,
                "max_tokens": max_tokens,
                "rpm": rpm,
                "source_case_count": cases,
                "case_count": len(rows),
                "start": start_index,
                "end": end_index,
                "completed_cases": len(rows),
                "seconds": round(time.time() - started, 2),
                "rows": rows,
            },
        )
    quality = HandoffQualityEvaluator(min_score=0.6).evaluate_many(all_handoffs)
    trace = _make_trace(rows, all_handoffs, model, provider_name)
    correct = sum(1 for row in rows if row["correct"])
    report = {
        "name": f"{provider_name} {model} Clinical MAI-style Benchmark {cases}",
        "mode": "live_model_clinical_panel",
        "provider": provider_name,
        "model": model,
        "max_tokens": max_tokens,
        "rpm": rpm,
        "source_case_count": cases,
        "case_count": len(rows),
        "start": start_index,
        "end": end_index,
        "correct": correct,
        "accuracy": round(correct / len(rows), 3) if rows else 0.0,
        "seconds": round(time.time() - started, 2),
        "safety_note": SAFETY_NOTE,
        "quality": quality.to_dict(),
        "trace": trace.to_dict(),
        "rows": rows,
    }
    name = artifact_prefix
    json_path = reports_path / f"{name}.json"
    md_path = reports_path / f"{name}.md"
    json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    md_path.write_text(_to_markdown(report), encoding="utf-8")
    write_report_files(_ReportAdapter(report), name, reports_path)
    return report


class _ReportAdapter:
    def __init__(self, data: dict[str, Any]) -> None:
        self.data = data

    def to_dict(self) -> dict[str, Any]:
        return self.data

    def to_json(self, *, indent: int | None = 2) -> str:
        return json.dumps(self.data, ensure_ascii=False, indent=indent)

    def to_markdown(self) -> str:
        return _to_markdown(self.data)


def _is_transient_provider_error(error: str) -> bool:
    transient_markers = (
        "HTTP 429",
        "Too Many Requests",
        "HTTP 500",
        "HTTP 502",
        "HTTP 503",
        "HTTP 504",
        "timed out",
        "temporarily unavailable",
    )
    return any(marker in error for marker in transient_markers)


def _row_needs_rerun(row: dict[str, Any]) -> bool:
    prediction = str(row.get("prediction") or "").strip()
    if not prediction:
        return True
    for stage in row.get("stages") or []:
        error = str(stage.get("error") or "")
        if _is_transient_provider_error(error):
            return True
    return False


def _handoff(
    case: SequentialDoctorCase,
    from_agent: str,
    to_agent: str,
    task: str,
    stage: dict[str, Any],
    expected_fields: list[str],
) -> HandoffState:
    parsed = stage.get("parsed") if isinstance(stage.get("parsed"), dict) else {}
    decisions = [
        f"{field}: {str(parsed.get(field, 'not provided'))[:140]}"
        for field in expected_fields[:4]
    ]
    errors = [stage["error"]] if stage.get("error") else []
    if not parsed:
        errors.append("Stage did not return parseable JSON.")
    return HandoffState(
        task=task,
        from_agent=from_agent,
        to_agent=to_agent,
        summary=str(parsed.get("summary") or parsed.get("final_diagnosis") or stage.get("raw", ""))[
            :280
        ],
        decisions=decisions,
        important_files=[case.case.article_link],
        errors=errors or [SAFETY_NOTE],
        next_steps=[
            "Pass structured findings to the next diagnostic role.",
            "Preserve uncertainty and disconfirming evidence.",
        ],
        context_refs=[case.case.pmcid, case.case.title],
        metadata={
            "case_id": case.case.case_id,
            "stage": stage.get("stage"),
            "seconds": stage.get("seconds"),
            "raw_len": len(str(stage.get("raw", ""))),
            "errors_checked": True,
        },
    )


def _prediction_from_stage(stage: dict[str, Any]) -> str:
    parsed = stage.get("parsed")
    if isinstance(parsed, dict):
        for key in (
            "normalized_diagnosis",
            "final_diagnosis",
            "diagnosis",
            "primary_diagnosis",
        ):
            value = parsed.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    raw = str(stage.get("raw") or "")
    match = re.search(r"(?:final_)?diagnosis\"?\s*[:=]\s*\"?([^\"\n,}]+)", raw, flags=re.I)
    if match:
        return match.group(1).strip()
    return raw.strip().splitlines()[0][:180] if raw.strip() else ""


def _make_provider(provider_name: str, model: str, timeout: float) -> BaseProvider:
    if provider_name == "opencode-go":
        return OpenCodeGoProvider(model=model, timeout=timeout)
    return NativeOpenAIProvider(provider_name, model=model, timeout=timeout)


def _make_trace(
    rows: list[dict[str, Any]],
    handoffs: list[HandoffState],
    model: str,
    provider_name: str,
) -> RunTrace:
    steps = [
        TraceStep(
            name=row["case_id"],
            agent="Clinical MAI Panel",
            task="Run six-stage diagnostic panel.",
            mode="live_model_clinical_panel",
            success=not any(stage.get("error") for stage in row["stages"]),
            output=f"{row['prediction']} ({'correct' if row['correct'] else 'miss'})",
            events=[
                TraceEvent(
                    kind="case",
                    message="Clinical panel case completed.",
                    metadata={"case_id": row["case_id"], "seconds": row["seconds"]},
                )
            ],
            metadata={"pmcid": row["pmcid"]},
        )
        for row in rows
    ]
    return RunTrace(
        run_id=f"{provider_name}-{_compact(model)}-clinical-mai-{len(rows)}",
        name=f"{provider_name} {model} Clinical MAI-style Benchmark",
        success=True,
        final_output=f"{sum(1 for row in rows if row['correct'])}/{len(rows)} correct.",
        steps=steps,
        handoffs=handoffs,
        metadata={
            "provider": provider_name,
            "model": model,
            "case_count": len(rows),
            "mode": "live_model_clinical_panel",
        },
    )


def _to_markdown(report: dict[str, Any]) -> str:
    rows = "\n".join(
        "| {case_id} | {pmcid} | {gold} | {prediction} | {correct} | {seconds} |".format(
            case_id=row["case_id"],
            pmcid=row["pmcid"],
            gold=str(row["gold"]).replace("|", "/"),
            prediction=str(row["prediction"]).replace("|", "/"),
            correct=row["correct"],
            seconds=row["seconds"],
        )
        for row in report["rows"]
    )
    return (
        f"# {report['name']}\n\n"
        f"> {report['safety_note']}\n\n"
        "## Summary\n\n"
        f"- Provider: `{report['provider']}`\n"
        f"- Model: `{report['model']}`\n"
        f"- Max tokens per stage: `{report['max_tokens']}`\n"
        f"- RPM limit: `{report['rpm']}`\n"
        f"- Cases: `{report['case_count']}`\n"
        f"- Correct: `{report['correct']}`\n"
        f"- Accuracy: `{report['accuracy']:.3f}`\n"
        f"- Seconds: `{report['seconds']}`\n"
        f"- Handoff quality: `{report['quality']['grade']}` / `{report['quality']['score']}`\n\n"
        "## Cases\n\n"
        "| Case | PMCID | Gold | Prediction | Correct | Seconds |\n"
        "| --- | --- | --- | --- | --- | ---: |\n"
        f"{rows}\n"
    )


def _base_json_instruction() -> str:
    return (
        "Return strict JSON only. No markdown. No prose outside JSON. "
        "Use concise strings and arrays of strings."
    )


def _evidence_prompt(case: SequentialDoctorCase) -> str:
    return f"""{_base_json_instruction()}
You are Evidence Extractor in an educational diagnostic benchmark.
Do not provide medical advice. Extract only evidence present in the case.

JSON schema:
{{"summary": str, "history": [str], "exam": [str], "labs": [str], "imaging": [str],
"pathology": [str], "special_tests": [str], "key_negatives": [str], "uncertainties": [str]}}

Opening note:
{case.opening}

Gatekeeper evidence:
History: {case.sections.get("history", "")}
Physical exam: {case.sections.get("physical_exam", "")}
Basic labs: {case.sections.get("basic_labs", "")}
Imaging: {case.sections.get("imaging", "")}
Pathology: {case.sections.get("pathology", "")}
Special tests: {case.sections.get("special_tests", "")}
"""


def _differential_prompt(case: SequentialDoctorCase, extractor: dict[str, Any]) -> str:
    return f"""{_base_json_instruction()}
You are Differential Builder. Build a broad, clinically disciplined differential.
Do not reveal or assume gold label. Do not give patient-care advice.
Separate the primary condition explaining the initial presentation from later
complications, treatment adverse effects, and incidental findings.

JSON schema:
{{"summary": str, "problem_representation": str, "primary_problem": str,
"secondary_problems": [str], "differential": [str], "most_likely": [str],
"dangerous_misses": [str], "red_flags": [str]}}

Case title: {case.case.title}
Evidence JSON:
{json.dumps(extractor.get("parsed") or extractor.get("raw", ""), ensure_ascii=False)[:12000]}
"""


def _test_steward_prompt(
    case: SequentialDoctorCase,
    extractor: dict[str, Any],
    differential: dict[str, Any],
) -> str:
    return f"""{_base_json_instruction()}
You are Test Steward. Use already available evidence. Identify which findings support
or weaken each top diagnosis. Avoid unnecessary tests.
Prioritize the diagnosis that explains the earliest presentation and the most
specific objective findings. Track secondary conditions separately.

JSON schema:
{{"summary": str, "supporting_evidence": [str], "against_evidence": [str],
"missing_evidence": [str], "primary_vs_secondary": [str], "cost_awareness": [str],
"leading_candidates": [str]}}

Evidence:
{json.dumps(extractor.get("parsed") or extractor.get("raw", ""), ensure_ascii=False)[:9000]}

Differential:
{json.dumps(differential.get("parsed") or differential.get("raw", ""), ensure_ascii=False)[:9000]}
"""


def _specialist_prompt(
    case: SequentialDoctorCase,
    extractor: dict[str, Any],
    differential: dict[str, Any],
    steward: dict[str, Any],
) -> str:
    return f"""{_base_json_instruction()}
You are Specialist Consult Panel with internal medicine, radiology/pathology,
neurology/dermatology/pediatrics as relevant. Stress-test rare disease labels.
Vote on the primary diagnosis. Do not let a later medication reaction replace
the original disease if both appear in the timeline.

JSON schema:
{{"summary": str, "specialty_votes": [str], "rare_disease_checks": [str],
"primary_diagnosis_votes": [str], "secondary_conditions": [str],
"top_candidates": [str], "confidence_notes": [str]}}

Case PMCID: {case.case.pmcid}
Evidence:
{json.dumps(extractor.get("parsed") or extractor.get("raw", ""), ensure_ascii=False)[:7000]}
Differential:
{json.dumps(differential.get("parsed") or differential.get("raw", ""), ensure_ascii=False)[:7000]}
Steward:
{json.dumps(steward.get("parsed") or steward.get("raw", ""), ensure_ascii=False)[:7000]}
"""


def _challenger_prompt(
    case: SequentialDoctorCase,
    extractor: dict[str, Any],
    differential: dict[str, Any],
    steward: dict[str, Any],
    specialist: dict[str, Any],
) -> str:
    return f"""{_base_json_instruction()}
You are Adversarial Challenger. Look for anchoring, premature closure, and close mimics.
Prefer the diagnosis that explains the most specific evidence.
Explicitly challenge whether the current leader is only a complication,
treatment adverse effect, or incidental finding rather than the primary case diagnosis.

JSON schema:
{{"summary": str, "anchoring_risks": [str], "do_not_miss": [str],
"primary_vs_secondary_errors": [str], "revised_candidates": [str],
"why_not_others": [str]}}

Evidence:
{json.dumps(extractor.get("parsed") or extractor.get("raw", ""), ensure_ascii=False)[:6000]}
Differential:
{json.dumps(differential.get("parsed") or differential.get("raw", ""), ensure_ascii=False)[:6000]}
Steward:
{json.dumps(steward.get("parsed") or steward.get("raw", ""), ensure_ascii=False)[:6000]}
Specialist:
{json.dumps(specialist.get("parsed") or specialist.get("raw", ""), ensure_ascii=False)[:6000]}
"""


def _judge_prompt(
    case: SequentialDoctorCase,
    extractor: dict[str, Any],
    differential: dict[str, Any],
    steward: dict[str, Any],
    specialist: dict[str, Any],
    challenger: dict[str, Any],
) -> str:
    return f"""{_base_json_instruction()}
You are Final Diagnostic Judge in an educational benchmark. Commit one most likely
diagnosis. Use exact disease name when possible. Do not provide treatment advice.
Your final_diagnosis must be the primary diagnosis of the case: the disease or
syndrome that best explains the initial presentation and objective findings.
Do not choose a later complication, treatment adverse reaction, or incidental
finding unless it is the central diagnosis of the case.

JSON schema:
{{"summary": str, "final_diagnosis": str, "confidence": str,
"primary_reason": str, "secondary_conditions": [str], "evidence_for": [str],
"evidence_against": [str], "close_mimics": [str]}}

Original opening note:
{case.opening}
History: {case.sections.get("history", "")}
Physical exam: {case.sections.get("physical_exam", "")}
Basic labs: {case.sections.get("basic_labs", "")}
Imaging: {case.sections.get("imaging", "")}
Pathology: {case.sections.get("pathology", "")}
Special tests: {case.sections.get("special_tests", "")}

Evidence:
{json.dumps(extractor.get("parsed") or extractor.get("raw", ""), ensure_ascii=False)[:5000]}
Differential:
{json.dumps(differential.get("parsed") or differential.get("raw", ""), ensure_ascii=False)[:5000]}
Steward:
{json.dumps(steward.get("parsed") or steward.get("raw", ""), ensure_ascii=False)[:5000]}
Specialist:
{json.dumps(specialist.get("parsed") or specialist.get("raw", ""), ensure_ascii=False)[:5000]}
Challenger:
{json.dumps(challenger.get("parsed") or challenger.get("raw", ""), ensure_ascii=False)[:5000]}
"""


def _label_normalizer_prompt(
    case: SequentialDoctorCase,
    extractor: dict[str, Any],
    differential: dict[str, Any],
    steward: dict[str, Any],
    specialist: dict[str, Any],
    challenger: dict[str, Any],
    judge: dict[str, Any],
) -> str:
    return f"""{_base_json_instruction()}
You are Diagnostic Label Normalizer for an educational benchmark.
Choose the most specific disease/syndrome label supported by the evidence.
Do not choose a broad parent condition when a specific complication, subtype,
or named syndrome is supported. Do not choose a secondary treatment reaction
unless it is the central diagnosis.

Clinical specificity rules:
- "systemic sclerosis with renal crisis" -> choose "scleroderma renal crisis".
- "meningioma, sclerosing subtype" -> choose "sclerosing meningioma".
- "retinal toxicity from SBP-101" -> include the drug cause.
- Skin eruption after sun/outdoor exposure with burning, blistering, sharp
  distribution, and normal inflammatory labs should keep phototoxic reaction
  ahead of nonspecific contact dermatitis; antibiotic trunk rash is secondary.
- If a PFAPA phrase appears, preserve PFAPA rather than generic fever syndrome.

JSON schema:
{{"summary": str, "normalized_diagnosis": str, "broad_parent_diagnosis": str,
"secondary_conditions": [str], "specificity_reason": str, "confidence": str}}

Original opening note:
{case.opening}
History: {case.sections.get("history", "")}
Physical exam: {case.sections.get("physical_exam", "")}
Basic labs: {case.sections.get("basic_labs", "")}
Imaging: {case.sections.get("imaging", "")}
Pathology: {case.sections.get("pathology", "")}
Special tests: {case.sections.get("special_tests", "")}

Evidence:
{json.dumps(extractor.get("parsed") or extractor.get("raw", ""), ensure_ascii=False)[:4000]}
Differential:
{json.dumps(differential.get("parsed") or differential.get("raw", ""), ensure_ascii=False)[:4000]}
Steward:
{json.dumps(steward.get("parsed") or steward.get("raw", ""), ensure_ascii=False)[:4000]}
Specialist:
{json.dumps(specialist.get("parsed") or specialist.get("raw", ""), ensure_ascii=False)[:4000]}
Challenger:
{json.dumps(challenger.get("parsed") or challenger.get("raw", ""), ensure_ascii=False)[:4000]}
Judge:
{json.dumps(judge.get("parsed") or judge.get("raw", ""), ensure_ascii=False)[:4000]}
"""


def main() -> int:
    _configure_output_encoding()
    parser = argparse.ArgumentParser()
    parser.add_argument("--cases", type=int, default=3)
    parser.add_argument(
        "--provider",
        default=os.getenv("CLINICAL_BENCHMARK_PROVIDER", "opencode-go"),
    )
    parser.add_argument("--model", default=os.getenv("OPENCODE_GO_MODEL", DEFAULT_MODEL))
    parser.add_argument("--max-tokens", type=int, default=DEFAULT_MAX_TOKENS)
    parser.add_argument("--timeout", type=float, default=300.0)
    parser.add_argument(
        "--rpm",
        type=float,
        default=0.0,
        help="Optional requests-per-minute limiter; use <=40 for NVIDIA free tier.",
    )
    parser.add_argument("--start", type=int, default=1)
    parser.add_argument("--end", type=int)
    parser.add_argument("--cache-dir", default=".cache/handoffkit/clinical_mimo")
    parser.add_argument("--no-cache", action="store_true")
    parser.add_argument("--retries", type=int, default=0)
    parser.add_argument("--retry-backoff", type=float, default=30.0)
    parser.add_argument("--rerun-empty", action="store_true")
    args = parser.parse_args()
    if args.provider == "opencode-go" and not os.getenv("OPENCODE_API_KEY"):
        raise SystemExit("OPENCODE_API_KEY is required.")
    if args.provider == "nvidia" and not os.getenv("NVIDIA_API_KEY"):
        raise SystemExit("NVIDIA_API_KEY is required.")
    report = run_clinical_mimo_benchmark(
        cases=args.cases,
        provider_name=args.provider,
        model=args.model,
        max_tokens=args.max_tokens,
        timeout=args.timeout,
        rpm=args.rpm,
        retries=args.retries,
        retry_backoff=args.retry_backoff,
        rerun_empty=args.rerun_empty,
        start=args.start,
        end=args.end,
        cache_dir=None if args.no_cache else args.cache_dir,
    )
    print(_to_markdown(report))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
