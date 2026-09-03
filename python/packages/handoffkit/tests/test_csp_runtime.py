from __future__ import annotations

import asyncio
from dataclasses import replace
from datetime import datetime, timedelta, timezone

import pytest

from handoffkit import Agent, Recipe, RecipeRunner, RecipeStep, RuntimeMode, Team
from handoffkit.csp import (
    BackpressureError,
    ChannelClosedError,
    ChannelConfig,
    CspChannel,
    CspRuntime,
    DeadlineExceededError,
    MessageEnvelope,
    OverflowPolicy,
    RetryPolicy,
    SessionConfig,
    make_envelope,
)


def test_rejecting_channel_applies_backpressure() -> None:
    async def scenario() -> None:
        channel = CspChannel(
            ChannelConfig("tasks", capacity=1, overflow_policy=OverflowPolicy.REJECT),
            max_message_bytes=4096,
        )
        first = make_envelope(
            session_id="s",
            channel="tasks",
            source="test",
            sequence=1,
            payload_type="json",
            payload={},
        )
        await channel.send(first)
        with pytest.raises(BackpressureError):
            await channel.send(
                make_envelope(
                    session_id="s",
                    channel="tasks",
                    source="test",
                    sequence=2,
                    payload_type="json",
                    payload={},
                )
            )

    asyncio.run(scenario())


def test_retryable_nack_then_ack_preserves_message_id() -> None:
    async def scenario() -> None:
        config = SessionConfig(
            session_id="retry",
            ack_timeout_ms=200,
            retry_policy=RetryPolicy(max_attempts=2, base_delay_ms=0, max_delay_ms=0),
        )
        session = CspRuntime().create_session(config=config)
        attempts: list[MessageEnvelope] = []

        async def worker(context):  # type: ignore[no-untyped-def]
            first = await context.receive("tasks")
            attempts.append(first)
            context.nack(first, code="busy", message="retry", retryable=True)
            second = await context.receive("tasks")
            attempts.append(second)
            context.ack(second)

        session.spawn("worker", worker)
        envelope = make_envelope(
            session_id=session.session_id,
            channel="tasks",
            source="test",
            target="worker",
            sequence=1,
            payload_type="json",
            payload={"value": 1},
            requires_ack=True,
            idempotency_key="operation-1",
        )
        ack = await session.send_with_ack("tasks", envelope)
        await session.wait()
        assert ack.message_id == envelope.message_id
        assert [item.attempt for item in attempts] == [1, 2]
        assert attempts[0].message_id == attempts[1].message_id
        await session.close()

    asyncio.run(scenario())


def test_closing_full_channel_never_blocks_and_drains_existing_message() -> None:
    async def scenario() -> None:
        channel = CspChannel(
            ChannelConfig("tasks", capacity=1),
            max_message_bytes=4096,
        )
        envelope = make_envelope(
            session_id="close",
            channel="tasks",
            source="test",
            sequence=1,
            payload_type="json",
            payload={},
        )
        await channel.send(envelope)
        await asyncio.wait_for(channel.close(), timeout=0.1)
        assert await channel.receive() == envelope

    asyncio.run(scenario())


def test_session_deadline_is_inherited_and_enforced() -> None:
    async def scenario() -> None:
        deadline = (datetime.now(timezone.utc) + timedelta(minutes=1)).isoformat()
        session = CspRuntime().create_session(
            config=SessionConfig(session_id="deadline", deadline=deadline)
        )
        envelope = make_envelope(
            session_id=session.session_id,
            channel="tasks",
            source="test",
            sequence=1,
            payload_type="json",
            payload={},
        )
        await session.send("tasks", envelope)
        received = await session.receive("tasks")
        assert received.deadline == deadline

        earlier = (datetime.now(timezone.utc) + timedelta(seconds=10)).isoformat()
        early_envelope = replace(
            make_envelope(
                session_id=session.session_id,
                channel="tasks",
                source="test",
                sequence=2,
                payload_type="json",
                payload={},
            ),
            deadline=earlier,
        )
        await session.send("tasks", early_envelope)
        assert (await session.receive("tasks")).deadline == earlier
        await session.close()

        expired = CspRuntime().create_session(
            config=SessionConfig(
                session_id="expired",
                deadline="2000-01-01T00:00:00Z",
            )
        )
        with pytest.raises(DeadlineExceededError):
            await expired.send(
                "tasks",
                make_envelope(
                    session_id=expired.session_id,
                    channel="tasks",
                    source="test",
                    sequence=1,
                    payload_type="json",
                    payload={},
                ),
            )
        await expired.close()

    asyncio.run(scenario())


def test_channel_close_wakes_blocked_receiver() -> None:
    async def scenario() -> None:
        channel = CspChannel(ChannelConfig("tasks"), max_message_bytes=4096)
        receiver = asyncio.create_task(channel.receive())
        await asyncio.sleep(0)
        await channel.close()
        with pytest.raises(ChannelClosedError, match="closed"):
            await receiver

    asyncio.run(scenario())


def test_team_session_preserves_handoff_order() -> None:
    team = Team(
        [Agent("Architect", "Plan."), Agent("Coder", "Build."), Agent("Tester", "Test.")],
        runtime_mode=RuntimeMode.SESSION,
    )
    result = team.run("Build a calculator.")
    assert [item.agent for item in result.agent_outputs] == ["Architect", "Coder", "Tester"]
    assert [(item.from_agent, item.to_agent) for item in result.handoffs] == [
        ("Architect", "Coder"),
        ("Coder", "Tester"),
    ]
    assert all(item.metadata["runtime_mode"] == "session" for item in result.handoffs)


def test_recipe_session_uses_csp_handoffs() -> None:
    recipe = Recipe(
        name="session-recipe",
        description="CSP recipe test.",
        steps=[
            RecipeStep("plan", "Plan", agent=Agent("Planner", "Plan.")),
            RecipeStep("build", "Build", agent=Agent("Builder", "Build.")),
        ],
    )
    result = RecipeRunner(recipe, runtime_mode=RuntimeMode.SESSION).run("Create a queue")
    assert result.success
    assert len(result.handoff_states) == 1
    assert result.metadata["runtime_mode"] == "session"


def test_distributed_mode_creates_a_distributed_session() -> None:
    session = CspRuntime(mode=RuntimeMode.DISTRIBUTED).create_session()
    assert session.config.runtime_mode is RuntimeMode.DISTRIBUTED
    assert session.diagnostics().channel_count == 0


def test_team_distributed_mode_uses_the_csp_execution_path() -> None:
    team = Team(
        [Agent("Architect", "Plan."), Agent("Coder", "Build.")],
        runtime_mode=RuntimeMode.DISTRIBUTED,
    )
    result = team.run("Build a queue.")
    assert [item.agent for item in result.agent_outputs] == ["Architect", "Coder"]
    assert result.handoffs[0].metadata["runtime_mode"] == "distributed"
