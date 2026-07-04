# OpenAI Agents SDK Integration Pattern

HandoffKit can be used as the state contract around OpenAI Agents SDK handoffs.

```python
from handoffkit import HandoffState, HandoffStateValidator


def build_handoff(previous_agent: str, next_agent: str, task: str) -> dict:
    state = HandoffState(
        task=task,
        from_agent=previous_agent,
        to_agent=next_agent,
        summary="Escalate billing issue with charge evidence.",
        decisions=["Verify charge IDs before promising refund."],
        important_files=["ticket.json", "charges.csv"],
        next_steps=["Review charge IDs", "Draft customer-safe response"],
        metadata={"errors_checked": True},
    )
    HandoffStateValidator().validate(state).raise_if_failed()
    return state.to_dict()
```

Use the SDK for tool execution and model orchestration. Use HandoffKit to make
handoff payloads inspectable, testable, and replayable.
