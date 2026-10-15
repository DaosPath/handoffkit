from handoffkit import Agent, HandoffProtocol, HandoffState


def test_architect_coder_tester_passes_structured_handoff_state() -> None:
    task = "Create a Python CLI calculator with tests."
    protocol = HandoffProtocol(mode="hybrid_state")
    architect = Agent("Architect", "Plan the implementation.")
    coder = Agent("Coder", "Implement from structured state.")
    tester = Agent("Tester", "Test from structured state.")

    architect_output = architect.run(task)
    coder_state = protocol.transfer(
        from_agent=architect,
        to_agent=coder,
        task=task,
        summary=architect_output,
        decisions=["Use argparse for the CLI."],
        important_files=["calculator.py", "tests/test_calculator.py"],
        next_steps=["Write implementation.", "Run pytest."],
    )
    coder_output = coder.run(task, handoff_state=coder_state)
    tester_state = protocol.transfer(
        from_agent=coder,
        to_agent=tester,
        task=task,
        summary=coder_output,
        errors=[],
        next_steps=["Verify CLI behavior.", "Report regressions."],
    )

    assert isinstance(coder_state, HandoffState)
    assert coder_state.from_agent == "Architect"
    assert coder_state.to_agent == "Coder"
    assert coder_state.decisions == ["Use argparse for the CLI."]
    assert tester_state.from_agent == "Coder"
    assert tester_state.to_agent == "Tester"
    assert tester_state.validate() is tester_state
