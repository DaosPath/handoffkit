from handoffkit import Agent


def test_create_agent() -> None:
    agent = Agent(name="Planner", role="Create plans")

    description = agent.describe()

    assert description["name"] == "Planner"
    assert description["provider"] == "EchoProvider"


def test_run_agent_with_echo_provider() -> None:
    agent = Agent(name="Planner", role="Create plans")

    result = agent.run("Build a CLI")

    assert "EchoProvider" in result
    assert "Build a CLI" in result
