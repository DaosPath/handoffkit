"""Local provider that returns deterministic useful text."""

from __future__ import annotations

from typing import Any

from handoffkit.providers.base import BaseProvider


class EchoProvider(BaseProvider):
    """Provider for local tests and demos without external APIs."""

    def __init__(self, model: str = "echo") -> None:
        self.model = model

    def generate(self, prompt: str, **kwargs: Any) -> str:
        """Return a deterministic response summarizing the prompt."""
        preview = " ".join(prompt.strip().split())
        if len(preview) > 420:
            preview = preview[:417].rstrip() + "..."
        return (
            f"EchoProvider[{self.model}] response\n"
            f"Summary: {preview}\n"
            "Decisions: keep state explicit, preserve constraints, continue with next step.\n"
            "Next steps: inspect the handoff state, act on the task, report errors."
        )
