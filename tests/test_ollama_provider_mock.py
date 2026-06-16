import json
import urllib.error
import urllib.request

import pytest

from handoffkit.errors import ProviderExecutionError
from handoffkit.providers import OllamaProvider


class FakeResponse:
    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def read(self) -> bytes:
        return b'{"response": "local model response"}'


def test_ollama_provider_posts_generate_request(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    captured: dict[str, object] = {}

    def fake_urlopen(request: urllib.request.Request, timeout: float) -> FakeResponse:
        captured["url"] = request.full_url
        captured["data"] = request.data
        captured["timeout"] = timeout
        return FakeResponse()

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)

    provider = OllamaProvider(model="llama3.1", timeout=3.0)
    response = provider.generate("Hello")

    payload = json.loads(captured["data"].decode("utf-8"))  # type: ignore[union-attr]
    assert response == "local model response"
    assert captured["url"] == "http://localhost:11434/api/generate"
    assert captured["timeout"] == 3.0
    assert payload["model"] == "llama3.1"
    assert payload["prompt"] == "Hello"
    assert payload["stream"] is False


def test_ollama_provider_raises_clear_execution_error(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    def fake_urlopen(request: urllib.request.Request, timeout: float) -> FakeResponse:
        raise urllib.error.URLError("connection refused")

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)

    provider = OllamaProvider(timeout=0.01)
    with pytest.raises(ProviderExecutionError, match="Ollama request failed"):
        provider.generate("Hello")
