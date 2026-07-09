from __future__ import annotations

import pytest

from handoffkit.errors import ProviderExecutionError
from handoffkit.providers import EchoProvider, FallbackProvider, BaseProvider


class BrokenProvider(BaseProvider):
    """A provider that always throws an error."""
    
    def __init__(self) -> None:
        self.model = "broken-model"

    def generate(self, prompt: str, **kwargs) -> str:
        raise ProviderExecutionError("Network connection failed")


def test_fallback_provider_fails_over() -> None:
    broken = BrokenProvider()
    echo = EchoProvider(model="backup")
    
    fallback = FallbackProvider([broken, echo])
    
    # Generate should fail over to the echo provider
    res = fallback.generate("hello")
    assert "EchoProvider[backup]" in res


def test_fallback_provider_all_fail() -> None:
    broken1 = BrokenProvider()
    broken2 = BrokenProvider()
    
    fallback = FallbackProvider([broken1, broken2])
    
    with pytest.raises(ProviderExecutionError) as exc_info:
        fallback.generate("hello")
    
    assert "All fallback providers failed" in str(exc_info.value)
