import json
import urllib.error
import urllib.request

import pytest

from handoffkit.errors import ProviderConfigurationError, ProviderExecutionError
from handoffkit.providers import (
    OpenCodeGoProvider,
    OpenCodeZenProvider,
    infer_opencode_api_style,
    list_opencode_models,
)


class FakeResponse:
    def __init__(self, body: dict[str, object] | list[object]) -> None:
        self.body = json.dumps(body).encode("utf-8")

    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def read(self) -> bytes:
        return self.body


class FakeErrorBody:
    def __init__(self, body: bytes) -> None:
        self.body = body

    def read(self) -> bytes:
        return self.body

    def close(self) -> None:
        return None


def test_opencode_zen_gpt_uses_responses_endpoint(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setenv("OPENCODE_API_KEY", "test-secret")
    monkeypatch.setenv("OPENCODE_ZEN_MODEL", "gpt-5.4")
    captured: dict[str, object] = {}

    def fake_urlopen(request: urllib.request.Request, timeout: float) -> FakeResponse:
        captured["url"] = request.full_url
        captured["data"] = request.data
        captured["auth"] = request.headers["Authorization"]
        captured["timeout"] = timeout
        return FakeResponse({"output_text": "zen response"})

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)

    provider = OpenCodeZenProvider(timeout=3.0)
    response = provider.generate("Plan this", max_output_tokens=64)

    payload = json.loads(captured["data"].decode("utf-8"))  # type: ignore[union-attr]
    assert response == "zen response"
    assert captured["url"] == "https://opencode.ai/zen/v1/responses"
    assert captured["auth"] == "Bearer test-secret"
    assert captured["timeout"] == 3.0
    assert payload["model"] == "gpt-5.4"
    assert payload["input"] == "Plan this"
    assert payload["max_output_tokens"] == 64


def test_opencode_go_open_models_use_chat_completions(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    captured: dict[str, object] = {}

    def fake_urlopen(request: urllib.request.Request, timeout: float) -> FakeResponse:
        captured["url"] = request.full_url
        captured["data"] = request.data
        return FakeResponse({"choices": [{"message": {"content": "go response"}}]})

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)

    provider = OpenCodeGoProvider(model="deepseek-v4-flash", api_key="test-secret")
    response = provider.generate("Implement this", temperature=0)

    payload = json.loads(captured["data"].decode("utf-8"))  # type: ignore[union-attr]
    assert response == "go response"
    assert captured["url"] == "https://opencode.ai/zen/go/v1/chat/completions"
    assert payload["model"] == "deepseek-v4-flash"
    assert payload["messages"][0]["content"] == "Implement this"
    assert payload["temperature"] == 0


def test_opencode_go_qwen_uses_messages_endpoint(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    captured: dict[str, object] = {}

    def fake_urlopen(request: urllib.request.Request, timeout: float) -> FakeResponse:
        captured["url"] = request.full_url
        captured["data"] = request.data
        captured["anthropic_version"] = request.headers["Anthropic-version"]
        captured["x_api_key"] = request.headers["X-api-key"]
        return FakeResponse({"content": [{"type": "text", "text": "qwen response"}]})

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)

    provider = OpenCodeGoProvider(model="qwen3.7-plus", api_key="test-secret")
    response = provider.generate("Review this")

    payload = json.loads(captured["data"].decode("utf-8"))  # type: ignore[union-attr]
    assert response == "qwen response"
    assert captured["url"] == "https://opencode.ai/zen/go/v1/messages"
    assert captured["anthropic_version"] == "2023-06-01"
    assert captured["x_api_key"] == "test-secret"
    assert payload["model"] == "qwen3.7-plus"
    assert payload["max_tokens"] == 1024


def test_opencode_zen_claude_uses_messages_endpoint(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    captured: dict[str, object] = {}

    def fake_urlopen(request: urllib.request.Request, timeout: float) -> FakeResponse:
        captured["url"] = request.full_url
        captured["data"] = request.data
        return FakeResponse({"content": [{"type": "text", "text": "claude response"}]})

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)

    provider = OpenCodeZenProvider(model="claude-sonnet-5", api_key="test-secret")
    response = provider.generate("Summarize", max_tokens=32)

    payload = json.loads(captured["data"].decode("utf-8"))  # type: ignore[union-attr]
    assert response == "claude response"
    assert captured["url"] == "https://opencode.ai/zen/v1/messages"
    assert payload["model"] == "claude-sonnet-5"
    assert payload["max_tokens"] == 32


def test_opencode_prefixed_model_ids_are_accepted(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    captured: dict[str, object] = {}

    def fake_urlopen(request: urllib.request.Request, timeout: float) -> FakeResponse:
        captured["data"] = request.data
        return FakeResponse({"choices": [{"message": {"content": "prefixed response"}}]})

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)

    provider = OpenCodeGoProvider(model="opencode-go/kimi-k2.7-code", api_key="test-secret")
    response = provider.generate("Code")

    payload = json.loads(captured["data"].decode("utf-8"))  # type: ignore[union-attr]
    assert response == "prefixed response"
    assert payload["model"] == "kimi-k2.7-code"


def test_opencode_gemini_model_fails_clear_in_auto_mode() -> None:
    with pytest.raises(ProviderConfigurationError, match="Google-style endpoint"):
        OpenCodeZenProvider(model="gemini-3-flash", api_key="test-secret")


def test_opencode_provider_requires_api_key(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.delenv("OPENCODE_API_KEY", raising=False)

    with pytest.raises(ProviderConfigurationError, match="OPENCODE_API_KEY is required"):
        OpenCodeZenProvider()


def test_opencode_provider_sanitizes_http_errors(monkeypatch) -> None:  # type: ignore[no-untyped-def]
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

    provider = OpenCodeGoProvider(api_key=secret)
    with pytest.raises(ProviderExecutionError) as exc_info:
        provider.generate("Hello")

    message = str(exc_info.value)
    assert "[redacted-api-key]" in message
    assert secret not in message


def test_list_opencode_models(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    captured: dict[str, object] = {}

    def fake_urlopen(request: urllib.request.Request, timeout: float) -> FakeResponse:
        captured["url"] = request.full_url
        captured["auth"] = request.headers["Authorization"]
        return FakeResponse(
            {
                "data": [
                    {"id": "opencode-go/deepseek-v4-flash"},
                    {"id": "qwen3.7-plus"},
                ]
            }
        )

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)

    models = list_opencode_models(catalog="go", api_key="test-secret")

    assert models == ["deepseek-v4-flash", "qwen3.7-plus"]
    assert captured["url"] == "https://opencode.ai/zen/go/v1/models"
    assert captured["auth"] == "Bearer test-secret"


def test_infer_opencode_api_style() -> None:
    assert infer_opencode_api_style("gpt-5.4", "zen") == "openai_responses"
    assert infer_opencode_api_style("claude-sonnet-5", "zen") == "anthropic_messages"
    assert infer_opencode_api_style("deepseek-v4-flash", "zen") == "openai_chat"
    assert infer_opencode_api_style("qwen3.7-plus", "go") == "anthropic_messages"
    assert infer_opencode_api_style("qwen3.7-max", "go") == "anthropic_messages"
    assert infer_opencode_api_style("glm-5.2", "go") == "openai_chat"
    assert infer_opencode_api_style("deepseek-v4-pro", "go") == "openai_chat"
