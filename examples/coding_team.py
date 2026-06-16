"""Architect -> Coder -> Tester structured handoff demo."""

from handoffkit import Agent, HandoffProtocol


def main() -> None:
    """Run a visible three-agent handoff chain."""
    task = "Create a small Python CLI calculator with tests."
    protocol = HandoffProtocol(mode="hybrid_state")

    architect = Agent("Architect", "Create implementation plans.")
    coder = Agent("Coder", "Implement code based on structured state.")
    tester = Agent("Tester", "Review implementation and report test gaps.")

    architect_output = architect.run(task)
    coder_state = protocol.transfer(
        from_agent=architect,
        to_agent=coder,
        task=task,
        summary=architect_output,
        decisions=["Expose calculator operations through a small CLI."],
        important_files=["pyproject.toml", "calculator.py", "tests/test_calculator.py"],
        next_steps=["Implement CLI parser.", "Add pytest coverage for add/subtract."],
    ).validate()
    coder_output = coder.run(task, handoff_state=coder_state)

    tester_state = protocol.transfer(
        from_agent=coder,
        to_agent=tester,
        task=task,
        summary=coder_output,
        decisions=coder_state.decisions + ["Keep CLI behavior deterministic."],
        important_files=coder_state.important_files,
        next_steps=["Run pytest.", "Report missing edge cases."],
    ).validate()
    tester_output = tester.run(task, handoff_state=tester_state)

    print("=== Architect -> Coder HandoffState ===")
    print(coder_state.to_json())
    print("\n=== Coder -> Tester HandoffState ===")
    print(tester_state.to_json())
    print("\n=== Tester Output ===")
    print(tester_output)


if __name__ == "__main__":
    main()
