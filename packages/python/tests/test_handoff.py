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
        context_refs=["README.md", "pyproject.toml"],
    )

    loaded = HandoffState.from_json(state.to_json())

    assert loaded.task == state.task
    assert loaded.summary == state.summary
    assert loaded.context_refs == ["README.md", "pyproject.toml"]


def test_handoff_markdown_roundtrip() -> None:
    state = HandoffState(
        task="Build package",
        from_agent="Architect",
        to_agent="Coder",
        summary="Plan complete",
        decisions=["Use dataclasses"],
        important_files=["pyproject.toml"],
        errors=["None"],
        next_steps=["Implement"],
        context_refs=["README.md"],
    )

    md = state.to_markdown()
    loaded = HandoffState.from_markdown(md)

    assert loaded.task == "Build package"
    assert loaded.from_agent == "Architect"
    assert loaded.to_agent == "Coder"
    assert loaded.summary == "Plan complete"
    assert loaded.decisions == ["Use dataclasses"]
    assert loaded.important_files == ["pyproject.toml"]
    assert loaded.errors == ["None"]
    assert loaded.next_steps == ["Implement"]
    assert loaded.context_refs == ["README.md"]

