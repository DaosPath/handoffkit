"""Team runner."""

from __future__ import annotations

import asyncio
from collections.abc import Sequence

from handoffkit.agent import Agent
from handoffkit.csp import CspRuntime, RuntimeMode, make_envelope
from handoffkit.handoff import HandoffState
from handoffkit.protocol import HandoffProtocol
from handoffkit.schemas import AgentOutput, TeamRunResult


class Team:
    """Sequential multi-agent team runner."""

    def __init__(
        self,
        agents: Sequence[Agent],
        *,
        protocol: HandoffProtocol | None = None,
        runtime_mode: RuntimeMode | str = RuntimeMode.CLASSIC,
        runtime: CspRuntime | None = None,
    ) -> None:
        if not agents:
            raise ValueError("Team requires at least one agent.")
        self.agents = list(agents)
        self.protocol = protocol or HandoffProtocol(mode="hybrid_state")
        self.runtime_mode = RuntimeMode(runtime_mode)
        self.runtime = runtime

    def run(self, task: str) -> TeamRunResult:
        """Run the task through all agents in sequence."""
        if self.runtime_mode is not RuntimeMode.CLASSIC:
            try:
                asyncio.get_running_loop()
            except RuntimeError:
                return asyncio.run(self.arun(task))
            raise RuntimeError(
                "Team.run() in CSP mode cannot run inside an event loop; use arun()."
            )

        outputs: list[AgentOutput] = []
        handoffs = []

        first = self.agents[0]
        current_output = first.run(task)
        outputs.append(AgentOutput(agent=first.name, output=current_output))

        for previous, current in zip(self.agents, self.agents[1:], strict=False):
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

    async def arun(self, task: str) -> TeamRunResult:
        """Run the task through all agents asynchronously in sequence."""
        if self.runtime_mode is not RuntimeMode.CLASSIC:
            return await self._arun_session(task)

        outputs: list[AgentOutput] = []
        handoffs = []

        first = self.agents[0]
        current_output = await first.arun(task)
        outputs.append(AgentOutput(agent=first.name, output=current_output))

        for previous, current in zip(self.agents, self.agents[1:], strict=False):
            handoff = self.protocol.transfer(
                from_agent=previous,
                to_agent=current,
                task=task,
                summary=current_output,
            )
            handoffs.append(handoff)
            current_output = await current.arun(task, handoff_state=handoff)
            outputs.append(AgentOutput(agent=current.name, output=current_output))

        return TeamRunResult(
            task=task,
            final_output=current_output,
            agent_outputs=outputs,
            handoffs=handoffs,
        )

    async def _arun_session(self, task: str) -> TeamRunResult:
        """Run agents as CSP processes connected by bounded channels."""
        runtime = self.runtime or CspRuntime(mode=self.runtime_mode)
        session = runtime.create_session()
        outputs: list[AgentOutput | None] = [None] * len(self.agents)
        handoffs: list[HandoffState | None] = [None] * max(len(self.agents) - 1, 0)

        for index in range(len(self.agents)):
            session.channel(f"agent-{index}")

        def process_for(index: int):  # type: ignore[no-untyped-def]
            agent = self.agents[index]

            async def process(context):  # type: ignore[no-untyped-def]
                incoming = await context.receive(f"agent-{index}")
                payload = incoming.payload if isinstance(incoming.payload, dict) else {}
                handoff_data = payload.get("handoff_state")
                handoff_state = (
                    HandoffState.from_dict(handoff_data) if isinstance(handoff_data, dict) else None
                )
                current_output = await agent.arun(task, handoff_state=handoff_state)
                outputs[index] = AgentOutput(agent=agent.name, output=current_output)
                context.ack(incoming, process=agent.name)

                if index + 1 < len(self.agents):
                    next_agent = self.agents[index + 1]
                    state = self.protocol.transfer(
                        from_agent=agent,
                        to_agent=next_agent,
                        task=task,
                        summary=current_output,
                        metadata={"runtime_mode": self.runtime_mode.value},
                    )
                    handoffs[index] = state
                    await context.send(
                        f"agent-{index + 1}",
                        make_envelope(
                            session_id=session.session_id,
                            channel=f"agent-{index + 1}",
                            source=agent.name,
                            target=next_agent.name,
                            sequence=index + 1,
                            payload_type="handoff_state",
                            payload={"handoff_state": state.to_dict()},
                            idempotency_key=f"{session.session_id}:handoff:{index}",
                        ),
                    )

            return process

        for index, agent in enumerate(self.agents):
            session.spawn(f"agent:{agent.name}:{index}", process_for(index))

        await session.send(
            "agent-0",
            make_envelope(
                session_id=session.session_id,
                channel="agent-0",
                source="team",
                target=self.agents[0].name,
                sequence=0,
                payload_type="task",
                payload={"task": task},
                idempotency_key=f"{session.session_id}:task",
            ),
        )
        try:
            await session.wait()
        finally:
            await session.close()

        resolved_outputs = [output for output in outputs if output is not None]
        resolved_handoffs = [handoff for handoff in handoffs if handoff is not None]
        final_output = resolved_outputs[-1].output if resolved_outputs else ""
        return TeamRunResult(
            task=task,
            final_output=final_output,
            agent_outputs=resolved_outputs,
            handoffs=resolved_handoffs,
        )
