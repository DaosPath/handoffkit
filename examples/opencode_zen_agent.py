"""Run HandoffKit against OpenCode Zen.

Requires OPENCODE_API_KEY. No secrets are printed.
"""

from __future__ import annotations

import argparse
import os
import sys

from handoffkit import Agent
from handoffkit.errors import ProviderConfigurationError, ProviderExecutionError
from handoffkit.providers import DEFAULT_OPENCODE_ZEN_MODEL, OpenCodeZenProvider


def _configure_stdout() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run HandoffKit against OpenCode Zen.")
    parser.add_argument(
        "--model",
        default=os.getenv("OPENCODE_ZEN_MODEL", DEFAULT_OPENCODE_ZEN_MODEL),
        help="OpenCode Zen model id.",
    )
    parser.add_argument(
        "--task",
        default="Create a concise architecture plan for a Python CLI calculator.",
        help="Task prompt.",
    )
    return parser


def main(argv: list[str] | None = None) -> None:
    _configure_stdout()
    args = _parser().parse_args(argv)
    api_key = os.getenv("OPENCODE_API_KEY")
    if not api_key:
        print("OPENCODE_API_KEY is not set.")
        print('Set it with: $env:OPENCODE_API_KEY="..."')
        print(f"Optional model: $env:OPENCODE_ZEN_MODEL=\"{DEFAULT_OPENCODE_ZEN_MODEL}\"")
        print('Free Zen option: $env:OPENCODE_ZEN_MODEL="deepseek-v4-flash-free"')
        return

    try:
        provider = OpenCodeZenProvider(model=args.model, api_key=api_key)
        agent = Agent(
            name="OpenCodeZenArchitect",
            role="Create concise coding architecture plans.",
            provider=provider,
        )
        response = agent.run(args.task)
    except (ProviderConfigurationError, ProviderExecutionError) as exc:
        print(f"OpenCode Zen unavailable: {exc}")
        return

    print("Provider: OpenCode Zen")
    print(f"Model: {args.model}")
    print(response)


if __name__ == "__main__":
    main()
