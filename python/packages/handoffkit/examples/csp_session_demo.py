"""Run a local HK-CSP team session without provider API calls."""

from handoffkit import Agent, RuntimeMode, Team
from handoffkit.providers import EchoProvider


def main() -> None:
    team = Team(
        [
            Agent("Architect", "Plan the task.", provider=EchoProvider()),
            Agent("Builder", "Build from the structured handoff.", provider=EchoProvider()),
            Agent("Reviewer", "Review the result.", provider=EchoProvider()),
        ],
        runtime_mode=RuntimeMode.SESSION,
    )
    result = team.run("Design a bounded worker queue.")
    print(result.final_output)
    print(f"handoffs={len(result.handoffs)} runtime=session")


if __name__ == "__main__":
    main()
