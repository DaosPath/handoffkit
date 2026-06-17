import json
import urllib.request

from handoffkit.providers import choose_openai_compatible_model, list_openai_compatible_models


class FakeResponse:
    def __init__(self, body: bytes) -> None:
        self.body = body

    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def read(self) -> bytes:
        return self.body


def test_list_openai_compatible_models(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    def fake_urlopen(request: urllib.request.Request, timeout: float) -> FakeResponse:
        assert request.full_url == "https://example.test/v1/models"
        return FakeResponse(b'{"data": [{"id": "gpt-5.4"}, {"id": "gpt-4o-mini"}]}')

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)

    models = list_openai_compatible_models(
        api_key="test-secret",
        base_url="https://example.test/v1",
    )

    assert models == ["gpt-4o-mini", "gpt-5.4"]


def test_choose_openai_compatible_model_prefers_gpt_5_4(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    calls: list[dict[str, object]] = []

    def fake_urlopen(request: urllib.request.Request, timeout: float) -> FakeResponse:
        if request.full_url.endswith("/models"):
            return FakeResponse(b'{"data": [{"id": "gpt-5.4"}, {"id": "gpt-4o-mini"}]}')
        payload = json.loads(request.data.decode())  # type: ignore[union-attr]
        calls.append(payload)
        return FakeResponse(b'{"choices": [{"message": {"content": "OK"}}]}')

    monkeypatch.delenv("OPENAI_MODEL", raising=False)
    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)

    selection = choose_openai_compatible_model(
        api_key="test-secret",
        base_url="https://example.test/v1",
    )

    assert selection.model == "gpt-5.4"
    assert selection.models_endpoint_ok is True
    assert selection.available_models == ["gpt-4o-mini", "gpt-5.4"]
    assert calls[0]["model"] == "gpt-5.4"


def test_choose_openai_compatible_model_falls_back_when_gpt_5_4_missing(
    monkeypatch,
) -> None:  # type: ignore[no-untyped-def]
    calls: list[dict[str, object]] = []

    def fake_urlopen(request: urllib.request.Request, timeout: float) -> FakeResponse:
        if request.full_url.endswith("/models"):
            return FakeResponse(b'{"data": [{"id": "gpt-4o-mini"}]}')
        payload = json.loads(request.data.decode())  # type: ignore[union-attr]
        calls.append(payload)
        return FakeResponse(b'{"choices": [{"message": {"content": "OK"}}]}')

    monkeypatch.delenv("OPENAI_MODEL", raising=False)
    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)

    selection = choose_openai_compatible_model(
        api_key="test-secret",
        base_url="https://example.test/v1",
    )

    assert selection.model == "gpt-4o-mini"
    assert selection.errors["gpt-5.4"] == "Model not listed by /models endpoint."
    assert calls[0]["model"] == "gpt-4o-mini"
