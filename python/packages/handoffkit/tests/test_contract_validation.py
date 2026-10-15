import pytest

from handoffkit import HandoffState, HandoffValidationError


def test_handoff_state_validate_accepts_valid_contract() -> None:
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

    assert state.validate() is state


def test_handoff_state_validate_rejects_missing_required_text() -> None:
    state = HandoffState(task="", from_agent="Architect", to_agent="Coder")

    with pytest.raises(HandoffValidationError, match="task"):
        state.validate()


def test_handoff_state_validate_rejects_invalid_list_fields() -> None:
    state = HandoffState(task="Task", from_agent="Architect", to_agent="Coder")
    state.context_refs = "README.md"  # type: ignore[assignment]

    with pytest.raises(HandoffValidationError, match="context_refs"):
        state.validate()


def test_handoff_state_validate_rejects_invalid_summary_and_metadata() -> None:
    state = HandoffState(task="Task", from_agent="Architect", to_agent="Coder")
    state.summary = ["not a string"]  # type: ignore[assignment]
    state.metadata = ["not a dict"]  # type: ignore[assignment]

    with pytest.raises(HandoffValidationError, match="summary.*metadata"):
        state.validate()


def test_handoff_state_from_dict_preserves_invalid_shape_for_validation() -> None:
    state = HandoffState.from_dict(
        {
            "task": "Task",
            "from_agent": "Architect",
            "to_agent": "Coder",
            "summary": "Plan",
            "decisions": "Use strings, not a list",
        }
    )

    with pytest.raises(HandoffValidationError, match="decisions"):
        state.validate()
