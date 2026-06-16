"""Provider interface."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class BaseProvider(ABC):
    """Base class for text generation providers."""

    model: str

    @abstractmethod
    def generate(self, prompt: str, **kwargs: Any) -> str:
        """Generate a response for a prompt."""
