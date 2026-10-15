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


def test_protocol_modes_produce_distinct_state_shapes() -> None:
    architect = Agent("Architect", "Create plans")
    coder = Agent("Coder", "Write code")
    long_summary = " ".join(["Keep structured state"] * 80)

    natural_state = HandoffProtocol(mode="natural").transfer(
        from_agent=architect,
        to_agent=coder,
        task="Build a package",
        summary=long_summary,
    )
    compressed_state = HandoffProtocol(mode="compressed").transfer(
        from_agent=architect,
        to_agent=coder,
        task="Build a package",
        summary=long_summary,
    )
    hybrid_min_state = HandoffProtocol(mode="hybrid_min").transfer(
        from_agent=architect,
        to_agent=coder,
        task="Build a package",
        summary=long_summary,
    )
    hybrid_state = HandoffProtocol(mode="hybrid_state").transfer(
        from_agent=architect,
        to_agent=coder,
        task="Build a package",
        summary=long_summary,
        decisions=["Use pyproject.toml"],
        important_files=["pyproject.toml"],
        errors=["No blocker"],
        next_steps=["Run tests"],
        metadata={"release": "0.2.0"},
    )

    assert natural_state.summary.startswith("Architect is handing off to Coder")
    assert compressed_state.summary.endswith("...")
    assert len(compressed_state.summary) <= 360
    assert hybrid_min_state.decisions == []
    assert hybrid_min_state.important_files == []
    assert hybrid_min_state.errors == []
    assert hybrid_state.decisions == ["Use pyproject.toml"]
    assert hybrid_state.important_files == ["pyproject.toml"]
    assert hybrid_state.errors == ["No blocker"]
    assert hybrid_state.next_steps == ["Run tests"]
    assert hybrid_state.metadata["release"] == "0.2.0"


def test_hybrid_state_accepts_context_refs() -> None:
    protocol = HandoffProtocol(mode="hybrid_state")
    state = protocol.transfer(
        from_agent=Agent("Architect", "Plan"),
        to_agent=Agent("Coder", "Build"),
        task="Use context",
        summary="Context ready",
        context_refs=["README.md", "tests/test_handoff.py"],
    )

    assert state.context_refs == ["README.md", "tests/test_handoff.py"]
    assert "context_refs" in state.metadata["state_contract"]
