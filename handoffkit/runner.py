"""Team runner."""

from __future__ import annotations

from collections.abc import Sequence

from handoffkit.agent import Agent
from handoffkit.protocol import HandoffProtocol
from handoffkit.schemas import AgentOutput, TeamRunResult


class Team:
    """Sequential multi-agent team runner."""

    def __init__(
        self,
        agents: Sequence[Agent],
        *,
        protocol: HandoffProtocol | None = None,
    ) -> None:
        if not agents:
            raise ValueError("Team requires at least one agent.")
        self.agents = list(agents)
        self.protocol = protocol or HandoffProtocol(mode="hybrid_state")

    def run(self, task: str) -> TeamRunResult:
        """Run the task through all agents in sequence."""
        outputs: list[AgentOutput] = []
        handoffs = []

        first = self.agents[0]
        current_output = first.run(task)
        outputs.append(AgentOutput(agent=first.name, output=current_output))

        for previous, current in zip(self.agents, self.agents[1:]):
            handoff = self.protocol.transfer(
                from_agent=previous,
                to_agent=current,
                task=task,
                summary=current_output,
            )
            handoffs.append(handoff)
            current_output = current.run(task, handoff_state=handoff)
            outputs.append(AgentOutput(agent=current.name, output=current_output))

        return TeamRunResult(
            task=task,
            final_output=current_output,
            agent_outputs=outputs,
            handoffs=handoffs,
        )
