"""Offline doctor-benchmark harness built from real open-access case reports.

This module is for HandoffKit workflow evaluation demos. It is not medical
advice and does not diagnose real patients.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from handoffkit.benchmarks.doctor_cases_30 import DOCTOR_CASES_30
from handoffkit.benchmarks.doctor_cases_100 import DOCTOR_CASES_100
from handoffkit.benchmarks.doctor_cases_400 import DOCTOR_CASES_400
from handoffkit.handoff import HandoffState
from handoffkit.quality import HandoffQualityEvaluator, HandoffQualityReport
from handoffkit.replay import ReplayRunner
from handoffkit.reports import write_report_files
from handoffkit.tracing import RunTrace, TraceEvent, TraceStep
from handoffkit.validation import HandoffStateValidator, ValidationReport

SOURCE_NAME = "zou-lab/MedCaseReasoning"
SOURCE_URL = "https://huggingface.co/datasets/zou-lab/MedCaseReasoning"
SOURCE_PAPER = "https://arxiv.org/abs/2505.11733"
SAFETY_NOTE = (
    "Educational benchmark harness only. Cases are from open-access case reports; "
    "this output is not medical advice and must not be used for patient care."
)


def _json_default(value: Any) -> Any:
    if hasattr(value, "to_dict"):
        return value.to_dict()
    return str(value)


def _first_words(value: str, limit: int = 44) -> str:
    words = value.replace("\n", " ").split()
    if len(words) <= limit:
        return " ".join(words)
    return " ".join(words[:limit]) + " ..."


def _reasoning_points(value: str, limit: int = 3) -> list[str]:
    points: list[str] = []
    for chunk in value.split(". "):
        item = chunk.strip()
        if not item:
            continue
        if item[0].isdigit():
            points.append(item.rstrip("."))
        if len(points) >= limit:
            break
    if points:
        return points
    return [_first_words(value, 30)]


@dataclass(frozen=True)
class DoctorBenchmarkCase:
    """One real open-access diagnostic case."""

    case_id: str
    pmcid: str
    title: str
    journal: str
    article_link: str
    publication_date: str
    case_prompt: str
    diagnostic_reasoning: str
    final_diagnosis: str

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> DoctorBenchmarkCase:
        """Create a case from fixture data."""
        return cls(
            case_id=str(data["case_id"]),
            pmcid=str(data["pmcid"]),
            title=str(data["title"]),
            journal=str(data["journal"]),
            article_link=str(data["article_link"]),
            publication_date=str(data["publication_date"]),
            case_prompt=str(data["case_prompt"]),
            diagnostic_reasoning=str(data["diagnostic_reasoning"]),
            final_diagnosis=str(data["final_diagnosis"]),
        )

    def to_dict(self) -> dict[str, Any]:
        """Serialize this case."""
        return {
            "case_id": self.case_id,
            "pmcid": self.pmcid,
            "title": self.title,
            "journal": self.journal,
            "article_link": self.article_link,
            "publication_date": self.publication_date,
            "case_prompt": self.case_prompt,
            "diagnostic_reasoning": self.diagnostic_reasoning,
            "final_diagnosis": self.final_diagnosis,
        }


@dataclass
class DoctorBenchmarkCaseResult:
    """Result for one benchmark case in gold replay mode."""

    case: DoctorBenchmarkCase
    predicted_diagnosis: str
    correct: bool
    handoffs: list[HandoffState]

    def to_dict(self) -> dict[str, Any]:
        """Serialize this case result."""
        return {
            "case": self.case.to_dict(),
            "predicted_diagnosis": self.predicted_diagnosis,
            "correct": self.correct,
            "handoffs": [handoff.to_dict() for handoff in self.handoffs],
        }


@dataclass
class DoctorBenchmarkReport:
    """Offline report for real-case doctor benchmark demos."""

    name: str
    cases: list[DoctorBenchmarkCaseResult]
    trace: RunTrace
    validation: ValidationReport
    quality: HandoffQualityReport
    artifacts: dict[str, str] = field(default_factory=dict)

    @property
    def case_count(self) -> int:
        """Number of evaluated cases."""
        return len(self.cases)

    @property
    def correct_count(self) -> int:
        """Number of gold replay matches."""
        return sum(1 for result in self.cases if result.correct)

    @property
    def accuracy(self) -> float:
        """Gold replay accuracy."""
        return self.correct_count / self.case_count if self.case_count else 0.0

    def to_dict(self) -> dict[str, Any]:
        """Serialize this benchmark report."""
        replay = ReplayRunner(self.trace).summary()
        return {
            "name": self.name,
            "source": {
                "name": SOURCE_NAME,
                "url": SOURCE_URL,
                "paper": SOURCE_PAPER,
                "license_note": "Dataset card lists MIT license; source reports are PMC OA.",
            },
            "mode": "gold_replay",
            "safety_note": SAFETY_NOTE,
            "case_count": self.case_count,
            "correct_count": self.correct_count,
            "accuracy": round(self.accuracy, 3),
            "cases": [case.to_dict() for case in self.cases],
            "trace": self.trace.to_dict(),
            "replay": replay.to_dict(),
            "validation": self.validation.to_dict(),
            "quality": self.quality.to_dict(),
            "artifacts": self.artifacts,
        }

    def to_json(self, *, indent: int | None = 2) -> str:
        """Serialize report as JSON."""
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=indent, default=_json_default)

    def to_markdown(self) -> str:
        """Serialize report as Markdown."""
        rows = "\n".join(
            "| {case_id} | {pmcid} | {diagnosis} | {journal} |".format(
                case_id=result.case.case_id,
                pmcid=result.case.pmcid,
                diagnosis=result.case.final_diagnosis.replace("|", "/"),
                journal=result.case.journal.replace("|", "/"),
            )
            for result in self.cases
        )
        artifacts = "\n".join(
            f"- `{name}`: `{path}`" for name, path in sorted(self.artifacts.items())
        ) or "- generated when written"
        return (
            f"# {self.name}\n\n"
            f"> {SAFETY_NOTE}\n\n"
            "## Source\n\n"
            f"- Dataset: [{SOURCE_NAME}]({SOURCE_URL})\n"
            f"- Paper: [{SOURCE_PAPER}]({SOURCE_PAPER})\n"
            "- Split: test\n"
            "- Mode: `gold_replay` (replays known clinician-authored answers; "
            "does not claim model diagnostic accuracy)\n\n"
            "## Summary\n\n"
            f"- Cases: `{self.case_count}`\n"
            f"- Gold replay matches: `{self.correct_count}`\n"
            f"- Accuracy: `{self.accuracy:.3f}`\n"
            f"- Validation: `{self.validation.success}`\n"
            f"- Handoff quality: `{self.quality.grade}` / `{self.quality.score:.3f}`\n"
            f"- Replay: `{ReplayRunner(self.trace).summary().step_count}` steps, "
            f"`{ReplayRunner(self.trace).summary().handoff_count}` handoffs\n\n"
            "## Cases\n\n"
            "| Case | PMCID | Gold Diagnosis | Journal |\n"
            "| --- | --- | --- | --- |\n"
            f"{rows}\n\n"
            "## Artifacts\n\n"
            f"{artifacts}\n"
        )


def load_doctor_benchmark_cases(limit: int = 30) -> list[DoctorBenchmarkCase]:
    """Load real open-access cases bundled for offline benchmark demos."""
    if limit < 1:
        raise ValueError("limit must be at least 1")
    if limit <= len(DOCTOR_CASES_30):
        source = DOCTOR_CASES_30
    elif limit <= len(DOCTOR_CASES_100):
        source = DOCTOR_CASES_100
    else:
        source = DOCTOR_CASES_400
    raw_cases = source[: min(limit, len(source))]
    return [DoctorBenchmarkCase.from_dict(item) for item in raw_cases]


def build_doctor_benchmark(limit: int = 30) -> DoctorBenchmarkReport:
    """Build deterministic benchmark report without provider calls."""
    cases = load_doctor_benchmark_cases(limit)
    results = [_build_case_result(case) for case in cases]
    handoffs = [handoff for result in results for handoff in result.handoffs]
    validation = _validate_handoffs(handoffs)
    quality = HandoffQualityEvaluator(min_score=0.6).evaluate_many(handoffs)
    trace = _make_trace(results)
    return DoctorBenchmarkReport(
        name=f"Doctor Benchmark: {len(cases)} Real Open-Access Cases",
        cases=results,
        trace=trace,
        validation=validation,
        quality=quality,
    )

def _validate_handoffs(handoffs: list[HandoffState]) -> ValidationReport:
    validator = HandoffStateValidator()
    reports = [validator.validate(handoff) for handoff in handoffs]
    return ValidationReport(
        success=all(report.success for report in reports),
        issues=[issue for report in reports for issue in report.issues],
        metadata={"validator": "DoctorBenchmark", "handoffs": len(handoffs)},
    )

def run_doctor_benchmark(
    limit: int = 30,
    *,
    output_dir: str | Path = "runs/latest",
    reports_dir: str | Path = "reports",
) -> DoctorBenchmarkReport:
    """Build benchmark, write artifacts, and return report."""
    report = build_doctor_benchmark(limit)
    run_dir = Path(output_dir)
    run_dir.mkdir(parents=True, exist_ok=True)
    trace_path = run_dir / "trace.json"
    report_json_path = run_dir / "report.json"
    report_md_path = run_dir / "report.md"
    trace_path.write_text(report.trace.to_json(), encoding="utf-8")
    report_json_path.write_text(report.to_json(), encoding="utf-8")
    report_md_path.write_text(report.to_markdown(), encoding="utf-8")
    repo_json_path, repo_md_path = write_report_files(
        report,
        f"doctor_benchmark_{report.case_count}",
        reports_dir,
    )
    report.artifacts.update(
        {
            "run_trace": str(trace_path),
            "run_report_json": str(report_json_path),
            "run_report_md": str(report_md_path),
            "report_json": str(repo_json_path),
            "report_md": str(repo_md_path),
        }
    )
    report_json_path.write_text(report.to_json(), encoding="utf-8")
    report_md_path.write_text(report.to_markdown(), encoding="utf-8")
    repo_json_path.write_text(report.to_json(), encoding="utf-8")
    repo_md_path.write_text(report.to_markdown(), encoding="utf-8")
    return report


def _build_case_result(case: DoctorBenchmarkCase) -> DoctorBenchmarkCaseResult:
    gatekeeper_handoff = HandoffState(
        task=f"Evaluate diagnostic case {case.case_id} without revealing the gold label.",
        from_agent="Gatekeeper",
        to_agent="Diagnostic Panel",
        summary=_first_words(case.case_prompt, 50),
        decisions=[
            "Reveal only case-presentation evidence to the diagnostic panel.",
            "Keep final diagnosis hidden until judge stage.",
            "Preserve article provenance with PMCID and source link.",
        ],
        important_files=[case.article_link],
        errors=[SAFETY_NOTE],
        next_steps=[
            "Review case presentation evidence.",
            "Create a differential diagnosis.",
            "Pass uncertainty and missing evidence to the judge.",
        ],
        context_refs=[case.pmcid, case.title],
        metadata={
            "case_id": case.case_id,
            "source": SOURCE_NAME,
            "journal": case.journal,
            "publication_date": case.publication_date,
            "gold_hidden": True,
            "errors_checked": True,
        },
    )
    judge_handoff = HandoffState(
        task=f"Judge diagnostic reasoning for case {case.case_id}.",
        from_agent="Clinician Reasoning",
        to_agent="Benchmark Judge",
        summary=_first_words(case.diagnostic_reasoning, 46),
        decisions=_reasoning_points(case.diagnostic_reasoning),
        important_files=[case.article_link],
        errors=[SAFETY_NOTE],
        next_steps=[
            "Compare predicted diagnosis with the gold diagnosis.",
            "Record diagnostic accuracy and reasoning provenance.",
            "Write replayable benchmark report.",
        ],
        context_refs=[case.pmcid, case.title, case.final_diagnosis],
        metadata={
            "case_id": case.case_id,
            "source": SOURCE_NAME,
            "final_diagnosis": case.final_diagnosis,
            "mode": "gold_replay",
            "errors_checked": True,
        },
    )
    return DoctorBenchmarkCaseResult(
        case=case,
        predicted_diagnosis=case.final_diagnosis,
        correct=True,
        handoffs=[gatekeeper_handoff, judge_handoff],
    )


def _make_trace(results: list[DoctorBenchmarkCaseResult]) -> RunTrace:
    steps: list[TraceStep] = [
        TraceStep(
            name="benchmark-start",
            agent="Benchmark Harness",
            task="Load 30 real open-access diagnostic cases.",
            mode="gold_replay",
            success=True,
            output=f"Loaded {len(results)} MedCaseReasoning cases.",
            events=[TraceEvent(kind="benchmark", message="Doctor benchmark started.")],
        )
    ]
    handoffs: list[HandoffState] = []
    for index, result in enumerate(results, start=1):
        for handoff in result.handoffs:
            handoffs.append(handoff)
            steps.append(
                TraceStep(
                    name=f"{result.case.case_id}-{handoff.to_agent.lower().replace(' ', '-')}",
                    agent=handoff.to_agent,
                    task=handoff.task,
                    mode="gold_replay",
                    success=True,
                    output=handoff.summary,
                    handoff=handoff,
                    events=[
                        TraceEvent(
                            kind="case",
                            message=f"Processed case {index}/{len(results)}.",
                            metadata={"case_id": result.case.case_id, "pmcid": result.case.pmcid},
                        )
                    ],
                    metadata={"case_id": result.case.case_id},
                )
            )
    steps.append(
        TraceStep(
            name="benchmark-summary",
            agent="Benchmark Judge",
            task="Summarize gold replay benchmark.",
            mode="gold_replay",
            success=True,
            output=f"{len(results)} real cases replayed with gold labels.",
            events=[TraceEvent(kind="benchmark", message="Doctor benchmark finished.")],
        )
    )
    return RunTrace(
        run_id="doctor-benchmark-30",
        name="Doctor Benchmark: Real Open-Access Cases",
        success=True,
        final_output=f"{len(results)} MedCaseReasoning cases replayed.",
        steps=steps,
        handoffs=handoffs,
        metadata={
            "source": SOURCE_NAME,
            "source_url": SOURCE_URL,
            "mode": "gold_replay",
            "case_count": len(results),
            "safety_note": SAFETY_NOTE,
        },
    )


