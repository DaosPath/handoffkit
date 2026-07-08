"""Pick the best available Freemodel model and run a short demo."""

from __future__ import annotations

import os

from handoffkit import Agent
from handoffkit.providers import EchoProvider, OpenAIProvider, choose_openai_compatible_model


def main() -> None:
    """Choose a model, print the choice, and run one short request."""
    if not os.getenv("OPENAI_API_KEY"):
        print("OPENAI_API_KEY is not set; using EchoProvider fallback.")
        provider = EchoProvider(model="echo")
        agent = Agent(
            name="FreemodelBestModelAgent",
            role="Create concise architecture plans.",
            provider=provider,
        )
        print("Model used: echo")
        print(
            agent.run("Create a concise architecture plan for a Python CLI calculator.")
        )
        return

    base_url = os.getenv("OPENAI_BASE_URL", "https://api.freemodel.dev/v1")
    selection = choose_openai_compatible_model(base_url=base_url)

    if selection.models_endpoint_ok:
        preview = ", ".join(selection.available_models[:10])
        suffix = " ..." if len(selection.available_models) > 10 else ""
        print(f"/models OK: {preview}{suffix}")
    else:
        print(f"/models unavailable: {selection.errors.get('/models', 'unknown error')}")

    print(f"Model used: {selection.model}")

    provider = OpenAIProvider(
        model=selection.model,
        base_url=selection.base_url,
    )
    agent = Agent(
        name="FreemodelBestModelAgent",
        role="Create concise architecture plans.",
        provider=provider,
    )
    response = agent.run(
        "Create a concise architecture plan for a Python CLI calculator.",
        max_tokens=120,
        temperature=0,
    )
    print(response)


if __name__ == "__main__":
    main()
