import pytest

from handoffkit import Agent, HandoffProtocol
from handoffkit.errors import ProtocolError


@pytest.mark.parametrize("mode", ["natural", "compressed", "hybrid_min", "hybrid_state"])
def test_protocol_modes(mode: str) -> None:
    architect = Agent("Architect", "Create plans")
    coder = Agent("Coder", "Write code")
    protocol = HandoffProtocol(mode=mode)  # type: ignore[arg-type]

    state = protocol.transfer(
        from_agent=architect,
        to_agent=coder,
        task="Build a package",
        summary="Use structured state",
    )

    assert state.from_agent == "Architect"
    assert state.to_agent == "Coder"
    assert state.metadata["mode"] == mode


def test_invalid_protocol_mode() -> None:
    with pytest.raises(ProtocolError):
        HandoffProtocol(mode="invalid")  # type: ignore[arg-type]


def test_hybrid_min_only_keeps_minimal_state() -> None:
    protocol = HandoffProtocol(mode="hybrid_min")
    state = protocol.transfer(
        from_agent=Agent("A", "Plan"),
        to_agent=Agent("B", "Build"),
        task="Task",
        summary="Summary",
    )

    assert state.decisions == []
    assert state.important_files == []
    assert state.errors == []
    assert state.next_steps
