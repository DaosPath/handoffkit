# Pydantic AI Integration Pattern

HandoffKit can complement Pydantic AI by providing workflow-level handoff
contracts and replay reports.

```python
from pydantic import BaseModel
from handoffkit import HandoffState


class ReviewDecision(BaseModel):
    approved: bool
    notes: list[str]


def to_handoff(decision: ReviewDecision) -> HandoffState:
    return HandoffState(
        task="Review package release readiness.",
        from_agent="Reviewer",
        to_agent="Publisher",
        summary="Release approved." if decision.approved else "Release blocked.",
        decisions=decision.notes,
        important_files=["pyproject.toml", "CHANGELOG.md"],
        next_steps=["Run build", "Run twine check", "Publish after CI"],
        metadata={"errors_checked": True},
    )
```

Use Pydantic AI for strongly typed model outputs. Use HandoffKit for the
multi-agent workflow contract and reporting layer.
