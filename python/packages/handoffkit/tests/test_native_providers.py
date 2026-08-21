"""Tests for native OpenAI-compatible provider wrappers."""

from __future__ import annotations

import json
import urllib.request

from handoffkit.providers import (
    NATIVE_OPENAI_PROVIDER_CONFIGS,
    NativeOpenAIProvider,
    ProviderSelector,
    list_native_provider_models,
)


class FakeResponse:
    def __init__(self, payload: dict[str, object]) -> None:
        self.payload = payload

    def __enter__(self) -> FakeResponse:
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def read(self) -> bytes:
        return json.dumps(self.payload).encode("utf-8")


def test_native_provider_registry_contains_12_providers() -> None:
    assert {
        "nvidia",
        "openrouter",
        "groq",
        "grok",
        "together",
        "fireworks",
        "deepinfra",
        "perplexity",
        "mistral",
        "cerebras",
        "sambanova",
        "zai",
    } <= set(NATIVE_OPENAI_PROVIDER_CONFIGS)


def test_provider_selector_lists_native_providers() -> None:
    selector = ProviderSelector()
    names = {spec.name for spec in selector.list_providers()}

    assert {"nvidia", "openrouter", "groq", "grok", "sambanova"} <= names
    assert selector.known_models("nvidia") == ["z-ai/glm-5.2"]
    assert "openrouter/auto" in selector.known_models("openrouter")


def test_native_provider_uses_provider_specific_env(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setenv("NVIDIA_API_KEY", "test-nvidia-key")
    monkeypatch.delenv("NVIDIA_MODEL", raising=False)
    captured: dict[str, object] = {}

    def fake_urlopen(request: urllib.request.Request, timeout: float) -> FakeResponse:
        captured["url"] = request.full_url
        captured["auth"] = request.headers["Authorization"]
        captured["data"] = request.data
        captured["timeout"] = timeout
        return FakeResponse({"choices": [{"message": {"content": "nvidia ok"}}]})

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)

    provider = NativeOpenAIProvider("nvidia", timeout=7.0)
    response = provider.generate("Hello", max_tokens=8)
    payload = json.loads(captured["data"].decode("utf-8"))  # type: ignore[union-attr]

    assert response == "nvidia ok"
    assert captured["url"] == "https://integrate.api.nvidia.com/v1/chat/completions"
    assert captured["auth"] == "Bearer test-nvidia-key"
    assert captured["timeout"] == 7.0
    assert payload["model"] == "z-ai/glm-5.2"


def test_openrouter_optional_headers_from_env(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-openrouter-key")
    monkeypatch.setenv("OPENROUTER_HTTP_REFERER", "https://example.test")
    monkeypatch.setenv("OPENROUTER_X_TITLE", "HandoffKit Test")
    captured: dict[str, object] = {}

    def fake_urlopen(request: urllib.request.Request, timeout: float) -> FakeResponse:
        captured["referer"] = request.headers["Http-referer"]
        captured["title"] = request.headers["X-title"]
        return FakeResponse({"choices": [{"message": {"content": "router ok"}}]})

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)

    response = NativeOpenAIProvider("openrouter").generate("Hello")

    assert response == "router ok"
    assert captured["referer"] == "https://example.test"
    assert captured["title"] == "HandoffKit Test"


def test_list_native_provider_models_parses_openai_shape(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setenv("GROQ_API_KEY", "test-groq-key")
    captured: dict[str, object] = {}

    def fake_urlopen(request: urllib.request.Request, timeout: float) -> FakeResponse:
        captured["url"] = request.full_url
        captured["auth"] = request.headers["Authorization"]
        return FakeResponse(
            {
                "data": [
                    {"id": "llama-3.3-70b-versatile"},
                    {"id": "llama-3.1-8b-instant"},
                ]
            }
        )

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)

    models = list_native_provider_models("groq")

    assert captured["url"] == "https://api.groq.com/openai/v1/models"
    assert captured["auth"] == "Bearer test-groq-key"
    assert models == ["llama-3.1-8b-instant", "llama-3.3-70b-versatile"]
