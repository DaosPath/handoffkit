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

## Copy/Paste Adapter

```python
from handoffkit import HandoffState, HandoffStateValidator


def pydantic_ai_result_to_handoff(result) -> HandoffState:
    handoff = HandoffState(
        task=result.task,
        from_agent=result.previous_agent,
        to_agent=result.next_agent,
        summary=result.summary,
        decisions=list(result.decisions),
        important_files=list(result.important_files),
        errors=list(getattr(result, "risks", [])),
        next_steps=list(result.next_steps),
        metadata={"integration": "pydantic-ai", "errors_checked": True},
    )
    HandoffStateValidator().validate(handoff).raise_if_failed()
    return handoff
```

## Runnable Example

See [`examples/pydantic_ai_integration.py`](../../examples/pydantic_ai_integration.py).

The example runs offline with a dataclass stand-in for a typed Pydantic AI
result, so normal tests do not need provider keys or extra dependencies.
