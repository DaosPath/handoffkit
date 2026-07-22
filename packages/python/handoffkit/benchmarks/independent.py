"""Independent protocol benchmark — methodology + offline APIs (no leaderboard).

This suite scores **handoff protocol quality** (structure, validation, metrics),
not model IQ and not a public ranking. Results are for local/CI reproduction.
"""

from __future__ import annotations

import hashlib
import json
import time
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from handoffkit.agent import Agent
from handoffkit.benchmarks.metrics import (
    WorkflowMetricsReport,
    build_workflow_metrics,
)
from handoffkit.handoff import HandoffState
from handoffkit.protocol import HandoffProtocol
from handoffkit.quality import HandoffQualityEvaluator, HandoffQualityReport
from handoffkit.reports import write_report_files
from handoffkit.runner import Team
from handoffkit.validation import HandoffStateValidator, ValidationReport

# Bump when methodology or case set changes in a breaking way.
METHODOLOGY_ID = "handoffkit-protocol-v1"
METHODOLOGY_VERSION = "1.0.0"
DEFAULT_SEED = "handoffkit-independent-2026"


@dataclass(frozen=True)
class ProtocolTask:
    """One multi-role task in the independent protocol suite."""

    task_id: str
    title: str
    description: str
    roles: tuple[str, ...]
    """Ordered agent names; handoffs flow role[i] → role[i+1]."""

    required_decision_keywords: tuple[str, ...] = ()
    """Soft checks that appear in decisions or summaries (offline echo-friendly)."""


# Fixed public case set (methodology v1). Offline EchoProvider uses task text only.
PROTOCOL_TASKS_V1: tuple[ProtocolTask, ...] = (
    ProtocolTask(
        task_id="proto-001",
        title="Release checklist",
        description=(
            "Plan a local release checklist, implement verification steps, "
            "and review before publish. Pass structured handoffs between roles."
        ),
        roles=("Planner", "Implementer", "Reviewer"),
        required_decision_keywords=("checklist", "verify", "release"),
    ),
    ProtocolTask(
        task_id="proto-002",
        title="Incident triage",
        description=(
            "Triage a failing CI job: summarize failure, propose a fix path, "
            "and confirm rollback criteria. Keep decisions and next steps explicit."
        ),
        roles=("Oncall", "Engineer", "Lead"),
        required_decision_keywords=("failure", "fix", "rollback"),
    ),
    ProtocolTask(
        task_id="proto-003",
        title="API contract change",
        description=(
            "Propose a non-breaking API addition, implement a stub, and review "
            "compatibility notes. Prefer additive changes over renames."
        ),
        roles=("Architect", "Coder", "Reviewer"),
        required_decision_keywords=("api", "compat", "additive"),
    ),
    ProtocolTask(
        task_id="proto-004",
        title="Docs handoff",
        description=(
            "Draft a migration note, fill examples, and review for accuracy. "
            "Include important files and next steps for the writer."
        ),
        roles=("Writer", "Editor", "Approver"),
        required_decision_keywords=("docs", "example", "migration"),
    ),
    ProtocolTask(
        task_id="proto-005",
        title="Tool safety review",
        description=(
            "Review a shell tool request: check approval policy, workspace "
            "sandbox, and residual risks before execution."
        ),
        roles=("Requester", "Security", "Operator"),
        required_decision_keywords=("approval", "sandbox", "risk"),
    ),
)


@dataclass
class ProtocolTaskResult:
    """Result for one protocol task."""

    task_id: str
    title: str
    success: bool
    duration_ms: float
    handoffs: list[HandoffState] = field(default_factory=list)
    validation_ok: bool = False
    quality_score: float = 0.0
    notes: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "task_id": self.task_id,
            "title": self.title,
            "success": self.success,
            "duration_ms": self.duration_ms,
            "handoffs": [h.to_dict() for h in self.handoffs],
            "validation_ok": self.validation_ok,
            "quality_score": self.quality_score,
            "notes": list(self.notes),
            "metadata": dict(self.metadata),
        }


@dataclass
class IndependentBenchmarkReport:
    """Published independent protocol benchmark report (not a leaderboard)."""

    methodology_id: str = METHODOLOGY_ID
    methodology_version: str = METHODOLOGY_VERSION
    seed: str = DEFAULT_SEED
    success: bool = False
    task_count: int = 0
    tasks_passed: int = 0
    tasks: list[ProtocolTaskResult] = field(default_factory=list)
    validation: ValidationReport | None = None
    quality: HandoffQualityReport | None = None
    metrics: WorkflowMetricsReport | None = None
    artifacts: dict[str, str] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "kind": "independent_protocol_benchmark",
            "methodology_id": self.methodology_id,
            "methodology_version": self.methodology_version,
            "seed": self.seed,
            "success": self.success,
            "task_count": self.task_count,
            "tasks_passed": self.tasks_passed,
            "pass_rate": (self.tasks_passed / self.task_count) if self.task_count else 0.0,
            "tasks": [t.to_dict() for t in self.tasks],
            "validation": self.validation.to_dict() if self.validation else None,
            "quality": self.quality.to_dict() if self.quality else None,
            "metrics": self.metrics.to_dict() if self.metrics else None,
            "artifacts": dict(self.artifacts),
            "metadata": {
                **self.metadata,
                "leaderboard": False,
                "disclaimer": (
                    "Scores protocol handoff quality offline. "
                    "Not a public ranking of models or frameworks."
                ),
            },
        }

    def to_json(self, *, indent: int | None = 2) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=indent)

    def to_markdown(self) -> str:
        rows = "\n".join(
            f"| `{t.task_id}` | {t.title} | `{t.success}` | "
            f"`{t.quality_score:.3f}` | `{t.duration_ms:.1f}` |"
            for t in self.tasks
        )
        q = self.quality
        m = self.metrics
        return (
            f"# Independent Protocol Benchmark\n\n"
            f"- Methodology: `{self.methodology_id}` @ `{self.methodology_version}`\n"
            f"- Seed: `{self.seed}`\n"
            f"- **Not a public leaderboard** — local/CI reproducibility only\n"
            f"- Tasks passed: `{self.tasks_passed}/{self.task_count}`\n"
            f"- Overall success: `{self.success}`\n"
            f"- Handoff quality: "
            f"`{(q.grade if q else 'n/a')}` / "
            f"`{(q.score if q else 0.0):.3f}`\n"
            f"- Context loss rate: "
            f"`{(m.context_loss.loss_rate if m else 0):.2%}`\n"
            f"- Latency mean ms: `{(m.latency.mean_ms if m else 0):.1f}`\n\n"
            f"## Tasks\n\n"
            f"| ID | Title | Pass | Quality | ms |\n"
            f"| --- | --- | --- | --- | --- |\n"
            f"{rows}\n"
        )


def methodology_manifest() -> dict[str, Any]:
    """Machine-readable methodology descriptor (published with the package)."""
    return {
        "methodology_id": METHODOLOGY_ID,
        "methodology_version": METHODOLOGY_VERSION,
        "seed_default": DEFAULT_SEED,
        "leaderboard": False,
        "scoring": {
            "dimensions": [
                "handoff_validation",
                "handoff_quality",
                "context_loss",
                "latency_offline",
                "task_pass_rate",
            ],
            "pass_rule": (
                "All handoffs validate; mean quality >= 0.6; "
                "every task produces len(roles)-1 handoffs"
            ),
        },
        "tasks": [
            {
                "task_id": t.task_id,
                "title": t.title,
                "roles": list(t.roles),
                "description_sha256": hashlib.sha256(
                    t.description.encode("utf-8")
                ).hexdigest(),
            }
            for t in PROTOCOL_TASKS_V1
        ],
        "docs": "docs/python/EXTERNAL_BENCHMARK.md",
    }


def _run_protocol_task(task: ProtocolTask) -> ProtocolTaskResult:
    """Run one multi-agent offline protocol task with Echo providers."""
    agents = [
        Agent(name, f"{name} for {task.title}.", model="echo") for name in task.roles
    ]
    team = Team(agents, protocol=HandoffProtocol())
    t0 = time.perf_counter()
    result = team.run(task.description)
    duration_ms = (time.perf_counter() - t0) * 1000.0
    handoffs = list(result.handoffs or [])
    expected = max(0, len(task.roles) - 1)
    notes: list[str] = []
    if len(handoffs) != expected:
        notes.append(f"expected {expected} handoffs, got {len(handoffs)}")
    validator = HandoffStateValidator()
    val_ok = all(validator.validate(h).success for h in handoffs) if handoffs else False
    if not handoffs:
        notes.append("no handoffs produced")
    quality = (
        HandoffQualityEvaluator(min_score=0.0).evaluate_many(handoffs)
        if handoffs
        else None
    )
    q_score = float(quality.score) if quality else 0.0
    success = val_ok and len(handoffs) == expected and q_score >= 0.5
    return ProtocolTaskResult(
        task_id=task.task_id,
        title=task.title,
        success=success,
        duration_ms=duration_ms,
        handoffs=handoffs,
        validation_ok=val_ok,
        quality_score=q_score,
        notes=notes,
        metadata={"roles": list(task.roles), "final_output_chars": len(result.final_output or "")},
    )


def build_independent_benchmark(
    *,
    seed: str = DEFAULT_SEED,
    task_ids: Sequence[str] | None = None,
) -> IndependentBenchmarkReport:
    """Run the offline independent protocol suite (deterministic Echo agents)."""
    selected = list(PROTOCOL_TASKS_V1)
    if task_ids:
        want = set(task_ids)
        selected = [t for t in selected if t.task_id in want]
        if not selected:
            raise ValueError(f"no tasks matched task_ids={task_ids!r}")

    # Seed only affects metadata for v1 (Echo path is fully deterministic).
    _ = hashlib.sha256(seed.encode("utf-8")).hexdigest()

    task_results = [_run_protocol_task(t) for t in selected]
    all_handoffs = [h for tr in task_results for h in tr.handoffs]
    validator = HandoffStateValidator()
    issues = []
    for h in all_handoffs:
        issues.extend(validator.validate(h).issues)
    validation = ValidationReport(
        success=bool(all_handoffs)
        and not any(i.severity == "error" for i in issues),
        issues=issues,
        metadata={
            "validator": "IndependentProtocolBenchmark",
            "handoffs": len(all_handoffs),
        },
    )
    quality = (
        HandoffQualityEvaluator(min_score=0.6).evaluate_many(all_handoffs)
        if all_handoffs
        else None
    )
    metrics = build_workflow_metrics(
        durations_ms=[t.duration_ms for t in task_results],
        runs=[{"usage": {}} for _ in task_results],
        handoffs=all_handoffs,
        attempts=len(task_results),
        recoveries=sum(1 for t in task_results if t.success and t.notes),
        hard_failures=sum(1 for t in task_results if not t.success),
        metadata={"suite": METHODOLOGY_ID, "seed": seed},
    )
    passed = sum(1 for t in task_results if t.success)
    overall = (
        bool(task_results)
        and passed == len(task_results)
        and validation.success
        and (quality is not None and quality.score >= 0.6)
    )
    return IndependentBenchmarkReport(
        methodology_id=METHODOLOGY_ID,
        methodology_version=METHODOLOGY_VERSION,
        seed=seed,
        success=overall,
        task_count=len(task_results),
        tasks_passed=passed,
        tasks=task_results,
        validation=validation,
        quality=quality,
        metrics=metrics,
        metadata={
            "engine": "Team+EchoProvider",
            "offline": True,
            "leaderboard": False,
        },
    )


def run_independent_benchmark(
    *,
    seed: str = DEFAULT_SEED,
    output_dir: str | Path = "runs/latest",
    reports_dir: str | Path = "reports",
    task_ids: Sequence[str] | None = None,
) -> IndependentBenchmarkReport:
    """Build independent benchmark, write artifacts, return report."""
    report = build_independent_benchmark(seed=seed, task_ids=task_ids)
    run_dir = Path(output_dir)
    run_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = run_dir / "independent_methodology.json"
    report_json = run_dir / "independent_benchmark.json"
    report_md = run_dir / "independent_benchmark.md"
    manifest_path.write_text(
        json.dumps(methodology_manifest(), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    report_json.write_text(report.to_json() + "\n", encoding="utf-8")
    report_md.write_text(report.to_markdown(), encoding="utf-8")
    repo_json, repo_md = write_report_files(
        report,
        "independent_protocol_benchmark",
        reports_dir,
    )
    report.artifacts.update(
        {
            "methodology": str(manifest_path),
            "report_json": str(report_json),
            "report_md": str(report_md),
            "repo_json": str(repo_json),
            "repo_md": str(repo_md),
        }
    )
    return report
