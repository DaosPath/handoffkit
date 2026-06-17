import json
import urllib.error
import urllib.request

import pytest

from handoffkit.errors import ProviderConfigurationError, ProviderExecutionError
from handoffkit.providers import OpenAIProvider


class FakeResponse:
    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def read(self) -> bytes:
        return b'{"choices": [{"message": {"content": "compatible response"}}]}'


def test_openai_provider_reads_env_model_base_url_and_key(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setenv("OPENAI_API_KEY", "test-secret")
    monkeypatch.setenv("OPENAI_BASE_URL", "https://example.test/v1")
    monkeypatch.setenv("OPENAI_MODEL", "compatible-model")
    captured: dict[str, object] = {}

    def fake_urlopen(request: urllib.request.Request, timeout: float) -> FakeResponse:
        captured["url"] = request.full_url
        captured["data"] = request.data
        captured["auth"] = request.headers["Authorization"]
        captured["timeout"] = timeout
        return FakeResponse()

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)

    provider = OpenAIProvider(timeout=3.0)
    response = provider.generate("Hello", max_tokens=8)

    payload = json.loads(captured["data"].decode("utf-8"))  # type: ignore[union-attr]
    assert response == "compatible response"
    assert captured["url"] == "https://example.test/v1/chat/completions"
    assert captured["auth"] == "Bearer test-secret"
    assert captured["timeout"] == 3.0
    assert payload["model"] == "compatible-model"
    assert payload["messages"][0]["content"] == "Hello"
    assert payload["max_tokens"] == 8


def test_openai_provider_requires_api_key(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    with pytest.raises(ProviderConfigurationError, match="OPENAI_API_KEY is required"):
        OpenAIProvider()


def test_openai_provider_sanitizes_http_errors(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    secret = "test-secret"

    def fake_urlopen(request: urllib.request.Request, timeout: float) -> FakeResponse:
        raise urllib.error.HTTPError(
            url=request.full_url,
            code=401,
            msg="Unauthorized",
            hdrs=None,
            fp=FakeErrorBody(f"bad token {secret}".encode()),
        )

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)

    provider = OpenAIProvider(api_key=secret)
    with pytest.raises(ProviderExecutionError) as exc_info:
        provider.generate("Hello")

    message = str(exc_info.value)
    assert "[redacted-api-key]" in message
    assert secret not in message


class FakeErrorBody:
    def __init__(self, body: bytes) -> None:
        self.body = body

    def read(self) -> bytes:
        return self.body

    def close(self) -> None:
        return None
