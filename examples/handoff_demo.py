"""Architect to Coder handoff demo."""

from handoffkit import Agent, HandoffProtocol


architect = Agent(
    name="Architect",
    role="Analyze projects and create technical plans.",
)

coder = Agent(
    name="Coder",
    role="Write code based on received handoff state.",
)

protocol = HandoffProtocol(mode="hybrid_state")
state = protocol.transfer(
    from_agent=architect,
    to_agent=coder,
    task="Create a Python package.",
)

print(state.to_json())
