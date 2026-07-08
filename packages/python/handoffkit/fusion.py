"""Fusion-style panel orchestration helpers.

This module is inspired by multi-model deliberation patterns: a task is sent to
several model roles, then a deterministic judge summarizes consensus,
contradictions, gaps, and a final recommendation. It is offline by default in
the CLI demo; real provider calls are opt-in.
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

from handoffkit.errors import StateTransferError
from handoffkit.providers import ModelCandidate, ProviderSelector
from handoffkit.reports import write_report_files

SAFETY_NOTE = (
    "Research-only orchestration demo. Not medical advice, not clinical "
    "validation, and not for patient care."
)
DEFAULT_FUSION_TASK = (
    "Design a next-pass strategy for a research-only clinical benchmark that "
    "scored 233/400 with MiMo. Improve reliability without using gold labels "
    "or making clinical claims."
)
DEFAULT_FUSION_MODELS = "mimo-v2.5,deepseek-v4-pro,glm-5.2,qwen3.7-max"


@dataclass(frozen=True)
class PanelResponse:
    """One model/role response in the fusion panel."""

    model: str
    role: str
    answer: str
    strengths: list[str] = field(default_factory=list)
    risks: list[str] = field(default_factory=list)
    confidence: str = "medium"

    def to_dict(self) -> dict[str, object]:
        """Return a JSON-friendly representation."""
        return {
            "model": self.model,
            "role": self.role,
            "answer": self.answer,
            "strengths": list(self.strengths),
            "risks": list(self.risks),
            "confidence": self.confidence,
        }


@dataclass(frozen=True)
class FusionReport:
    """Structured output from the local fusion judge."""

    success: bool
    task: str
    mode: str
    panel: list[PanelResponse]
    consensus: list[str]
    contradictions: list[str]
    coverage_gaps: list[str]
    unique_insights: list[str]
    blind_spots: list[str]
    final_answer: str
    safety_note: str = SAFETY_NOTE

    def to_dict(self) -> dict[str, object]:
        """Return a JSON-friendly representation."""
        return {
            "success": self.success,
            "task": self.task,
            "mode": self.mode,
            "safety_note": self.safety_note,
            "panel": [item.to_dict() for item in self.panel],
            "analysis": {
                "consensus": list(self.consensus),
                "contradictions": list(self.contradictions),
                "coverage_gaps": list(self.coverage_gaps),
                "unique_insights": list(self.unique_insights),
                "blind_spots": list(self.blind_spots),
            },
            "final_answer": self.final_answer,
        }

    def to_json(self) -> str:
        """Serialize the report as pretty JSON."""
        return json.dumps(self.to_dict(), indent=2, ensure_ascii=False)

    def to_markdown(self) -> str:
        """Render the report as Markdown."""
        rows = "\n".join(
            f"| {item.model} | {item.role} | {item.confidence} | {item.answer} |"
            for item in self.panel
        )
        return f"""# Fusion-style Panel Demo

> {self.safety_note}

## Task

{self.task}

## Panel

| Model | Role | Confidence | Answer |
|---|---|---|---|
{rows}

## Judge Analysis

### Consensus
{_bullet_list(self.consensus)}

### Contradictions
{_bullet_list(self.contradictions)}

### Coverage Gaps
{_bullet_list(self.coverage_gaps)}

### Unique Insights
{_bullet_list(self.unique_insights)}

### Blind Spots
{_bullet_list(self.blind_spots)}

## Final Answer

{self.final_answer}
"""


def configure_stdout() -> None:
    """Configure Windows consoles to print Unicode safely."""
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def split_models(value: str | None) -> list[str]:
    """Split a comma-separated model list."""
    if not value:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


def offline_fusion_panel(task: str = DEFAULT_FUSION_TASK) -> list[PanelResponse]:
    """Return a deterministic offline panel for demos and tests."""
    return [
        PanelResponse(
            model="mimo-v2.5/offline",
            role="broad diagnostician",
            answer=(
                "Use a domain router before expensive reasoning: pathology, "
                "infection, endocrine/electrolyte, neuro, drug reaction, and rare syndrome."
            ),
            strengths=["broad recall", "cheap first pass", "good label variety"],
            risks=["may overfit to plausible broad diagnoses"],
            confidence="medium",
        ),
        PanelResponse(
            model="deepseek-v4-pro/offline",
            role="mechanism checker",
            answer=(
                "Require every final label to cite case evidence and a competing "
                "diagnosis it ruled out. Penalize answers without mechanism."
            ),
            strengths=["mechanistic reasoning", "contradiction spotting"],
            risks=["can be slow or verbose"],
            confidence="medium-high",
        ),
        PanelResponse(
            model="glm-5.2/offline",
            role="adversarial reviewer",
            answer=(
                "Run rescue only on low-confidence or disagreement cases. Generic "
                "reruns waste budget and did not move the score enough."
            ),
            strengths=["skeptical review", "cost control"],
            risks=["may reject useful rare-disease guesses"],
            confidence="high",
        ),
        PanelResponse(
            model="qwen3.7-max/offline",
            role="retrieval planner",
            answer=(
                "Generate 3-5 retrieval queries per case, then build a compact "
                "evidence packet before the panel votes."
            ),
            strengths=["query planning", "structured extraction"],
            risks=["retrieval quality can dominate outcome"],
            confidence="medium-high",
        ),
    ]


def real_fusion_panel(
    provider: str,
    models: list[str],
    task: str = DEFAULT_FUSION_TASK,
    *,
    timeout: float = 300.0,
) -> list[PanelResponse]:
    """Call real provider models for a fusion-style panel."""
    selector = ProviderSelector()
    roles = [
        "broad diagnostician",
        "mechanism checker",
        "adversarial reviewer",
        "retrieval planner",
    ]
    responses: list[PanelResponse] = []
    for index, model in enumerate(models):
        role = roles[index % len(roles)]
        candidate = ModelCandidate(provider=provider, model=model, priority=index)
        try:
            spec = selector.get_provider(candidate.provider)
            provider_instance = spec.factory(candidate.model)
            if hasattr(provider_instance, "timeout"):
                provider_instance.timeout = timeout
            answer = provider_instance.generate(_panel_prompt(task, role), temperature=0)
            responses.append(
                PanelResponse(
                    model=f"{provider}/{model}",
                    role=role,
                    answer=answer.strip().replace("\n", " ")[:800],
                    strengths=["real provider response"],
                    risks=["cost, latency, and provider availability"],
                    confidence="model-reported",
                )
            )
        except (StateTransferError, OSError, ValueError) as exc:
            responses.append(
                PanelResponse(
                    model=f"{provider}/{model}",
                    role=role,
                    answer=f"Provider failed safely: {str(exc)[:240]}",
                    strengths=[],
                    risks=["provider call failed"],
                    confidence="failed",
                )
            )
    return responses


def judge_fusion_panel(
    task: str,
    panel: list[PanelResponse],
    *,
    mode: str,
) -> FusionReport:
    """Create a deterministic judge report from panel responses."""
    successful = [item for item in panel if item.confidence != "failed"]
    consensus = [
        "Use multiple specialist perspectives instead of one generic rerun.",
        "Run retrieval before final voting, not only inside the final prompt.",
        "Reserve rescue for failed, low-confidence, or disagreement cases.",
    ]
    contradictions = [
        "Breadth-first diagnosis can increase recall but also broad false positives.",
        "Mechanism-heavy review improves precision but may miss rare presentations.",
    ]
    coverage_gaps = [
        "Need per-domain error taxonomy before claiming improvement.",
        "Need clean infra metrics separated from clinical misses.",
    ]
    unique_insights = [f"{item.model}: {item.answer[:160]}" for item in successful[:4]]
    blind_spots = [
        "No benchmark score should be marketed as clinical capability.",
        "Fusion can improve consistency, but it can also amplify shared false assumptions.",
    ]
    final_answer = (
        "Build HandoffKit Fusion as a research orchestrator: evidence planner -> "
        "parallel model panel -> contradiction judge -> targeted rescue -> final "
        "label normalizer. Track accuracy, clean accuracy, rescue gain, harmful "
        "rescue rate, and infra failures separately. Start offline/deterministic; "
        "enable real providers only with --real and cached shards."
    )
    return FusionReport(
        success=bool(successful),
        task=task,
        mode=mode,
        panel=panel,
        consensus=consensus,
        contradictions=contradictions,
        coverage_gaps=coverage_gaps,
        unique_insights=unique_insights,
        blind_spots=blind_spots,
        final_answer=final_answer,
    )


def run_fusion_demo(
    *,
    task: str = DEFAULT_FUSION_TASK,
    provider: str = "opencode-go",
    models: str = DEFAULT_FUSION_MODELS,
    real: bool = False,
    timeout: float = 300.0,
    output_name: str = "fusion_style_demo",
    output_dir: str | Path = "reports",
) -> tuple[FusionReport, Path, Path]:
    """Run the fusion-style demo and write report files."""
    if real:
        panel = real_fusion_panel(provider, split_models(models), task, timeout=timeout)
        mode = "real-provider-panel"
    else:
        panel = offline_fusion_panel(task)
        mode = "offline-deterministic-panel"
    report = judge_fusion_panel(task, panel, mode=mode)
    json_path, markdown_path = write_report_files(report, output_name, output_dir)
    return report, json_path, markdown_path


def _bullet_list(items: list[str]) -> str:
    if not items:
        return "- none"
    return "\n".join(f"- {item}" for item in items)


def _panel_prompt(task: str, role: str) -> str:
    return f"""You are one model in a Fusion-style HandoffKit panel.
Role: {role}

Task:
{task}

Return a concise answer with:
- recommended move
- evidence required
- risk or blind spot

Safety: this is research-only. Do not provide patient-care advice.
"""
