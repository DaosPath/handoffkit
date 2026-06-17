"""Run HandoffKit against an OpenAI-compatible Freemodel endpoint."""

from __future__ import annotations

import os

from handoffkit import Agent
from handoffkit.providers import OpenAIProvider


def main() -> None:
    """Run a short real API call through OpenAIProvider."""
    if not os.getenv("OPENAI_API_KEY"):
        raise SystemExit("OPENAI_API_KEY is required.")

    provider = OpenAIProvider(
        model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
        base_url=os.getenv("OPENAI_BASE_URL", "https://api.freemodel.dev/v1"),
    )

    agent = Agent(
        name="FreemodelTestAgent",
        role="Reply briefly and clearly.",
        provider=provider,
    )

    result = agent.run("Reply with exactly: HandoffKit Freemodel OK")
    print(result)


if __name__ == "__main__":
    main()
