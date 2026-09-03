"""Provider interface."""

from __future__ import annotations

import asyncio
from abc import ABC, abstractmethod
from typing import Any


class BaseProvider(ABC):
    """Base class for text generation providers."""

    model: str

    @abstractmethod
    def generate(self, prompt: str, **kwargs: Any) -> str:
        """Generate a response for a prompt."""

    async def agenerate(self, prompt: str, **kwargs: Any) -> str:
        """Generate a response asynchronously using the sync provider by default."""
        return await asyncio.to_thread(self.generate, prompt, **kwargs)
