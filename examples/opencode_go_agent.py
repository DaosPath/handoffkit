"""Run HandoffKit against OpenCode Go.

Requires OPENCODE_API_KEY. No secrets are printed.
"""

from __future__ import annotations

import os
import sys

from handoffkit import Agent
from handoffkit.errors import ProviderConfigurationError, ProviderExecutionError
from handoffkit.providers import DEFAULT_OPENCODE_GO_MODEL, OpenCodeGoProvider


def _configure_stdout() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def main() -> None:
    _configure_stdout()
    api_key = os.getenv("OPENCODE_API_KEY")
    model = os.getenv("OPENCODE_GO_MODEL", DEFAULT_OPENCODE_GO_MODEL)
    if not api_key:
        print("OPENCODE_API_KEY is not set.")
        print('Set it with: $env:OPENCODE_API_KEY="..."')
        print(f"Optional model: $env:OPENCODE_GO_MODEL=\"{DEFAULT_OPENCODE_GO_MODEL}\"")
        return

    try:
        provider = OpenCodeGoProvider(model=model, api_key=api_key)
        agent = Agent(
            name="OpenCodeGoArchitect",
            role="Create concise coding architecture plans.",
            provider=provider,
        )
        response = agent.run("Create a concise architecture plan for a Python CLI calculator.")
    except (ProviderConfigurationError, ProviderExecutionError) as exc:
        print(f"OpenCode Go unavailable: {exc}")
        return

    print("Provider: OpenCode Go")
    print(f"Model: {model}")
    print(response)


if __name__ == "__main__":
    main()
