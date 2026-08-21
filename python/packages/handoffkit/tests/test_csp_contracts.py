from __future__ import annotations

import json
from pathlib import Path

import pytest

from handoffkit import (
    ArtifactRef,
    MessageEnvelope,
    ProtocolVersionError,
    RuntimeMode,
    SessionConfig,
)

CONTRACTS = Path(__file__).resolve().parents[4] / "shared" / "contracts"


@pytest.mark.monorepo
def test_message_envelope_fixture_roundtrip() -> None:
    data = json.loads((CONTRACTS / "fixtures/message_envelope.json").read_text("utf-8"))
    envelope = MessageEnvelope.from_dict(data)
    assert envelope.to_dict() == data
    assert envelope.payload_type == "handoff_state"


@pytest.mark.monorepo
def test_session_fixture_roundtrip() -> None:
    data = json.loads((CONTRACTS / "fixtures/session_config.json").read_text("utf-8"))
    assert SessionConfig.from_dict(data).to_dict() == data


@pytest.mark.monorepo
def test_artifact_fixture_roundtrip() -> None:
    data = json.loads((CONTRACTS / "fixtures/artifact_ref.json").read_text("utf-8"))
    assert ArtifactRef.from_dict(data).to_dict() == data


def test_runtime_modes_are_wire_values() -> None:
    assert [mode.value for mode in RuntimeMode] == ["classic", "session", "distributed"]


def test_unsupported_protocol_major_fails() -> None:
    with pytest.raises(ProtocolVersionError, match="Unsupported HK-CSP"):
        MessageEnvelope(
            protocol_version="2.0",
            message_id="msg",
            session_id="session",
            channel="tasks",
            kind="data",
            source="test",
            sequence=0,
            payload_type="json",
            payload={},
        )
