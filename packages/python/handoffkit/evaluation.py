"""Offline workflow evaluation reports for HandoffKit."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

from handoffkit.handoff import HandoffState
from handoffkit.quality import HandoffQualityEvaluator
from handoffkit.recipes import RecipeRunResult
from handoffkit.replay import ReplayRunner
from handoffkit.schemas import TeamRunResult
from handoffkit.tool_execution import ToolExecutionReport, ToolResult
from handoffkit.tracing import RunTrace
from handoffkit.validation import HandoffStateValidator, ValidationReport


def _json_default(value: Any) -> Any:
    """Return readable JSON fallback for non-serializable values."""
    if hasattr(value, "to_dict"):
        return value.to_dict()
    return str(value)


@dataclass
class EvaluationCheck:
    """One named offline evaluation check."""

    name: str
    passed: bool
    message: str
    severity: str = "error"
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Serialize this check."""
        return {
            "name": self.name,
            "passed": self.passed,
            "message": self.message,
            "severity": self.severity,
            "metadata": self.metadata,
        }


@dataclass
class EvaluationResult:
    """Result for one evaluated workflow artifact."""

    target: str
    success: bool
    checks: list[EvaluationCheck] = field(default_factory=list)
    score: float = 0.0
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Serialize this result."""
        return {
            "target": self.target,
            "success": self.success,
            "checks": [check.to_dict() for check in self.checks],
            "score": round(self.score, 3),
            "metadata": self.metadata,
        }


@dataclass
class WorkflowEvaluationReport:
    """Reusable evaluation report for workflow readiness."""

    success: bool
    score: float
    grade: str
    results: list[EvaluationResult] = field(default_factory=list)
    recommendations: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Serialize this report."""
        return {
            "success": self.success,
            "score": round(self.score, 3),
            "grade": self.grade,
            "results": [result.to_dict() for result in self.results],
            "recommendations": self.recommendations,
            "metadata": self.metadata,
        }

    def to_json(self, *, indent: int | None = 2) -> str:
        """Serialize this report as JSON."""
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=indent, default=_json_default)

    def to_markdown(self) -> str:
        """Serialize this report as Markdown."""
        results = "\n".join(
            (
                f"- `{result.target}` success={result.success} "
                f"score={result.score:.2f} checks={len(result.checks)}"
            )
            for result in self.results
        ) or "- none"
        checks = "\n".join(
            (
                f"- `{check.name}` passed={check.passed} "
                f"severity={check.severity}: {check.message}"
            )
            for result in self.results
            for check in result.checks
        ) or "- none"
        recommendations = "\n".join(f"- {item}" for item in self.recommendations) or "- none"
        return (
            "# Workflow Evaluation Report\n\n"
            f"## Success\n\n{self.success}\n\n"
            f"## Score\n\n{self.score:.3f} ({self.grade})\n\n"
            f"## Results\n\n{results}\n\n"
            f"## Checks\n\n{checks}\n\n"
            f"## Recommendations\n\n{recommendations}\n"
        )


class WorkflowEvaluator:
    """Evaluate workflow artifacts with deterministic offline checks."""

    def __init__(
        self,
        *,
        min_score: float = 0.75,
        handoff_min_score: float = 0.6,
    ) -> None:
        self.min_score = min_score
        self.handoff_min_score = handoff_min_score
        self.handoff_validator = HandoffStateValidator()
        self.quality_evaluator = HandoffQualityEvaluator(min_score=handoff_min_score)

    def evaluate(self, target: Any) -> WorkflowEvaluationReport:
        """Evaluate one workflow artifact."""
        if isinstance(target, RunTrace):
            result = self._evaluate_trace(target)
        elif isinstance(target, TeamRunResult):
            result = self._evaluate_team_result(target)
        elif isinstance(target, RecipeRunResult):
            result = self._evaluate_recipe_result(target)
        elif isinstance(target, ToolExecutionReport):
            result = self._evaluate_tool_report(target)
        elif self._is_handoff_list(target):
            result = self._evaluate_handoffs(list(target))
        else:
            result = EvaluationResult(
                target=target.__class__.__name__,
                success=False,
                checks=[
                    EvaluationCheck(
                        "supported_target",
                        False,
                        "target must be TeamRunResult, RecipeRunResult, RunTrace, "
                        "ToolExecutionReport, or a list of HandoffState",
                    )
                ],
                score=0.0,
            )
        return self._report([result])

    def evaluate_many(self, targets: list[Any]) -> WorkflowEvaluationReport:
        """Evaluate multiple workflow artifacts and aggregate results."""
        if not targets:
            return WorkflowEvaluationReport(
                success=False,
                score=0.0,
                grade="F",
                results=[],
                recommendations=["Provide at least one workflow artifact to evaluate."],
                metadata={"targets": 0, "evaluator": self.__class__.__name__},
            )
        results = [self.evaluate(target).results[0] for target in targets]
        return self._report(results)

    def from_report_json(self, payload: dict[str, Any]) -> WorkflowEvaluationReport:
        """Evaluate a serialized trace/report JSON object."""
        if {"run_id", "steps", "final_output"}.issubset(payload):
            return self.evaluate(RunTrace.from_dict(payload))
        if "handoffs" in payload and isinstance(payload.get("handoffs"), list):
            handoffs = [
                HandoffState.from_dict(item)
                for item in payload["handoffs"]
                if isinstance(item, dict)
            ]
            return self.evaluate(handoffs)
        return self.evaluate(payload)

    def _evaluate_team_result(self, result: TeamRunResult) -> EvaluationResult:
        trace = RunTrace.from_team_result(result, name="team-evaluation")
        checks = [
            EvaluationCheck(
                "team_output",
                bool(result.final_output),
                (
                    "team produced final output"
                    if result.final_output
                    else "team final output is empty"
                ),
            ),
            EvaluationCheck(
                "agent_outputs",
                bool(result.agent_outputs),
                "team recorded agent outputs"
                if result.agent_outputs
                else "team recorded no agent outputs",
            ),
        ]
        checks.extend(self._handoff_checks(result.handoffs))
        checks.extend(self._trace_checks(trace))
        return self._result("TeamRunResult", checks, {"handoffs": len(result.handoffs)})

    def _evaluate_recipe_result(self, result: RecipeRunResult) -> EvaluationResult:
        trace = RunTrace.from_recipe_result(result)
        checks = [
            EvaluationCheck(
                "recipe_success",
                result.success,
                "recipe run succeeded" if result.success else "recipe run failed",
            ),
            EvaluationCheck(
                "recipe_steps",
                bool(result.step_results),
                "recipe recorded step results"
                if result.step_results
                else "recipe recorded no step results",
            ),
        ]
        checks.extend(self._handoff_checks(result.handoff_states))
        checks.extend(self._tool_result_checks(result.tool_results))
        checks.extend(self._trace_checks(trace))
        return self._result("RecipeRunResult", checks, {"recipe": result.recipe_name})

    def _evaluate_trace(self, trace: RunTrace) -> EvaluationResult:
        checks = self._trace_checks(trace)
        checks.extend(self._handoff_checks(trace.handoffs))
        for step in trace.steps:
            checks.extend(self._tool_result_checks(step.tool_results))
        replay = ReplayRunner(trace).summary()
        checks.append(
            EvaluationCheck(
                "replay_summary",
                replay.step_count == len(trace.steps),
                "replay summary inspected trace without execution",
                metadata=replay.to_dict(),
            )
        )
        return self._result("RunTrace", checks, {"run_id": trace.run_id, "name": trace.name})

    def _evaluate_tool_report(self, report: ToolExecutionReport) -> EvaluationResult:
        checks = [
            EvaluationCheck(
                "tool_report_success",
                report.success,
                "tool report succeeded" if report.success else "tool report failed",
            ),
            EvaluationCheck(
                "tool_steps",
                bool(report.steps),
                "tool report recorded steps" if report.steps else "tool report recorded no steps",
            ),
        ]
        checks.extend(self._tool_result_checks(report.tool_results))
        return self._result("ToolExecutionReport", checks, {"agent": report.agent_name})

    def _evaluate_handoffs(self, handoffs: list[HandoffState]) -> EvaluationResult:
        checks = self._handoff_checks(handoffs)
        return self._result("HandoffStateList", checks, {"handoffs": len(handoffs)})

    def _handoff_checks(self, handoffs: list[Any]) -> list[EvaluationCheck]:
        if not handoffs:
            return [
                EvaluationCheck(
                    "handoffs_present",
                    False,
                    "no handoff states were recorded",
                    severity="warning",
                )
            ]
        checks = [
            EvaluationCheck(
                "handoffs_present",
                True,
                f"{len(handoffs)} handoff state(s) recorded",
                severity="info",
            )
        ]
        states = [item for item in handoffs if isinstance(item, HandoffState)]
        for index, state in enumerate(states):
            report = self.handoff_validator.validate(state)
            checks.append(self._validation_check(f"handoff_{index + 1}_contract", report))
        if states:
            quality = self.quality_evaluator.evaluate_many(states)
            checks.append(
                EvaluationCheck(
                    "handoff_quality",
                    quality.success,
                    f"handoff quality score {quality.score:.3f}",
                    metadata=quality.to_dict(),
                )
            )
        return checks

    def _trace_checks(self, trace: RunTrace) -> list[EvaluationCheck]:
        return [
            EvaluationCheck(
                "trace_success",
                trace.success,
                "trace succeeded" if trace.success else "trace indicates failure",
            ),
            EvaluationCheck(
                "trace_steps",
                bool(trace.steps),
                "trace recorded steps" if trace.steps else "trace recorded no steps",
            ),
            EvaluationCheck(
                "trace_final_output",
                bool(trace.final_output),
                "trace has final output" if trace.final_output else "trace final output is empty",
            ),
        ]

    def _tool_result_checks(self, results: list[Any]) -> list[EvaluationCheck]:
        checks = []
        for index, result in enumerate(results):
            if isinstance(result, ToolResult):
                checks.append(
                    EvaluationCheck(
                        f"tool_result_{index + 1}",
                        result.success,
                        (
                            f"tool {result.tool_name} succeeded"
                            if result.success
                            else f"tool {result.tool_name} failed: {result.error or 'unknown'}"
                        ),
                        metadata=result.to_dict(),
                    )
                )
        return checks

    def _validation_check(self, name: str, report: ValidationReport) -> EvaluationCheck:
        issues = "; ".join(issue.message for issue in report.errors)
        return EvaluationCheck(
            name,
            report.success,
            "contract validation passed" if report.success else issues or "contract failed",
            metadata=report.to_dict(),
        )

    def _result(
        self,
        target: str,
        checks: list[EvaluationCheck],
        metadata: dict[str, Any] | None = None,
    ) -> EvaluationResult:
        blocking = [check for check in checks if check.severity == "error"]
        passed = sum(1 for check in blocking if check.passed)
        score = passed / len(blocking) if blocking else 1.0
        success = score >= self.min_score and all(check.passed for check in blocking)
        return EvaluationResult(
            target=target,
            success=success,
            checks=checks,
            score=score,
            metadata=metadata or {},
        )

    def _report(self, results: list[EvaluationResult]) -> WorkflowEvaluationReport:
        score = sum(result.score for result in results) / len(results) if results else 0.0
        success = (
            bool(results)
            and all(result.success for result in results)
            and score >= self.min_score
        )
        recommendations = self._recommendations(results)
        return WorkflowEvaluationReport(
            success=success,
            score=score,
            grade=self._grade(score),
            results=results,
            recommendations=recommendations,
            metadata={
                "targets": len(results),
                "evaluator": self.__class__.__name__,
                "min_score": self.min_score,
                "handoff_min_score": self.handoff_min_score,
            },
        )

    def _recommendations(self, results: list[EvaluationResult]) -> list[str]:
        recommendations: list[str] = []
        for result in results:
            for check in result.checks:
                if check.passed or check.severity != "error":
                    continue
                if "handoff" in check.name:
                    recommendations.append("Improve handoff contracts and quality before release.")
                elif "trace" in check.name:
                    recommendations.append(
                        "Record complete run traces with steps and final output."
                    )
                elif "tool" in check.name:
                    recommendations.append("Resolve failed tool calls or tool execution reports.")
                elif "recipe" in check.name:
                    recommendations.append(
                        "Fix failing recipe steps before accepting the workflow."
                    )
                else:
                    recommendations.append(check.message)
        return list(dict.fromkeys(recommendations)) or [
            "Workflow artifacts passed offline evaluation."
        ]

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

    def _is_handoff_list(self, target: Any) -> bool:
        return isinstance(target, list) and all(isinstance(item, HandoffState) for item in target)
