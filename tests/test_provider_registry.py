import json

import pytest

from handoffkit.errors import ProviderConfigurationError, ProviderExecutionError
from handoffkit.providers import (
    BaseProvider,
    ModelCandidate,
    ProviderProbeResult,
    ProviderRouter,
    ProviderSelector,
    ProviderSpec,
)


class StaticProvider(BaseProvider):
    def __init__(self, output: str = "OK") -> None:
        self.model = "static"
        self.output = output

    def generate(self, prompt: str, **kwargs) -> str:  # type: ignore[no-untyped-def]
        return self.output


class FailingProvider(BaseProvider):
    model = "failing"

    def generate(self, prompt: str, **kwargs) -> str:  # type: ignore[no-untyped-def]
        raise ProviderExecutionError("bad token secret-123")


def test_provider_selector_lists_known_providers_offline() -> None:
    selector = ProviderSelector()
    names = {spec.name for spec in selector.list_providers()}

    assert {"opencode-go", "opencode-zen", "openai-compatible", "ollama"} <= names
    assert "mimo-v2.5" in selector.known_models("opencode-go")


def test_provider_selector_offline_select_does_not_call_network() -> None:
    selector = ProviderSelector()

    result = selector.select("opencode-go", ["mimo-v2.5"], real=False)

    assert result.success is True
    assert result.provider == "opencode-go"
    assert result.model == "mimo-v2.5"
    assert result.metadata["mode"] == "offline"


def test_provider_selector_real_probe_returns_safe_failure() -> None:
    selector = ProviderSelector(
        [
            ProviderSpec(
                name="bad",
                description="Bad test provider.",
                env_vars=("BAD_KEY",),
                model_env_vars=("BAD_MODEL",),
                default_model="bad-model",
                suggested_models=("bad-model",),
                supports_models_endpoint=False,
                factory=lambda model: FailingProvider(),
            )
        ]
    )

    result = selector.probe(ModelCandidate("bad", "bad-model"), real=True)

    assert result.success is False
    assert "bad token" in result.error
    assert "secret-123" not in result.error
    assert "[redacted-secret]" in result.error
    assert isinstance(ProviderProbeResult(**result.to_dict()), ProviderProbeResult)
    assert json.loads(result.to_json())["model"] == "bad-model"


def test_provider_selector_real_select_raises_when_all_fail() -> None:
    selector = ProviderSelector(
        [
            ProviderSpec(
                name="bad",
                description="Bad test provider.",
                env_vars=(),
                model_env_vars=(),
                default_model="bad-model",
                suggested_models=("bad-model",),
                supports_models_endpoint=False,
                factory=lambda model: FailingProvider(),
            )
        ]
    )

    with pytest.raises(ProviderExecutionError, match="No working model"):
        selector.select("bad", real=True)


def test_provider_router_falls_back_to_second_candidate() -> None:
    selector = ProviderSelector(
        [
            ProviderSpec(
                name="bad",
                description="Bad test provider.",
                env_vars=(),
                model_env_vars=(),
                default_model="bad-model",
                suggested_models=("bad-model",),
                supports_models_endpoint=False,
                factory=lambda model: FailingProvider(),
            ),
            ProviderSpec(
                name="good",
                description="Good test provider.",
                env_vars=(),
                model_env_vars=(),
                default_model="good-model",
                suggested_models=("good-model",),
                supports_models_endpoint=False,
                factory=lambda model: StaticProvider("winner"),
            ),
        ]
    )
    router = ProviderRouter(
        [
            ModelCandidate("bad", "bad-model"),
            ModelCandidate("good", "good-model"),
        ],
        selector=selector,
    )

    assert router.generate("hello") == "winner"


def test_provider_selector_unknown_provider_error_is_clear() -> None:
    with pytest.raises(ProviderConfigurationError, match="Unknown provider"):
        ProviderSelector().get_provider("missing")
