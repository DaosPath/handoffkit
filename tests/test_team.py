from handoffkit import Agent, HandoffProtocol, Team
from handoffkit.cli import main


def test_team_run_with_multiple_agents() -> None:
    team = Team(
        agents=[
            Agent("Architect", "Plan"),
            Agent("Coder", "Code"),
            Agent("Tester", "Test"),
        ],
        protocol=HandoffProtocol(mode="hybrid_state"),
    )

    result = team.run("Create a calculator")

    assert "EchoProvider" in str(result)
    assert len(result.agent_outputs) == 3
    assert len(result.handoffs) == 2
    assert result.handoffs[0].metadata["mode"] == "hybrid_state"


def test_cli_demo(capsys) -> None:  # type: ignore[no-untyped-def]
    exit_code = main(["demo"])

    captured = capsys.readouterr()

    assert exit_code == 0
    assert "HandoffKit demo" in captured.out
    assert "hybrid_state" in captured.out
