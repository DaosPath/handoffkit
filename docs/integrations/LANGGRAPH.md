# LangGraph Integration Pattern

HandoffKit can sit beside LangGraph as the structured state-transfer contract
between graph nodes.

```python
from handoffkit import HandoffState


def architect_node(state: dict) -> dict:
    handoff = HandoffState(
        task=state["task"],
        from_agent="Architect",
        to_agent="Coder",
        summary="Use argparse and pure functions.",
        decisions=["Keep CLI parsing separate from math operations."],
        important_files=["calculator.py", "tests/test_calculator.py"],
        next_steps=["Implement calculator.py", "Run pytest -q"],
        metadata={"errors_checked": True},
    )
    return {"handoff": handoff.to_dict()}


def coder_node(state: dict) -> dict:
    handoff = HandoffState.from_dict(state["handoff"]).validate()
    return {"received_files": handoff.important_files}
```

Use LangGraph for graph control flow. Use HandoffKit for the contract carried
between nodes.

## Copy/Paste Adapter

```python
from handoffkit import HandoffState, HandoffStateValidator


def to_graph_payload(handoff: HandoffState) -> dict:
    HandoffStateValidator().validate(handoff).raise_if_failed()
    return {"handoff": handoff.to_dict()}


def from_graph_payload(state: dict) -> HandoffState:
    handoff = HandoffState.from_dict(state["handoff"]).validate()
    HandoffStateValidator().validate(handoff).raise_if_failed()
    return handoff
```

Keep orchestration decisions in LangGraph. Keep handoff shape, validation, and
reporting in HandoffKit.

## Runnable Example

See [`examples/langgraph_integration.py`](../../examples/langgraph_integration.py).

The example uses LangGraph-style node functions and runs offline without
requiring LangGraph as a dependency. If your application already uses LangGraph,
drop the same node functions into your graph and keep `HandoffState` as the
payload between nodes.
