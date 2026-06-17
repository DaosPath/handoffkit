"""Run Architect -> Coder -> Tester through an OpenAI-compatible endpoint."""

from __future__ import annotations

import os

from handoffkit import Agent, HandoffProtocol
from handoffkit.providers import OpenAIProvider


def make_provider() -> OpenAIProvider:
    """Create a Freemodel-compatible provider from environment variables."""
    if not os.getenv("OPENAI_API_KEY"):
        raise SystemExit("OPENAI_API_KEY is required.")
    return OpenAIProvider(
        model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
        base_url=os.getenv("OPENAI_BASE_URL", "https://api.freemodel.dev/v1"),
        timeout=45.0,
    )


def main() -> None:
    """Run a small real API multi-agent handoff."""
    task = "Create a tiny plan for a Python CLI calculator. Keep it short."
    protocol = HandoffProtocol(mode="hybrid_state")
    provider = make_provider()

    architect = Agent(
        "Architect",
        "Create two short implementation decisions and one next step.",
        provider=provider,
    )
    coder = Agent(
        "Coder",
        "Turn the handoff into a tiny implementation outline.",
        provider=provider,
    )
    tester = Agent(
        "Tester",
        "Review the handoff and produce a brief final test note.",
        provider=provider,
    )

    architect_output = architect.run(task, max_tokens=80, temperature=0)
    coder_state = protocol.transfer(
        from_agent=architect,
        to_agent=coder,
        task=task,
        summary=architect_output,
        decisions=["Keep CLI calculator tiny.", "Use argparse-style commands."],
        next_steps=["Coder should outline add/subtract commands."],
    ).validate()
    coder_output = coder.run(task, handoff_state=coder_state, max_tokens=80, temperature=0)
    tester_state = protocol.transfer(
        from_agent=coder,
        to_agent=tester,
        task=task,
        summary=coder_output,
        decisions=coder_state.decisions,
        next_steps=["Tester should name one verification command."],
    ).validate()
    final_output = tester.run(task, handoff_state=tester_state, max_tokens=80, temperature=0)
    print(final_output)


if __name__ == "__main__":
    main()
