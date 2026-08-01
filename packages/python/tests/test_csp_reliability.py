from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from handoffkit.csp import (
    ArtifactRef,
    BackpressureError,
    ChannelConfig,
    CspError,
    CspRuntime,
    DeliveryAck,
    DeliveryNack,
    JobProgress,
    MessageEnvelope,
    OverflowPolicy,
    PeerIdentity,
    ProcessError,
    RetryPolicy,
    SecurityConfig,
    SessionConfig,
    SignedArtifact,
    WorkerCapabilities,
    make_envelope,
    sanitize_error_message,
    validation_error_code,
)

CONTRACTS = Path(__file__).resolve().parents[2] / "contracts"
PROPERTY_SETTINGS = settings(
    max_examples=100,
    derandomize=True,
    database=None,
    deadline=None,
    suppress_health_check=[HealthCheck.too_slow],
)

safe_text = st.text(
    alphabet=st.characters(whitelist_categories=("Ll", "Lu", "Nd")),
    min_size=1,
    max_size=24,
)
secret_text = st.text(
    alphabet=st.characters(whitelist_categories=("Ll", "Lu", "Nd")),
    min_size=1,
    max_size=80,
)
json_values = st.recursive(
    st.none() | st.booleans() | st.integers(-10_000, 10_000) | st.text(max_size=32),
    lambda children: (
        st.lists(children, max_size=4)
        | st.dictionaries(st.text(min_size=1, max_size=8), children, max_size=4)
    ),
    max_leaves=20,
)


def _validate_corpus_case(kind: str, value: dict[str, Any]) -> dict[str, Any]:
    if kind == "message_envelope":
        return MessageEnvelope.from_dict(value).to_dict()
    if kind == "session_config":
        return SessionConfig.from_dict(value).to_dict()
    if kind == "channel_config":
        return ChannelConfig.from_dict(value).to_dict()
    if kind == "delivery_ack":
        return DeliveryAck(**value).to_dict()
    if kind == "delivery_nack":
        return DeliveryNack(**value).to_dict()
    if kind == "process_error":
        return ProcessError(**value).to_dict()
    if kind == "artifact_ref":
        return ArtifactRef.from_dict(value).to_dict()
    if kind == "worker_capabilities":
        return WorkerCapabilities(**value).to_dict()
    if kind == "job_progress":
        return JobProgress(**value).to_dict()
    if kind == "security_config":
        cfg = SecurityConfig(**value)
        return {
            "profile": cfg.profile.value if hasattr(cfg.profile, "value") else str(cfg.profile),
            "require_mtls": cfg.require_mtls,
            "allow_insecure_loopback": cfg.allow_insecure_loopback,
            "trust_domain": cfg.trust_domain,
            "replay_window_seconds": cfg.replay_window_seconds,
            "max_clock_skew_seconds": cfg.max_clock_skew_seconds,
        }
    if kind == "peer_identity":
        return PeerIdentity.from_dict(value).to_dict()
    if kind == "signed_artifact":
        return SignedArtifact.from_dict(value).to_dict()
    raise AssertionError(f"unsupported corpus kind: {kind}")


@pytest.mark.monorepo
def test_shared_differential_validation_corpus() -> None:
    corpus = json.loads((CONTRACTS / "corpus/csp-validation.json").read_text("utf-8"))
    for case in corpus["cases"]:
        try:
            canonical = _validate_corpus_case(case["kind"], case["value"])
        except (CspError, KeyError, TypeError, ValueError) as error:
            assert not case["valid"], case["id"]
            assert validation_error_code(error) == case["error_code"], case["id"]
        else:
            assert case["valid"], case["id"]
            assert canonical == case["value"], case["id"]


@PROPERTY_SETTINGS
@given(
    message_id=safe_text,
    session_id=safe_text,
    channel=safe_text,
    source=safe_text,
    sequence=st.integers(min_value=0, max_value=2**32),
    payload=json_values,
    requires_ack=st.booleans(),
)
def test_envelope_roundtrip_property(
    message_id: str,
    session_id: str,
    channel: str,
    source: str,
    sequence: int,
    payload: Any,
    requires_ack: bool,
) -> None:
    envelope = MessageEnvelope(
        message_id=message_id,
        session_id=session_id,
        channel=channel,
        kind="data",
        source=source,
        sequence=sequence,
        payload_type="json",
        payload=payload,
        created_at="2026-01-01T00:00:00Z",
        idempotency_key=f"key-{message_id}",
        requires_ack=requires_ack,
    )
    decoded = MessageEnvelope.from_json(envelope.to_json())
    assert decoded == envelope
    retried = envelope.next_attempt()
    assert retried.message_id == envelope.message_id
    assert retried.idempotency_key == envelope.idempotency_key
    assert retried.attempt == envelope.attempt + 1


@PROPERTY_SETTINGS
@given(
    capacity=st.integers(min_value=1, max_value=4096),
    max_message_bytes=st.integers(min_value=1024, max_value=16 * 1024 * 1024),
    attempts=st.integers(min_value=1, max_value=100),
    base_delay=st.integers(min_value=0, max_value=1000),
    delay_delta=st.integers(min_value=0, max_value=1000),
)
def test_configuration_roundtrip_property(
    capacity: int,
    max_message_bytes: int,
    attempts: int,
    base_delay: int,
    delay_delta: int,
) -> None:
    config = SessionConfig(
        session_id="property",
        channel_capacity=capacity,
        max_message_bytes=max_message_bytes,
        retry_policy=RetryPolicy(
            max_attempts=attempts,
            base_delay_ms=base_delay,
            max_delay_ms=base_delay + delay_delta,
        ),
    )
    assert SessionConfig.from_dict(config.to_dict()) == config


@PROPERTY_SETTINGS
@given(secret=secret_text)
def test_error_sanitization_never_leaks_common_secret_prefixes(secret: str) -> None:
    message = f"failure Bearer {secret} sk-{secret} gsk_{secret} pypi-{secret}\nnext"
    sanitized = sanitize_error_message(message)
    for prefix in ("Bearer ", "sk-", "gsk_", "pypi-"):
        assert f"{prefix}{secret}" not in sanitized
    assert "\n" not in sanitized
    assert len(sanitized.encode("utf-8")) <= 2048


@PROPERTY_SETTINGS
@given(
    commands=st.lists(
        st.sampled_from(("send", "receive", "ack", "nack", "cancel", "close")),
        min_size=1,
        max_size=40,
    )
)
def test_session_state_machine_property(commands: list[str]) -> None:
    async def scenario() -> None:
        session = CspRuntime().create_session(
            config=SessionConfig(session_id="state-machine", channel_capacity=4)
        )
        channel = session.channel("work", capacity=4)
        expected: list[str] = []
        received: list[MessageEnvelope] = []
        sequence = 0

        for command in commands:
            if command == "send" and not session.closed and not session.cancelled:
                envelope = make_envelope(
                    session_id=session.session_id,
                    channel="work",
                    source="property",
                    sequence=sequence,
                    payload_type="json",
                    payload={"sequence": sequence},
                )
                sequence += 1
                if channel.qsize() < channel.config.capacity:
                    await session.send("work", envelope)
                    expected.append(envelope.message_id)
            elif command == "receive" and expected and not session.cancelled and not session.closed:
                envelope = await session.receive("work")
                assert envelope.message_id == expected.pop(0)
                received.append(envelope)
            elif command == "ack" and received:
                envelope = received.pop(0)
                assert session.ack(envelope).message_id == envelope.message_id
            elif command == "nack" and received:
                envelope = received.pop(0)
                nack = session.nack(
                    envelope,
                    code="permanent",
                    message="stop",
                    retryable=False,
                )
                assert not nack.retryable
            elif command == "cancel":
                session.cancel()
                session.cancel()
            elif command == "close":
                await asyncio.wait_for(session.close(), timeout=1)
                await asyncio.wait_for(session.close(), timeout=1)

            assert channel.qsize() <= channel.config.capacity
            assert set(session._pending_envelopes) == {  # noqa: SLF001
                envelope.message_id for envelope in received
            }

        await asyncio.wait_for(session.close(), timeout=1)
        assert all(handle.done for handle in session._processes.values())  # noqa: SLF001

    asyncio.run(scenario())


@PROPERTY_SETTINGS
@given(values=st.lists(st.integers(), min_size=2, max_size=20, unique=True))
def test_fifo_and_duplicate_suppression_property(values: list[int]) -> None:
    async def scenario() -> None:
        session = CspRuntime().create_session(
            config=SessionConfig(session_id="fifo-property", channel_capacity=len(values) + 1)
        )
        channel = session.channel("work", capacity=len(values) + 1)
        envelopes = [
            MessageEnvelope(
                message_id=f"msg-{index}",
                session_id=session.session_id,
                channel="work",
                kind="data",
                source="property",
                sequence=index,
                payload_type="json",
                payload=value,
                idempotency_key=f"key-{index}",
            )
            for index, value in enumerate(values)
        ]
        for envelope in envelopes:
            await channel.send(envelope)
        duplicate = MessageEnvelope.from_dict(
            {**envelopes[-1].to_dict(), "message_id": "duplicate-last"}
        )
        await channel.send(duplicate)
        assert [await session.receive("work") for _ in values] == envelopes
        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(session.receive("work"), timeout=0.002)
        await session.close()

    asyncio.run(scenario())


def test_ack_never_resolves_another_message() -> None:
    first = MessageEnvelope(
        message_id="first",
        session_id="ack",
        channel="work",
        kind="data",
        source="test",
        sequence=1,
        payload_type="json",
        payload={},
    )
    second = MessageEnvelope.from_dict({**first.to_dict(), "message_id": "second"})
    session = CspRuntime().create_session(config=SessionConfig(session_id="ack"))
    session._pending_envelopes[first.message_id] = first  # noqa: SLF001
    session._pending_envelopes[second.message_id] = second  # noqa: SLF001
    session.ack(first)
    assert first.message_id not in session._pending_envelopes  # noqa: SLF001
    assert second.message_id in session._pending_envelopes  # noqa: SLF001


def test_rejecting_channel_reports_backpressure() -> None:
    async def scenario() -> None:
        runtime = CspRuntime()
        session = runtime.create_session(config=SessionConfig(session_id="reject"))
        channel = session.channel("work", capacity=1)
        channel.config = ChannelConfig(
            name="work", capacity=1, overflow_policy=OverflowPolicy.REJECT
        )
        await channel.send(
            make_envelope(
                session_id="reject",
                channel="work",
                source="test",
                sequence=1,
                payload_type="json",
                payload={},
            )
        )
        with pytest.raises(BackpressureError):
            await channel.send(
                make_envelope(
                    session_id="reject",
                    channel="work",
                    source="test",
                    sequence=2,
                    payload_type="json",
                    payload={},
                )
            )
        await session.close()

    asyncio.run(scenario())
