from handoffkit import HandoffState


def test_create_handoff_state() -> None:
    state = HandoffState(
        task="Build package",
        from_agent="Architect",
        to_agent="Coder",
        summary="Plan complete",
        decisions=["Use dataclasses"],
        important_files=["pyproject.toml"],
        errors=[],
        next_steps=["Implement"],
        metadata={"mode": "hybrid_state"},
    )

    assert state.to_dict()["from_agent"] == "Architect"
    assert state.next_steps == ["Implement"]


def test_handoff_json_roundtrip() -> None:
    state = HandoffState(
        task="Build package",
        from_agent="Architect",
        to_agent="Coder",
        summary="Plan complete",
    )

    loaded = HandoffState.from_json(state.to_json())

    assert loaded.task == state.task
    assert loaded.summary == state.summary
