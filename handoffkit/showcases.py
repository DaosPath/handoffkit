"""Real-world offline showcases for HandoffKit adoption demos."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from handoffkit.handoff import HandoffState
from handoffkit.quality import HandoffQualityEvaluator, HandoffQualityReport
from handoffkit.replay import ReplayRunner
from handoffkit.reports import write_report_files
from handoffkit.tracing import RunTrace, TraceEvent, TraceStep
from handoffkit.validation import HandoffStateValidator, ValidationReport


def _json_default(value: Any) -> Any:
    if hasattr(value, "to_dict"):
        return value.to_dict()
    return str(value)


def _count_label(count: int, singular: str, plural: str | None = None) -> str:
    return f"{count} {singular if count == 1 else plural or singular + 's'}"


@dataclass
class ShowcaseResult:
    """Report for one real-world HandoffKit showcase."""

    slug: str
    title: str
    command: str
    pain: str
    free_text_summary: str
    lost_context: list[str]
    preserved_context: list[str]
    handoffs: list[HandoffState]
    trace: RunTrace
    validation: ValidationReport
    quality: HandoffQualityReport
    artifacts: dict[str, str] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Serialize this showcase report."""
        return {
            "slug": self.slug,
            "title": self.title,
            "command": self.command,
            "pain": self.pain,
            "free_text_summary": self.free_text_summary,
            "lost_context": self.lost_context,
            "preserved_context": self.preserved_context,
            "handoffs": [handoff.to_dict() for handoff in self.handoffs],
            "trace": self.trace.to_dict(),
            "replay": ReplayRunner(self.trace).summary().to_dict(),
            "validation": self.validation.to_dict(),
            "quality": self.quality.to_dict(),
            "artifacts": self.artifacts,
        }

    def to_json(self, *, indent: int | None = 2) -> str:
        """Serialize this showcase report as JSON."""
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=indent, default=_json_default)

    def to_markdown(self) -> str:
        """Serialize this showcase report as Markdown."""
        lost = "\n".join(f"- {item}" for item in self.lost_context) or "- none"
        preserved = "\n".join(f"- {item}" for item in self.preserved_context) or "- none"
        handoffs = "\n".join(
            (
                f"- `{handoff.from_agent}` -> `{handoff.to_agent}`: "
                f"{_count_label(len(handoff.decisions), 'decision')}, "
                f"{_count_label(len(handoff.important_files), 'file')}, "
                f"{_count_label(len(handoff.errors), 'error')}, "
                f"{_count_label(len(handoff.next_steps), 'next step')}"
            )
            for handoff in self.handoffs
        )
        artifacts = "\n".join(
            f"- `{name}`: `{path}`" for name, path in sorted(self.artifacts.items())
        ) or "- generated when written"
        return (
            f"# {self.title}\n\n"
            f"## 5 Minute Command\n\n```bash\n{self.command}\n```\n\n"
            f"## Pain\n\n{self.pain}\n\n"
            "## Free-text Summary Loses\n\n"
            f"> {self.free_text_summary}\n\n"
            f"{lost}\n\n"
            "## HandoffKit Preserves\n\n"
            f"{preserved}\n\n"
            f"## Structured Handoffs\n\n{handoffs}\n\n"
            f"## Validation\n\nSuccess: `{self.validation.success}`\n\n"
            f"## Quality\n\nScore: `{self.quality.score:.3f}` Grade: `{self.quality.grade}`\n\n"
            f"## Replay\n\n{ReplayRunner(self.trace).summary().to_markdown()}\n\n"
            f"## Artifacts\n\n{artifacts}\n"
        )


def showcase_names() -> list[str]:
    """Return available showcase slugs."""
    return ["coding-review", "support-escalation", "research-workflow"]


def build_showcase(slug: str) -> ShowcaseResult:
    """Build one deterministic offline showcase result."""
    builders = {
        "coding-review": _coding_review_showcase,
        "support-escalation": _support_escalation_showcase,
        "research-workflow": _research_workflow_showcase,
    }
    try:
        return builders[slug]()
    except KeyError as exc:
        available = ", ".join(showcase_names())
        raise KeyError(f"Unknown showcase {slug!r}. Available showcases: {available}") from exc


def run_showcase(
    slug: str,
    *,
    output_dir: str | Path = "runs/latest",
    reports_dir: str | Path = "reports",
) -> ShowcaseResult:
    """Build a showcase, write run artifacts, and return the report."""
    result = build_showcase(slug)
    run_dir = Path(output_dir)
    run_dir.mkdir(parents=True, exist_ok=True)
    trace_path = run_dir / "trace.json"
    report_json_path = run_dir / "report.json"
    report_md_path = run_dir / "report.md"
    trace_path.write_text(result.trace.to_json(), encoding="utf-8")
    report_json_path.write_text(result.to_json(), encoding="utf-8")
    report_md_path.write_text(result.to_markdown(), encoding="utf-8")
    repo_json_path, repo_md_path = write_report_files(result, slug.replace("-", "_"), reports_dir)
    result.artifacts.update(
        {
            "run_trace": str(trace_path),
            "run_report_json": str(report_json_path),
            "run_report_md": str(report_md_path),
            "report_json": str(repo_json_path),
            "report_md": str(repo_md_path),
        }
    )
    report_json_path.write_text(result.to_json(), encoding="utf-8")
    report_md_path.write_text(result.to_markdown(), encoding="utf-8")
    repo_json_path.write_text(result.to_json(), encoding="utf-8")
    repo_md_path.write_text(result.to_markdown(), encoding="utf-8")
    return result


def load_showcase_report(path: str | Path) -> str:
    """Render a showcase or trace path as Markdown for the CLI report command."""
    target = Path(path)
    if target.is_dir():
        for candidate in ["report.md", "report.json", "trace.json"]:
            candidate_path = target / candidate
            if candidate_path.exists():
                return load_showcase_report(candidate_path)
        raise FileNotFoundError(f"No report.md, report.json, or trace.json found in {target}")
    if target.suffix.lower() == ".md":
        return target.read_text(encoding="utf-8")
    if target.suffix.lower() != ".json":
        raise ValueError("report path must be a directory, .md file, or .json file")
    data = json.loads(target.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("report JSON must decode to an object")
    if {"run_id", "steps", "final_output"}.issubset(data):
        return RunTrace.from_dict(data).to_markdown()
    title = str(data.get("title", "HandoffKit Report"))
    quality = data.get("quality", {})
    replay = data.get("replay", {})
    return (
        f"# {title}\n\n"
        f"## Command\n\n```bash\n{data.get('command', '')}\n```\n\n"
        f"## Pain\n\n{data.get('pain', '')}\n\n"
        f"## Quality\n\nScore: `{quality.get('score', 'n/a')}` "
        f"Grade: `{quality.get('grade', 'n/a')}`\n\n"
        f"## Replay\n\nSteps: `{replay.get('step_count', 'n/a')}` "
        f"Handoffs: `{replay.get('handoff_count', 'n/a')}`\n"
    )


def _make_trace(slug: str, title: str, handoffs: list[HandoffState]) -> RunTrace:
    steps = [
        TraceStep(
            name="step-1",
            agent=handoffs[0].from_agent,
            task=handoffs[0].task,
            mode="showcase",
            success=True,
            output=f"{handoffs[0].from_agent} created the initial plan.",
            events=[TraceEvent(kind="showcase", message="Workflow started.")],
        )
    ]
    for index, handoff in enumerate(handoffs, start=2):
        steps.append(
            TraceStep(
                name=f"step-{index}",
                agent=handoff.to_agent,
                task=handoff.task,
                mode="showcase",
                success=True,
                output=handoff.summary,
                handoff=handoff,
                events=[TraceEvent(kind="handoff", message="Structured handoff received.")],
            )
        )
    return RunTrace(
        run_id=f"showcase-{slug}",
        name=title,
        success=True,
        final_output=handoffs[-1].summary,
        steps=steps,
        handoffs=handoffs,
        metadata={"showcase": slug, "offline": True},
    )


def _finish(
    *,
    slug: str,
    title: str,
    command: str,
    pain: str,
    free_text_summary: str,
    lost_context: list[str],
    preserved_context: list[str],
    handoffs: list[HandoffState],
) -> ShowcaseResult:
    trace = _make_trace(slug, title, handoffs)
    validation = HandoffStateValidator().validate(handoffs[-1])
    quality = HandoffQualityEvaluator(min_score=0.75).evaluate_many(handoffs)
    return ShowcaseResult(
        slug=slug,
        title=title,
        command=command,
        pain=pain,
        free_text_summary=free_text_summary,
        lost_context=lost_context,
        preserved_context=preserved_context,
        handoffs=handoffs,
        trace=trace,
        validation=validation,
        quality=quality,
    )


def _coding_review_showcase() -> ShowcaseResult:
    task = "Ship a Python CLI calculator with tests and review evidence."
    handoffs = [
        HandoffState(
            task=task,
            from_agent="Architect",
            to_agent="Coder",
            summary="Build argparse CLI around pure add, subtract, multiply, and divide functions.",
            decisions=[
                "Use argparse subcommands for operations.",
                "Keep arithmetic in pure functions for easy tests.",
                "Return exit code 2 for division by zero input.",
            ],
            important_files=["calculator.py", "tests/test_calculator.py"],
            next_steps=[
                "Implement calculator.py",
                "Write pytest coverage for each operation",
                "Run pytest -q",
            ],
            context_refs=["ADR-001-cli-shape", "issue-42-calculator"],
            metadata={"errors_checked": True, "risk": "division-by-zero"},
        ),
        HandoffState(
            task=task,
            from_agent="Coder",
            to_agent="Reviewer",
            summary="Implementation done with pure operation helpers and argparse command routing.",
            decisions=[
                "Expose calculate(operation, a, b) for tests.",
                "Keep CLI printing separate from arithmetic.",
                "Use ValueError for invalid divide calls.",
            ],
            important_files=["calculator.py", "tests/test_calculator.py"],
            errors=["Manual smoke caught missing divide-by-zero message; fixed before review."],
            next_steps=[
                "Review CLI argument errors",
                "Review test coverage for divide edge case",
                "Verify README command examples",
            ],
            context_refs=["pytest-output-local", "README.md#usage"],
            metadata={"errors_checked": True, "coverage": "operation matrix"},
        ),
        HandoffState(
            task=task,
            from_agent="Reviewer",
            to_agent="Tester",
            summary=(
                "Review passed after one fix: invalid operation message now names "
                "supported commands."
            ),
            decisions=[
                "Keep public calculate() helper stable.",
                "Add regression test for invalid operation.",
                "Do not add external dependencies.",
            ],
            important_files=["calculator.py", "tests/test_calculator.py", "README.md"],
            errors=["Initial invalid-operation error was too vague; regression added."],
            next_steps=[
                "Run pytest -q",
                "Run python calculator.py add 2 3",
                "Verify division-by-zero exits with code 2",
            ],
            context_refs=["review-note-17", "pytest-output-local"],
            metadata={"errors_checked": True, "review_status": "approved-after-fix"},
        ),
    ]
    return _finish(
        slug="coding-review",
        title="Coding Agents: Architect -> Coder -> Reviewer -> Tester",
        command=(
            "pip install handoffkit\n"
            "handoffkit init coding-review\n"
            "cd coding-review\n"
            "python coding_review.py\n"
            "handoffkit report runs/latest"
        ),
        pain="Free-text agent summaries drop files, edge cases, review fixes, and test evidence.",
        free_text_summary=(
            "Calculator is basically done. Reviewer found one small issue. "
            "Tester should run it."
        ),
        lost_context=[
            "which files changed",
            "why argparse was chosen",
            "the divide-by-zero risk",
            "the exact review fix",
            "the commands tester must run",
        ],
        preserved_context=[
            "important_files across every handoff",
            "decisions and rationale",
            "errors and fixes",
            "next_steps as executable checks",
            "trace and replay evidence",
        ],
        handoffs=handoffs,
    )


def _support_escalation_showcase() -> ShowcaseResult:
    task = "Resolve a duplicate-charge refund escalation with audit trail."
    handoffs = [
        HandoffState(
            task=task,
            from_agent="Triage",
            to_agent="Billing",
            summary="Customer reports duplicate annual subscription charge after plan upgrade.",
            decisions=[
                "Classify as billing escalation, not technical support.",
                "Verify charge IDs before promising refund.",
                "Keep customer tone apologetic and specific.",
            ],
            important_files=["ticket-1837.json", "charges.csv"],
            errors=["Customer attached one receipt but mentions two bank entries."],
            next_steps=[
                "Review charge IDs ch_001 and ch_002",
                "Check whether upgrade proration created the second charge",
                "Prepare refund eligibility note",
            ],
            context_refs=["stripe-event-log", "support-policy#duplicate-charge"],
            metadata={"errors_checked": True, "severity": "high"},
        ),
        HandoffState(
            task=task,
            from_agent="Billing",
            to_agent="Refund",
            summary=(
                "Two captures found within 3 minutes; second capture matches "
                "duplicate renewal."
            ),
            decisions=[
                "Refund second capture only.",
                "Do not cancel active subscription.",
                "Add goodwill credit because customer contacted within 24 hours.",
            ],
            important_files=["billing-ledger.csv", "refund-policy.md"],
            errors=["First lookup used invoice ID instead of charge ID; corrected query."],
            next_steps=[
                "Create refund for ch_002",
                "Add account credit note",
                "Draft customer response with refund ETA",
            ],
            context_refs=["billing-query-884", "policy#refund-window"],
            metadata={"errors_checked": True, "refund_amount": "99.00"},
        ),
        HandoffState(
            task=task,
            from_agent="Refund",
            to_agent="Supervisor",
            summary=(
                "Refund prepared for duplicate charge ch_002 with account note and "
                "customer response."
            ),
            decisions=[
                "Supervisor approval required because amount exceeds auto-refund threshold.",
                "Customer message should include exact refunded charge ID.",
                "Keep internal correction note for invoice-vs-charge lookup error.",
            ],
            important_files=["refund-request.json", "customer-reply.md", "account-note.md"],
            errors=["No customer-facing promise sent before approval."],
            next_steps=[
                "Approve refund request",
                "Send customer-reply.md",
                "Verify refund event appears in ledger",
            ],
            context_refs=["supervisor-queue", "refund-policy#approval"],
            metadata={"errors_checked": True, "approval_required": True},
        ),
    ]
    return _finish(
        slug="support-escalation",
        title="Customer Support: Triage -> Billing -> Refund -> Supervisor",
        command=(
            "pip install handoffkit\n"
            "handoffkit init support-escalation\n"
            "cd support-escalation\n"
            "python support_escalation.py\n"
            "handoffkit report runs/latest"
        ),
        pain=(
            "Support handoffs lose policy checks, charge IDs, and what was "
            "promised to the customer."
        ),
        free_text_summary=(
            "Looks like duplicate billing. Refund team should handle it and "
            "maybe tell customer."
        ),
        lost_context=[
            "exact charge IDs",
            "policy threshold",
            "lookup mistake already corrected",
            "whether customer was promised anything",
            "supervisor approval reason",
        ],
        preserved_context=[
            "charge evidence",
            "billing decisions",
            "customer-safe next steps",
            "internal errors",
            "supervisor audit trail",
        ],
        handoffs=handoffs,
    )


def _research_workflow_showcase() -> ShowcaseResult:
    task = "Produce a sourced brief on Python packaging release trust."
    handoffs = [
        HandoffState(
            task=task,
            from_agent="Researcher",
            to_agent="Extractor",
            summary=(
                "Collect evidence on Trusted Publishing, manual token uploads, "
                "and release provenance."
            ),
            decisions=[
                "Treat official packaging docs as primary sources.",
                "Separate TestPyPI validation from PyPI production release.",
                "Track claims that need verification before writing.",
            ],
            important_files=["sources.md", "notes/raw_pypi_docs.md"],
            errors=["One blog post was outdated and excluded from source list."],
            next_steps=[
                "Extract claims from official docs",
                "Capture source URLs for each claim",
                "Flag unsupported claims",
            ],
            context_refs=["docs.pypi.org/trusted-publishers", "packaging.python.org"],
            metadata={"errors_checked": True, "source_policy": "primary-first"},
        ),
        HandoffState(
            task=task,
            from_agent="Extractor",
            to_agent="Fact-checker",
            summary="Extracted 7 claims and mapped each to a source URL and confidence level.",
            decisions=[
                "Mark OIDC token exchange as high confidence.",
                "Mark adoption preference as opinion unless sourced.",
                "Keep manual twine upload factual but not inherently negative.",
            ],
            important_files=["claims.json", "source_map.md"],
            errors=["One claim mixed PyPI and TestPyPI behavior; split into two claims."],
            next_steps=[
                "Verify each source URL",
                "Check claim wording against source text",
                "Reject claims without source_map entry",
            ],
            context_refs=["claims#trusted-publishing", "claims#twine"],
            metadata={"errors_checked": True, "claims": 7},
        ),
        HandoffState(
            task=task,
            from_agent="Fact-checker",
            to_agent="Writer",
            summary=(
                "Fact-check passed after removing one unsupported sentence about "
                "ecosystem preference."
            ),
            decisions=[
                "Keep recommendation: prefer Trusted Publishing for new packages.",
                "Avoid saying manual twine upload is insecure by itself.",
                "Mention replayable release evidence as operational benefit.",
            ],
            important_files=["fact_check.md", "final_outline.md", "source_map.md"],
            errors=["Unsupported preference claim removed from final outline."],
            next_steps=[
                "Write concise brief",
                "Include source-backed claims only",
                "Add final caveat about package owner configuration",
            ],
            context_refs=["fact-check-result", "writer-brief"],
            metadata={"errors_checked": True, "approved_claims": 6},
        ),
    ]
    return _finish(
        slug="research-workflow",
        title="Research Workflow: Researcher -> Extractor -> Fact-checker -> Writer",
        command=(
            "pip install handoffkit\n"
            "handoffkit init research-workflow\n"
            "cd research-workflow\n"
            "python research_workflow.py\n"
            "handoffkit report runs/latest"
        ),
        pain=(
            "Research agents often blur sources, confidence, corrections, and "
            "final writing constraints."
        ),
        free_text_summary=(
            "Sources look good. Fact checker removed something. Writer can make "
            "the brief."
        ),
        lost_context=[
            "which source backs which claim",
            "what was removed",
            "confidence level",
            "source policy",
            "writer constraints",
        ],
        preserved_context=[
            "source map",
            "claim decisions",
            "fact-check errors",
            "approved claims",
            "replayable trace",
        ],
        handoffs=handoffs,
    )
