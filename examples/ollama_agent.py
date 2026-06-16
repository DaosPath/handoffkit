"""Run HandoffKit with a real local Ollama model."""

from __future__ import annotations

import argparse
import os
import sys

from handoffkit import Agent
from handoffkit.errors import ProviderExecutionError
from handoffkit.providers import OllamaProvider


def main(argv: list[str] | None = None) -> int:
    """Run an Ollama-backed agent with a configurable model."""
    parser = argparse.ArgumentParser(description="Run a HandoffKit agent with Ollama.")
    parser.add_argument(
        "prompt",
        nargs="?",
        default="Explain structured agent handoffs in one paragraph.",
    )
    parser.add_argument("--model", default=os.getenv("OLLAMA_MODEL", "llama3.1"))
    parser.add_argument("--base-url", default=os.getenv("OLLAMA_BASE_URL", "http://localhost:11434"))
    parser.add_argument("--timeout", type=float, default=30.0)
    args = parser.parse_args(argv)

    agent = Agent(
        name="LocalOllamaAgent",
        role="Answer using a local Ollama model.",
        provider=OllamaProvider(
            model=args.model,
            base_url=args.base_url,
            timeout=args.timeout,
        ),
    )
    try:
        print(agent.run(args.prompt))
    except ProviderExecutionError as exc:
        print(
            "Ollama is not reachable. Start Ollama and pull the model first, for example:\n"
            f"  ollama pull {args.model}\n"
            "  ollama serve\n\n"
            f"Provider error: {exc}",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
