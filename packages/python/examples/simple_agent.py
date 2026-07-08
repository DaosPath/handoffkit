"""Basic EchoProvider agent example."""

from handoffkit import Agent


def main() -> None:
    """Run a deterministic local agent with the built-in EchoProvider."""
    agent = Agent(
        name="Planner",
        role="Create concise implementation plans with decisions and next steps.",
    )
    result = agent.run("Create a plan for a Python CLI app with tests.")
    print(result)


if __name__ == "__main__":
    main()
