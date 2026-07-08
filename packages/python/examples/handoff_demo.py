"""Architect to Coder handoff demo."""

from handoffkit import Agent, HandoffProtocol


def main() -> None:
    """Create and print one structured handoff state."""
    architect = Agent(
        name="Architect",
        role="Analyze projects and create technical plans.",
    )
    coder = Agent(
        name="Coder",
        role="Write code based on received handoff state.",
    )

    protocol = HandoffProtocol(mode="hybrid_state")
    architect_summary = (
        "Use a src-like package layout, keep dependencies empty, "
        "add pytest coverage, and validate wheel metadata before publishing."
    )
    state = protocol.transfer(
        from_agent=architect,
        to_agent=coder,
        task="Prepare a Python package for PyPI.",
        summary=architect_summary,
        decisions=["Keep package runtime dependency-free.", "Ship py.typed."],
        important_files=["pyproject.toml", "README.md", "handoffkit/"],
        next_steps=["Implement package changes.", "Run pytest and twine check."],
    )
    state.validate()
    print(state.to_json())


if __name__ == "__main__":
    main()
