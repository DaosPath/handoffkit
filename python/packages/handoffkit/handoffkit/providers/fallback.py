"""Fallback and failover model routing provider."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from handoffkit.errors import ProviderConfigurationError, ProviderExecutionError
from handoffkit.providers.base import BaseProvider


class FallbackProvider(BaseProvider):
    """Fallback provider that fails over to a sequence of underlying providers."""

    def __init__(
        self,
        providers: Sequence[BaseProvider],
        *,
        model: str | None = None,
    ) -> None:
        self.providers = [p for p in providers if p is not None]
        if not self.providers:
            raise ProviderConfigurationError(
                "FallbackProvider requires at least one underlying provider."
            )
        self.model = model or self.providers[0].model

    def generate(self, prompt: str, **kwargs: Any) -> str:
        """Generate a response using the first working provider."""
        errors: list[Exception] = []
        for provider in self.providers:
            try:
                return provider.generate(prompt, **kwargs)
            except Exception as exc:
                errors.append(exc)

        parts = []
        for err, provider in zip(errors, self.providers, strict=True):
            name = getattr(err, "provider", provider.__class__.__name__)
            parts.append(f"[{name}]: {err}")
        raise ProviderExecutionError(f"All fallback providers failed: {'; '.join(parts)}")

    async def agenerate(self, prompt: str, **kwargs: Any) -> str:
        """Asynchronously generate a response using the first working provider."""
        errors: list[Exception] = []
        for provider in self.providers:
            try:
                return await provider.agenerate(prompt, **kwargs)
            except Exception as exc:
                errors.append(exc)

        parts = []
        for err, provider in zip(errors, self.providers, strict=True):
            name = getattr(err, "provider", provider.__class__.__name__)
            parts.append(f"[{name}]: {err}")
        raise ProviderExecutionError(f"All fallback providers failed: {'; '.join(parts)}")
