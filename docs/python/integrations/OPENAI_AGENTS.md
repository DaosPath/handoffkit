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

## Copy/Paste Adapter

```python
from typing import Any

from handoffkit import HandoffState, HandoffStateValidator


def build_agents_sdk_handoff_payload(
    previous_agent: str,
    next_agent: str,
    task: str,
    sdk_context: dict[str, Any],
) -> dict[str, Any]:
    handoff = HandoffState(
        task=task,
        from_agent=previous_agent,
        to_agent=next_agent,
        summary=str(sdk_context["summary"]),
        decisions=list(sdk_context.get("decisions", [])),
        important_files=list(sdk_context.get("important_files", [])),
        errors=list(sdk_context.get("errors", [])),
        next_steps=list(sdk_context.get("next_steps", [])),
        metadata={"integration": "openai-agents-sdk", "errors_checked": True},
    )
    HandoffStateValidator().validate(handoff).raise_if_failed()
    return handoff.to_dict()
```

## Runnable Example

See [`examples/integrations/openai_agents_sdk_integration.py`](../../../packages/python/examples/integrations/openai_agents_sdk_integration.py).

The example does not call the OpenAI API. It shows the boundary to keep stable:
the Agents SDK can run agents and tools, while HandoffKit validates the handoff
payload before the next agent consumes it.
