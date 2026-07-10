"""Workflow metrics for external credibility (P2).

Offline-friendly aggregates for cost, latency, context loss, and recovery.
Not a substitute for independent third-party benchmarks.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass
class LatencyStats:
    """Latency distribution in milliseconds."""

    count: int
    mean_ms: float
    p50_ms: float
    p95_ms: float
    max_ms: float

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class CostStats:
    """Token/cost rollup (provider-reported or estimated)."""

    runs: int
    total_prompt_tokens: int = 0
    total_completion_tokens: int = 0
    total_tokens: int = 0
    total_cost_usd: float = 0.0
    currency: str = "USD"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class ContextLossStats:
    """How often required handoff fields are missing across transfers."""

    handoffs: int
    missing_summary: int = 0
    missing_decisions: int = 0
    missing_next_steps: int = 0
    empty_important_files: int = 0

    @property
    def loss_rate(self) -> float:
        if self.handoffs <= 0:
            return 0.0
        bad = (
            self.missing_summary
            + self.missing_decisions
            + self.missing_next_steps
            + self.empty_important_files
        )
        # normalize to [0,1] roughly by 4 checks per handoff
        return min(1.0, bad / (self.handoffs * 4))

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["loss_rate"] = round(self.loss_rate, 4)
        return d


@dataclass
class RecoveryStats:
    """Retries / repairs / failed-then-succeeded patterns."""

    attempts: int = 0
    recoveries: int = 0
    hard_failures: int = 0

    @property
    def recovery_rate(self) -> float:
        if self.attempts <= 0:
            return 0.0
        return self.recoveries / self.attempts

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["recovery_rate"] = round(self.recovery_rate, 4)
        return d


@dataclass
class WorkflowMetricsReport:
    """Combined metrics report for a batch of runs."""

    success: bool
    latency: LatencyStats
    cost: CostStats
    context_loss: ContextLossStats
    recovery: RecoveryStats
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "success": self.success,
            "latency": self.latency.to_dict(),
            "cost": self.cost.to_dict(),
            "context_loss": self.context_loss.to_dict(),
            "recovery": self.recovery.to_dict(),
            "metadata": self.metadata,
        }

    def to_markdown(self) -> str:
        lines = [
            "# Workflow Metrics Report",
            "",
            f"- Success: `{self.success}`",
            f"- Latency mean/p95: `{self.latency.mean_ms:.1f}` / `{self.latency.p95_ms:.1f}` ms",
            (
                f"- Total tokens: `{self.cost.total_tokens}` · "
                f"cost USD: `{self.cost.total_cost_usd:.4f}`"
            ),
            f"- Context loss rate: `{self.context_loss.loss_rate:.2%}`",
            f"- Recovery rate: `{self.recovery.recovery_rate:.2%}`",
        ]
        return "\n".join(lines) + "\n"


def _percentile(sorted_vals: list[float], p: float) -> float:
    if not sorted_vals:
        return 0.0
    if len(sorted_vals) == 1:
        return float(sorted_vals[0])
    k = (len(sorted_vals) - 1) * p
    f = int(k)
    c = min(f + 1, len(sorted_vals) - 1)
    if f == c:
        return float(sorted_vals[f])
    return float(sorted_vals[f] + (sorted_vals[c] - sorted_vals[f]) * (k - f))


def latency_stats(durations_ms: Sequence[float]) -> LatencyStats:
    vals = sorted(float(x) for x in durations_ms if x is not None)
    if not vals:
        return LatencyStats(0, 0.0, 0.0, 0.0, 0.0)
    return LatencyStats(
        count=len(vals),
        mean_ms=sum(vals) / len(vals),
        p50_ms=_percentile(vals, 0.5),
        p95_ms=_percentile(vals, 0.95),
        max_ms=vals[-1],
    )


def cost_stats(runs: Sequence[dict[str, Any]]) -> CostStats:
    """Aggregate usage dicts shaped like Studio/provider usage blocks."""
    out = CostStats(runs=len(runs))
    for run in runs:
        usage = run.get("usage") if isinstance(run, dict) else None
        if not isinstance(usage, dict):
            continue
        out.total_prompt_tokens += int(usage.get("prompt_tokens") or usage.get("promptTokens") or 0)
        out.total_completion_tokens += int(
            usage.get("completion_tokens") or usage.get("completionTokens") or 0
        )
        out.total_tokens += int(usage.get("total_tokens") or usage.get("totalTokens") or 0)
        out.total_cost_usd += float(usage.get("cost_usd") or usage.get("costUsd") or 0.0)
    if out.total_tokens == 0:
        out.total_tokens = out.total_prompt_tokens + out.total_completion_tokens
    return out


def context_loss_stats(handoffs: Sequence[Any]) -> ContextLossStats:
    """Score handoff completeness (missing fields = context loss signals)."""
    stats = ContextLossStats(handoffs=len(handoffs))
    for h in handoffs:
        data = h.to_dict() if hasattr(h, "to_dict") else dict(h or {})
        if not str(data.get("summary") or "").strip():
            stats.missing_summary += 1
        decisions = data.get("decisions") or []
        if not decisions:
            stats.missing_decisions += 1
        next_steps = data.get("next_steps") or data.get("nextSteps") or []
        if not next_steps:
            stats.missing_next_steps += 1
        files = data.get("important_files") or data.get("importantFiles") or []
        if not files:
            stats.empty_important_files += 1
    return stats


def recovery_stats(
    *,
    attempts: int,
    recoveries: int,
    hard_failures: int,
) -> RecoveryStats:
    return RecoveryStats(
        attempts=max(0, attempts),
        recoveries=max(0, recoveries),
        hard_failures=max(0, hard_failures),
    )


def build_workflow_metrics(
    *,
    durations_ms: Sequence[float] = (),
    runs: Sequence[dict[str, Any]] = (),
    handoffs: Sequence[Any] = (),
    attempts: int = 0,
    recoveries: int = 0,
    hard_failures: int = 0,
    metadata: dict[str, Any] | None = None,
) -> WorkflowMetricsReport:
    """Compose a metrics report from offline-friendly inputs."""
    lat = latency_stats(durations_ms)
    cost = cost_stats(runs)
    ctx = context_loss_stats(handoffs)
    rec = recovery_stats(
        attempts=attempts or len(runs) or lat.count,
        recoveries=recoveries,
        hard_failures=hard_failures,
    )
    return WorkflowMetricsReport(
        success=hard_failures == 0,
        latency=lat,
        cost=cost,
        context_loss=ctx,
        recovery=rec,
        metadata=metadata or {"method": "handoffkit.benchmarks.metrics"},
    )
