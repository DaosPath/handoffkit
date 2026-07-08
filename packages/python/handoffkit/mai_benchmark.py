"""MAI-style sequential diagnostic benchmark using public open-access cases.

This is a public SDBench-lite style harness. It does not reproduce Microsoft's
private SDBench data or MAI-DxO implementation; it mirrors the mechanics with
PMC Open Access derived cases for offline demos and tests.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

from handoffkit.doctor_benchmark import (
    SAFETY_NOTE,
    SOURCE_NAME,
    SOURCE_PAPER,
    SOURCE_URL,
    DoctorBenchmarkCase,
    load_doctor_benchmark_cases,
)
from handoffkit.handoff import HandoffState
from handoffkit.quality import HandoffQualityEvaluator, HandoffQualityReport
from handoffkit.replay import ReplayRunner
from handoffkit.reports import write_report_files
from handoffkit.tracing import RunTrace, TraceEvent, TraceStep
from handoffkit.validation import HandoffStateValidator, ValidationReport

ActionKind = Literal["ask", "test", "diagnose"]


def _json_default(value: Any) -> Any:
    if hasattr(value, "to_dict"):
        return value.to_dict()
    return str(value)


def _first_words(value: str, limit: int = 48) -> str:
    words = value.replace("\n", " ").split()
    if len(words) <= limit:
        return " ".join(words)
    return " ".join(words[:limit]) + " ..."


@dataclass(frozen=True)
class MAIAction:
    """One sequential diagnostic action."""

    kind: ActionKind
    name: str
    query: str
    cost: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        """Serialize action."""
        return {
            "kind": self.kind,
            "name": self.name,
            "query": self.query,
            "cost": self.cost,
        }


@dataclass(frozen=True)
class MAIObservation:
    """Gatekeeper response to one action."""

    action: MAIAction
    content: str
    revealed_section: str

    def to_dict(self) -> dict[str, Any]:
        """Serialize observation."""
        return {
            "action": self.action.to_dict(),
            "content": self.content,
            "revealed_section": self.revealed_section,
        }


@dataclass(frozen=True)
class SequentialDoctorCase:
    """A public case transformed into sequential sections."""

    case: DoctorBenchmarkCase
    opening: str
    sections: dict[str, str]
    aliases: list[str] = field(default_factory=list)

    @property
    def case_id(self) -> str:
        """Case identifier."""
        return self.case.case_id

    def to_dict(self) -> dict[str, Any]:
        """Serialize sequential case."""
        return {
            "case": self.case.to_dict(),
            "opening": self.opening,
            "sections": self.sections,
            "aliases": self.aliases,
        }


@dataclass
class MAICaseResult:
    """Result for one MAI-style sequential case."""

    case: SequentialDoctorCase
    observations: list[MAIObservation]
    final_diagnosis: str
    correct: bool
    total_cost: float
    handoffs: list[HandoffState]

    def to_dict(self) -> dict[str, Any]:
        """Serialize case result."""
        return {
            "case": self.case.to_dict(),
            "observations": [observation.to_dict() for observation in self.observations],
            "final_diagnosis": self.final_diagnosis,
            "correct": self.correct,
            "total_cost": round(self.total_cost, 2),
            "handoffs": [handoff.to_dict() for handoff in self.handoffs],
        }


@dataclass
class MAIStyleBenchmarkReport:
    """Report for public MAI-style sequential benchmark."""

    name: str
    results: list[MAICaseResult]
    trace: RunTrace
    validation: ValidationReport
    quality: HandoffQualityReport
    artifacts: dict[str, str] = field(default_factory=dict)

    @property
    def case_count(self) -> int:
        """Number of cases."""
        return len(self.results)

    @property
    def correct_count(self) -> int:
        """Number of correct diagnoses."""
        return sum(1 for result in self.results if result.correct)

    @property
    def accuracy(self) -> float:
        """Accuracy."""
        return self.correct_count / self.case_count if self.case_count else 0.0

    @property
    def total_cost(self) -> float:
        """Total simulated diagnostic cost."""
        return sum(result.total_cost for result in self.results)

    @property
    def average_cost(self) -> float:
        """Average simulated cost per case."""
        return self.total_cost / self.case_count if self.case_count else 0.0

    def to_dict(self) -> dict[str, Any]:
        """Serialize report."""
        replay = ReplayRunner(self.trace).summary()
        return {
            "name": self.name,
            "mode": "mai_style_gold_replay",
            "source": {
                "name": SOURCE_NAME,
                "url": SOURCE_URL,
                "paper": SOURCE_PAPER,
                "note": "Public PMC Open Access derived cases; not private SDBench.",
            },
            "safety_note": SAFETY_NOTE,
            "case_count": self.case_count,
            "correct_count": self.correct_count,
            "accuracy": round(self.accuracy, 3),
            "total_cost": round(self.total_cost, 2),
            "average_cost": round(self.average_cost, 2),
            "results": [result.to_dict() for result in self.results],
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
            "| {case_id} | {pmcid} | {actions} | ${cost:.0f} | {diagnosis} |".format(
                case_id=result.case.case_id,
                pmcid=result.case.case.pmcid,
                actions=len(result.observations),
                cost=result.total_cost,
                diagnosis=result.final_diagnosis.replace("|", "/"),
            )
            for result in self.results
        )
        artifacts = "\n".join(
            f"- `{name}`: `{path}`" for name, path in sorted(self.artifacts.items())
        ) or "- generated when written"
        return (
            f"# {self.name}\n\n"
            f"> {SAFETY_NOTE}\n\n"
            "## What This Is\n\n"
            "A public MAI/SDBench-style harness using MedCaseReasoning cases. "
            "It mirrors sequential mechanics: opening note, gatekeeper, questions, "
            "tests, costs, final diagnosis, trace, and replay. It does not include "
            "private NEJM SDBench data.\n\n"
            "## Summary\n\n"
            f"- Cases: `{self.case_count}`\n"
            f"- Gold replay matches: `{self.correct_count}`\n"
            f"- Accuracy: `{self.accuracy:.3f}`\n"
            f"- Total simulated cost: `${self.total_cost:.0f}`\n"
            f"- Average simulated cost: `${self.average_cost:.0f}`\n"
            f"- Handoffs: `{len(self.trace.handoffs)}`\n"
            f"- Handoff quality: `{self.quality.grade}` / `{self.quality.score:.3f}`\n"
            f"- Replay: `{ReplayRunner(self.trace).summary().step_count}` steps\n\n"
            "## Cases\n\n"
            "| Case | PMCID | Actions | Cost | Final Diagnosis |\n"
            "| --- | --- | ---: | ---: | --- |\n"
            f"{rows}\n\n"
            "## Artifacts\n\n"
            f"{artifacts}\n"
        )


class MAIGatekeeper:
    """Reveal case information only when specific actions request it."""

    def __init__(self, case: SequentialDoctorCase) -> None:
        self.case = case
        self.revealed: set[str] = {"opening"}

    def respond(self, action: MAIAction) -> MAIObservation:
        """Reveal a section for one action."""
        section = _route_query_to_section(action)
        if action.kind == "diagnose":
            content = "Final diagnosis submitted."
            section = "diagnosis_submission"
        else:
            self.revealed.add(section)
            content = self.case.sections.get(section) or self.case.sections["full_case"]
        return MAIObservation(action=action, content=content, revealed_section=section)


class MAICostModel:
    """Simple cost model for sequential diagnosis demos."""

    costs = {
        "history": 0.0,
        "physical_exam": 0.0,
        "basic_labs": 85.0,
        "imaging": 420.0,
        "pathology": 1200.0,
        "special_tests": 650.0,
        "diagnosis_submission": 0.0,
    }

    def cost_for(self, action: MAIAction) -> float:
        """Return cost for an action."""
        section = _route_query_to_section(action)
        return self.costs.get(section, 100.0)


class MAIStyleDoctorOrchestrator:
    """Deterministic public MAI-style orchestrator for offline reports."""

    def __init__(self, *, cost_model: MAICostModel | None = None) -> None:
        self.cost_model = cost_model or MAICostModel()

    def run_case(self, case: SequentialDoctorCase) -> MAICaseResult:
        """Run one sequential case in gold-replay mode."""
        gatekeeper = MAIGatekeeper(case)
        actions = self._plan_actions(case)
        observations: list[MAIObservation] = []
        for action in actions:
            priced = MAIAction(
                kind=action.kind,
                name=action.name,
                query=action.query,
                cost=self.cost_model.cost_for(action),
            )
            observations.append(gatekeeper.respond(priced))
        diagnosis_action = MAIAction(
            kind="diagnose",
            name="final_diagnosis",
            query=case.case.final_diagnosis,
            cost=0.0,
        )
        observations.append(gatekeeper.respond(diagnosis_action))
        handoffs = self._make_handoffs(case, observations)
        return MAICaseResult(
            case=case,
            observations=observations,
            final_diagnosis=case.case.final_diagnosis,
            correct=True,
            total_cost=sum(observation.action.cost for observation in observations),
            handoffs=handoffs,
        )

    def _plan_actions(self, case: SequentialDoctorCase) -> list[MAIAction]:
        text = case.case.case_prompt.lower()
        actions = [
            MAIAction("ask", "focused_history", "history and timeline"),
            MAIAction("ask", "physical_exam", "physical examination"),
        ]
        if _has_any(text, ["laboratory", "blood", "serum", "creatinine", "count", "protein"]):
            actions.append(MAIAction("test", "basic_labs", "basic labs"))
        if _has_any(text, ["ultrasound", "ct", "mri", "radiograph", "oct", "imaging"]):
            actions.append(MAIAction("test", "imaging", "imaging"))
        if _has_any(text, ["biopsy", "histologic", "histology", "pathology", "specimen"]):
            actions.append(MAIAction("test", "pathology", "pathology"))
        if _has_any(text, ["genetic", "antibody", "pcr", "serologic", "electroretinography"]):
            actions.append(MAIAction("test", "special_tests", "special tests"))
        return actions

    def _make_handoffs(
        self,
        case: SequentialDoctorCase,
        observations: list[MAIObservation],
    ) -> list[HandoffState]:
        sections = [observation.revealed_section for observation in observations]
        action_names = [observation.action.name for observation in observations]
        base_metadata = {
            "case_id": case.case_id,
            "pmcid": case.case.pmcid,
            "mode": "mai_style_gold_replay",
            "errors_checked": True,
        }
        return [
            HandoffState(
                task=f"Generate initial hypotheses for {case.case_id}.",
                from_agent="Gatekeeper",
                to_agent="Dr. Hypothesis",
                summary=case.opening,
                decisions=["Reveal only requested case sections.", "Track every action cost."],
                important_files=[case.case.article_link],
                errors=[SAFETY_NOTE],
                next_steps=[
                    "Ask targeted history and exam questions.",
                    "Request high-yield tests.",
                ],
                context_refs=[case.case.pmcid, case.case.title],
                metadata={**base_metadata, "revealed_sections": ["opening"]},
            ),
            HandoffState(
                task=f"Choose cost-aware evidence requests for {case.case_id}.",
                from_agent="Dr. Hypothesis",
                to_agent="Dr. Test Steward",
                summary=f"Planned actions: {', '.join(action_names)}.",
                decisions=[
                    "Prefer sequential evidence over full-context reveal.",
                    "Order tests only when matching clues exist in the case.",
                ],
                important_files=[case.case.article_link],
                errors=[],
                next_steps=["Review gatekeeper observations.", "Challenge broad diagnoses."],
                context_refs=sections,
                metadata={**base_metadata, "cost": sum(item.action.cost for item in observations)},
            ),
            HandoffState(
                task=f"Challenge differential for {case.case_id}.",
                from_agent="Dr. Test Steward",
                to_agent="Dr. Challenger",
                summary=_first_words(case.case.diagnostic_reasoning, 55),
                decisions=["Use revealed evidence to challenge premature closure."],
                important_files=[case.case.article_link],
                errors=[],
                next_steps=["Commit final diagnosis.", "Write replayable report."],
                context_refs=[case.case.pmcid, case.case.final_diagnosis],
                metadata={**base_metadata, "observations": len(observations)},
            ),
            HandoffState(
                task=f"Finalize diagnosis for {case.case_id}.",
                from_agent="Dr. Challenger",
                to_agent="Final Judge",
                summary=f"Final diagnosis: {case.case.final_diagnosis}.",
                decisions=["Submit gold replay diagnosis for deterministic offline benchmark."],
                important_files=[case.case.article_link],
                errors=[SAFETY_NOTE],
                next_steps=["Score diagnosis.", "Store trace and cost report."],
                context_refs=[case.case.pmcid, case.case.final_diagnosis],
                metadata={**base_metadata, "final_diagnosis": case.case.final_diagnosis},
            ),
        ]


def build_sequential_doctor_cases(limit: int = 30) -> list[SequentialDoctorCase]:
    """Transform bundled cases into sequential gatekeeper cases."""
    return [_to_sequential_case(case) for case in load_doctor_benchmark_cases(limit)]


def build_mai_style_benchmark(limit: int = 30) -> MAIStyleBenchmarkReport:
    """Build a deterministic MAI-style public benchmark report."""
    orchestrator = MAIStyleDoctorOrchestrator()
    cases = build_sequential_doctor_cases(limit)
    results = [orchestrator.run_case(case) for case in cases]
    handoffs = [handoff for result in results for handoff in result.handoffs]
    validation = _validate_handoffs(handoffs)
    quality = HandoffQualityEvaluator(min_score=0.6).evaluate_many(handoffs)
    trace = _make_trace(results)
    return MAIStyleBenchmarkReport(
        name=f"MAI-Style Public Doctor Benchmark: {len(results)} Cases",
        results=results,
        trace=trace,
        validation=validation,
        quality=quality,
    )


def run_mai_style_benchmark(
    limit: int = 30,
    *,
    output_dir: str | Path = "runs/latest",
    reports_dir: str | Path = "reports",
) -> MAIStyleBenchmarkReport:
    """Build MAI-style benchmark, write artifacts, and return report."""
    report = build_mai_style_benchmark(limit)
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
        f"mai_style_doctor_benchmark_{report.case_count}",
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


def _to_sequential_case(case: DoctorBenchmarkCase) -> SequentialDoctorCase:
    opening = _first_words(case.case_prompt, 42)
    sections = {
        "opening": opening,
        "history": _extract_section(case.case_prompt, ["history", "presented", "denied"], 90),
        "physical_exam": _extract_section(
            case.case_prompt,
            ["examination", "exam", "revealed"],
            90,
        ),
        "basic_labs": _extract_section(
            case.case_prompt,
            ["laboratory", "serum", "blood", "creatinine", "count", "protein"],
            110,
        ),
        "imaging": _extract_section(
            case.case_prompt,
            ["ultrasound", "ct", "mri", "radiograph", "oct", "imaging"],
            120,
        ),
        "pathology": _extract_section(
            case.case_prompt,
            ["biopsy", "histologic", "histology", "pathology", "specimen"],
            120,
        ),
        "special_tests": _extract_section(
            case.case_prompt,
            ["genetic", "antibody", "pcr", "serologic", "electroretinography"],
            100,
        ),
        "full_case": _first_words(case.case_prompt, 170),
    }
    aliases = _derive_aliases(case.final_diagnosis)
    return SequentialDoctorCase(case=case, opening=opening, sections=sections, aliases=aliases)


def _extract_section(text: str, keywords: list[str], limit: int) -> str:
    sentences = [sentence.strip() for sentence in text.replace("\n", " ").split(". ")]
    matches = [
        sentence
        for sentence in sentences
        if any(keyword in sentence.lower() for keyword in keywords)
    ]
    if not matches:
        return _first_words(text, limit)
    return _first_words(". ".join(matches), limit)


def _derive_aliases(diagnosis: str) -> list[str]:
    normalized = diagnosis.replace("_", " ")
    spaced = "".join(
        f" {char}" if char.isupper() and index > 0 else char
        for index, char in enumerate(normalized)
    )
    return sorted({diagnosis, normalized, spaced})


def _route_query_to_section(action: MAIAction) -> str:
    query = f"{action.name} {action.query}".lower()
    if action.kind == "diagnose":
        return "diagnosis_submission"
    if _has_any(query, ["pathology", "biopsy", "histology", "specimen"]):
        return "pathology"
    if _has_any(query, ["imaging", "ct", "mri", "ultrasound", "radiograph", "oct"]):
        return "imaging"
    if _has_any(query, ["lab", "serum", "blood", "creatinine", "count"]):
        return "basic_labs"
    if _has_any(query, ["genetic", "antibody", "pcr", "serologic", "special"]):
        return "special_tests"
    if _has_any(query, ["exam", "physical"]):
        return "physical_exam"
    return "history"


def _has_any(text: str, needles: list[str]) -> bool:
    return any(needle in text for needle in needles)


def _validate_handoffs(handoffs: list[HandoffState]) -> ValidationReport:
    validator = HandoffStateValidator()
    reports = [validator.validate(handoff) for handoff in handoffs]
    return ValidationReport(
        success=all(report.success for report in reports),
        issues=[issue for report in reports for issue in report.issues],
        metadata={"validator": "MAIStyleBenchmark", "handoffs": len(handoffs)},
    )


def _make_trace(results: list[MAICaseResult]) -> RunTrace:
    handoffs = [handoff for result in results for handoff in result.handoffs]
    steps = [
        TraceStep(
            name="mai-style-start",
            agent="MAI-Style Harness",
            task="Load public sequential diagnostic cases.",
            mode="mai_style_gold_replay",
            success=True,
            output=f"Loaded {len(results)} cases.",
            events=[TraceEvent(kind="benchmark", message="MAI-style benchmark started.")],
        )
    ]
    for result in results:
        steps.append(
            TraceStep(
                name=f"{result.case.case_id}-gatekeeper",
                agent="Gatekeeper",
                task="Reveal requested evidence only.",
                mode="mai_style_gold_replay",
                success=True,
                output=f"{len(result.observations)} observations, cost ${result.total_cost:.0f}.",
                events=[
                    TraceEvent(
                        kind="cost",
                        message="Sequential case completed.",
                        metadata={"case_id": result.case.case_id, "cost": result.total_cost},
                    )
                ],
                metadata={
                    "case_id": result.case.case_id,
                    "final_diagnosis": result.final_diagnosis,
                    "cost": result.total_cost,
                },
            )
        )
    steps.append(
        TraceStep(
            name="mai-style-summary",
            agent="Final Judge",
            task="Summarize public MAI-style benchmark.",
            mode="mai_style_gold_replay",
            success=True,
            output=f"{sum(1 for result in results if result.correct)}/{len(results)} correct.",
            events=[TraceEvent(kind="benchmark", message="MAI-style benchmark finished.")],
        )
    )
    return RunTrace(
        run_id=f"mai-style-doctor-benchmark-{len(results)}",
        name="MAI-Style Public Doctor Benchmark",
        success=True,
        final_output=f"{len(results)} public sequential cases replayed.",
        steps=steps,
        handoffs=handoffs,
        metadata={
            "source": SOURCE_NAME,
            "mode": "mai_style_gold_replay",
            "case_count": len(results),
            "total_cost": sum(result.total_cost for result in results),
        },
    )
