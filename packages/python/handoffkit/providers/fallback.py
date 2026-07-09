"""Fallback and failover model routing provider."""

from __future__ import annotations

import asyncio
from typing import Any, Sequence

from handoffkit.errors import ProviderExecutionError, ProviderConfigurationError
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
            raise ProviderConfigurationError("FallbackProvider requires at least one underlying provider.")
        self.model = model or self.providers[0].model

    def generate(self, prompt: str, **kwargs: Any) -> str:
        """Generate a response using the first working provider."""
        errors: list[Exception] = []
        for provider in self.providers:
            try:
                return provider.generate(prompt, **kwargs)
            except Exception as exc:
                errors.append(exc)

        messages = "; ".join(f"[{getattr(e, 'provider', provider.__class__.__name__)}]: {str(e)}" for e, provider in zip(errors, self.providers))
        raise ProviderExecutionError(f"All fallback providers failed: {messages}")

    async def agenerate(self, prompt: str, **kwargs: Any) -> str:
        """Asynchronously generate a response using the first working provider."""
        errors: list[Exception] = []
        for provider in self.providers:
            try:
                return await provider.agenerate(prompt, **kwargs)
            except Exception as exc:
                errors.append(exc)

        messages = "; ".join(f"[{getattr(e, 'provider', provider.__class__.__name__)}]: {str(e)}" for e, provider in zip(errors, self.providers))
        raise ProviderExecutionError(f"All fallback providers failed: {messages}")
