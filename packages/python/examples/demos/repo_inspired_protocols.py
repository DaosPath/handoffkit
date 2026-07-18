"""Compare protocol modes inspired by state-transfer-protocols."""

from __future__ import annotations

from handoffkit import Agent, HandoffProtocol

architect = Agent("Architect", "Create technical plans.")
coder = Agent("Coder", "Implement from handoff state.")

task = "Plan a reproducible multi-agent workflow with validators and failure logs."

for mode in ["natural", "compressed", "hybrid_min", "hybrid_state"]:
    protocol = HandoffProtocol(mode=mode)
    state = protocol.transfer(
        from_agent=architect,
        to_agent=coder,
        task=task,
    )
    print(f"\n=== {mode} ===")
    print(state.to_json())
