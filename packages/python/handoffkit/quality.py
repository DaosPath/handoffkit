"""Deterministic handoff quality metrics."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

from handoffkit.handoff import HandoffState
from handoffkit.validation import HandoffStateValidator, ValidationReport


def _json_default(value: Any) -> Any:
    """Return readable JSON fallback for non-serializable values."""
    if hasattr(value, "to_dict"):
        return value.to_dict()
    return str(value)


@dataclass
class HandoffQualityMetric:
    """One deterministic handoff quality metric."""

    name: str
    score: float
    weight: float
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        """Serialize this metric."""
        return {
            "name": self.name,
            "score": round(self.score, 3),
            "weight": self.weight,
            "notes": self.notes,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> HandoffQualityMetric:
        """Create a quality metric from a dictionary."""
        return cls(
            name=str(data.get("name", "")),
            score=float(data.get("score", 0.0)),
            weight=float(data.get("weight", 1.0)),
            notes=data.get("notes") if isinstance(data.get("notes"), list) else [],
        )


@dataclass
class HandoffQualityReport:
    """Quality report for one or more handoff states."""

    success: bool
    score: float
    grade: str
    metrics: list[HandoffQualityMetric]
    recommendations: list[str]
    validation: ValidationReport
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Serialize this quality report."""
        return {
            "success": self.success,
            "score": round(self.score, 3),
            "grade": self.grade,
            "metrics": [metric.to_dict() for metric in self.metrics],
            "recommendations": self.recommendations,
            "validation": self.validation.to_dict(),
            "metadata": self.metadata,
        }

    def to_json(self, *, indent: int | None = 2) -> str:
        """Serialize this quality report as JSON."""
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=indent, default=_json_default)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> HandoffQualityReport:
        """Create a quality report from a dictionary."""
        metrics_data = data.get("metrics", [])
        metrics = [
            HandoffQualityMetric.from_dict(metric)
            for metric in metrics_data
            if isinstance(metric, dict)
        ]
        validation_data = data.get("validation")
        if isinstance(validation_data, dict):
            validation = ValidationReport.from_dict(validation_data)
        else:
            validation = ValidationReport(success=True)
        return cls(
            success=bool(data.get("success", True)),
            score=float(data.get("score", 0.0)),
            grade=str(data.get("grade", "")),
            metrics=metrics,
            recommendations=(
                data.get("recommendations")
                if isinstance(data.get("recommendations"), list)
                else []
            ),
            validation=validation,
            metadata=data.get("metadata") if isinstance(data.get("metadata"), dict) else {},
        )

    @classmethod
    def from_json(cls, value: str) -> HandoffQualityReport:
        """Create a quality report from JSON."""
        data = json.loads(value)
        if not isinstance(data, dict):
            raise ValueError("HandoffQualityReport JSON must decode to an object.")
        return cls.from_dict(data)

    def to_markdown(self) -> str:
        """Serialize this quality report as Markdown."""
        metrics = "\n".join(
            f"- `{metric.name}` score={metric.score:.2f} weight={metric.weight}: "
            f"{'; '.join(metric.notes) or 'ok'}"
            for metric in self.metrics
        ) or "- none"
        recommendations = "\n".join(f"- {item}" for item in self.recommendations) or "- none"
        return (
            "# Handoff Quality Report\n\n"
            f"## Success\n\n{self.success}\n\n"
            f"## Score\n\n{self.score:.3f} ({self.grade})\n\n"
            f"## Metrics\n\n{metrics}\n\n"
            f"## Recommendations\n\n{recommendations}\n\n"
            f"## Validation\n\n{self.validation.to_markdown()}"
        )


class HandoffQualityEvaluator:
    """Evaluate handoff quality with deterministic offline metrics."""

    def __init__(
        self,
        *,
        validator: HandoffStateValidator | None = None,
        min_score: float = 0.6,
        required_metrics: list[str] | None = None,
    ) -> None:
        self.validator = validator or HandoffStateValidator()
        self.min_score = min_score
        self.required_metrics = set(required_metrics or [])

    def evaluate(self, state: HandoffState) -> HandoffQualityReport:
        """Evaluate one handoff state."""
        validation = self.validator.validate(state)
        metrics = [
            self._completeness(state, validation),
            self._clarity(state),
            self._actionability(state),
            self._traceability(state),
            self._error_awareness(state),
        ]
        total_weight = sum(metric.weight for metric in metrics) or 1.0
        score = sum(metric.score * metric.weight for metric in metrics) / total_weight
        if not validation.success:
            score = min(score, 0.39)
        grade = self._grade(score)
        recommendations = self._recommendations(metrics, validation)
        required_pass = all(
            metric.score >= self.min_score
            for metric in metrics
            if metric.name in self.required_metrics
        )
        return HandoffQualityReport(
            success=validation.success and score >= self.min_score and required_pass,
            score=score,
            grade=grade,
            metrics=metrics,
            recommendations=recommendations,
            validation=validation,
            metadata={
                "handoffs": 1,
                "evaluator": self.__class__.__name__,
                "min_score": self.min_score,
                "required_metrics": sorted(self.required_metrics),
            },
        )

    def evaluate_many(self, handoffs: list[HandoffState]) -> HandoffQualityReport:
        """Evaluate a list of handoff states and aggregate scores."""
        if not handoffs:
            validation = ValidationReport(
                success=False,
                issues=[],
                metadata={"error": "no handoffs provided"},
            )
            return HandoffQualityReport(
                success=False,
                score=0.0,
                grade="F",
                metrics=[],
                recommendations=["Provide at least one handoff state."],
                validation=validation,
                metadata={"handoffs": 0, "evaluator": self.__class__.__name__},
            )
        reports = [self.evaluate(state) for state in handoffs]
        names = ["completeness", "clarity", "actionability", "traceability", "error_awareness"]
        metrics: list[HandoffQualityMetric] = []
        for name in names:
            matching = [
                metric
                for report in reports
                for metric in report.metrics
                if metric.name == name
            ]
            if not matching:
                continue
            metrics.append(
                HandoffQualityMetric(
                    name=name,
                    score=sum(metric.score for metric in matching) / len(matching),
                    weight=matching[0].weight,
                    notes=[f"average over {len(handoffs)} handoffs"],
                )
            )
        score = sum(report.score for report in reports) / len(reports)
        successful = sum(1 for report in reports if report.success)
        validation = ValidationReport(
            success=all(report.validation.success for report in reports),
            issues=[issue for report in reports for issue in report.validation.issues],
            metadata={"reports": len(reports), "successful": successful},
        )
        return HandoffQualityReport(
            success=all(report.success for report in reports),
            score=score,
            grade=self._grade(score),
            metrics=metrics,
            recommendations=self._recommendations(metrics, validation),
            validation=validation,
            metadata={
                "handoffs": len(handoffs),
                "successful": successful,
                "failed": len(reports) - successful,
                "average_score": round(score, 3),
                "evaluator": self.__class__.__name__,
                "min_score": self.min_score,
                "required_metrics": sorted(self.required_metrics),
            },
        )

    def _completeness(
        self,
        state: HandoffState,
        validation: ValidationReport,
    ) -> HandoffQualityMetric:
        notes: list[str] = []
        score = 0.0
        if validation.success:
            score += 0.3
        else:
            notes.append("contract validation failed")
        for field_name in ["summary", "decisions", "next_steps", "important_files", "context_refs"]:
            value = getattr(state, field_name)
            if value:
                score += 0.14
            else:
                notes.append(f"missing {field_name}")
        return HandoffQualityMetric("completeness", min(score, 1.0), 1.4, notes)

    def _clarity(self, state: HandoffState) -> HandoffQualityMetric:
        notes: list[str] = []
        summary_words = len(state.summary.split()) if isinstance(state.summary, str) else 0
        if summary_words >= 8:
            score = 1.0
        elif summary_words >= 3:
            score = 0.6
            notes.append("summary is short")
        else:
            score = 0.2
            notes.append("summary needs more detail")
        if any(len(item.split()) <= 1 for item in state.decisions):
            score -= 0.15
            notes.append("some decisions are too terse")
        return HandoffQualityMetric("clarity", max(score, 0.0), 1.0, notes)

    def _actionability(self, state: HandoffState) -> HandoffQualityMetric:
        notes: list[str] = []
        if not state.next_steps:
            return HandoffQualityMetric("actionability", 0.2, 1.2, ["missing next steps"])
        action_words = ("run", "write", "create", "implement", "test", "review", "fix", "verify")
        actionable = sum(
            1 for item in state.next_steps if item.strip() and item.lower().startswith(action_words)
        )
        score = 0.5 + 0.5 * (actionable / len(state.next_steps))
        if actionable < len(state.next_steps):
            notes.append("some next steps are not action-oriented")
        return HandoffQualityMetric("actionability", score, 1.2, notes)

    def _traceability(self, state: HandoffState) -> HandoffQualityMetric:
        notes: list[str] = []
        refs = len(state.important_files) + len(state.context_refs)
        if refs >= 2:
            score = 1.0
        elif refs == 1:
            score = 0.65
            notes.append("only one traceability reference")
        else:
            score = 0.25
            notes.append("missing files or context refs")
        return HandoffQualityMetric("traceability", score, 1.0, notes)

    def _error_awareness(self, state: HandoffState) -> HandoffQualityMetric:
        notes: list[str] = []
        metadata = state.metadata if isinstance(state.metadata, dict) else {}
        if state.errors:
            score = 1.0
            notes.append("errors explicitly recorded")
        elif metadata.get("errors_checked") is True:
            score = 1.0
            notes.append("metadata confirms error check")
        else:
            score = 0.55
            notes.append("no errors or error-check marker")
        return HandoffQualityMetric("error_awareness", score, 0.7, notes)

    def _grade(self, score: float) -> str:
        if score >= 0.9:
            return "A"
        if score >= 0.75:
            return "B"
        if score >= 0.6:
            return "C"
        if score >= 0.4:
            return "D"
        return "F"

    def _recommendations(
        self,
        metrics: list[HandoffQualityMetric],
        validation: ValidationReport,
    ) -> list[str]:
        recommendations: list[str] = []
        if not validation.success:
            recommendations.append("Fix validation errors before judging handoff quality.")
        for metric in metrics:
            if metric.score >= 0.75:
                continue
            if metric.name == "completeness":
                recommendations.append("Include summary, decisions, next steps, and relevant refs.")
            elif metric.name == "clarity":
                recommendations.append("Make the summary and decisions more specific.")
            elif metric.name == "actionability":
                recommendations.append("Write next steps as concrete actions.")
            elif metric.name == "traceability":
                recommendations.append("Add important_files or context_refs for follow-up work.")
            elif metric.name == "error_awareness":
                recommendations.append("Record errors or mark that errors were checked.")
        return list(dict.fromkeys(recommendations))
