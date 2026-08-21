"""Provider adapters. Scaffold only. No silent fallback. Not live-tested."""

from __future__ import annotations

from typing import Any, Protocol

from handoffkit.clinical.constants import PROVIDER_STATUS
from handoffkit.clinical.errors import ClinicalError


class ProviderAdapter(Protocol):
    name: str
    status: dict[str, Any]

    def generate(self, prompt: str, **kwargs: Any) -> str: ...


class UnavailableAdapter:
    def __init__(self, name: str) -> None:
        self.name = name
        self.status = dict(PROVIDER_STATUS.get(name, {}))
        self.status.setdefault("declared", True)
        self.status.setdefault("adapter", "scaffold")
        self.status.setdefault("integrated", False)
        self.status.setdefault("live_tested", False)
        self.status.setdefault("available", False)

    def generate(self, prompt: str, **kwargs: Any) -> str:
        raise ClinicalError(
            f"{self.name} adapter is a scaffold and is not live-tested",
            code="provider_unavailable",
            details={"provider": self.name, **self.status},
        )


PROVIDERS = {
    "ollama": lambda: UnavailableAdapter("ollama"),
    "nvidia": lambda: UnavailableAdapter("nvidia"),
    "groq": lambda: UnavailableAdapter("groq"),
    "opencode": lambda: UnavailableAdapter("opencode"),
}


def get_provider(name: str) -> ProviderAdapter:
    key = (name or "").strip().lower()
    if key not in PROVIDERS:
        raise ClinicalError(
            f"unknown provider {name}",
            code="provider_unavailable",
            details={"provider": name, "declared": False, "available": False},
        )
    return PROVIDERS[key]()
