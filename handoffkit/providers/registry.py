"""Experimental provider registry, probing, and routing helpers."""

from __future__ import annotations

import json
import re
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Any

from handoffkit.errors import ProviderConfigurationError, ProviderExecutionError
from handoffkit.providers.base import BaseProvider
from handoffkit.providers.native_openai import (
    NATIVE_OPENAI_PROVIDER_CONFIGS,
    NativeOpenAIProvider,
    list_native_provider_models,
)
from handoffkit.providers.ollama_provider import OllamaProvider
from handoffkit.providers.openai_compatible import list_openai_compatible_models
from handoffkit.providers.openai_provider import OpenAIProvider
from handoffkit.providers.opencode_provider import (
    DEFAULT_OPENCODE_GO_MODEL,
    DEFAULT_OPENCODE_ZEN_MODEL,
    OPENCODE_GO_MODELS,
    OPENCODE_ZEN_MODELS,
    OpenCodeGoProvider,
    OpenCodeZenProvider,
    list_opencode_models,
)

ProviderFactory = Callable[[str | None], BaseProvider]
ModelLister = Callable[[], list[str]]


@dataclass(frozen=True)
class ProviderSpec:
    """Experimental provider registry entry."""

    name: str
    description: str
    env_vars: tuple[str, ...]
    model_env_vars: tuple[str, ...]
    default_model: str
    suggested_models: tuple[str, ...]
    supports_models_endpoint: bool
    factory: ProviderFactory
    list_models: ModelLister | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Serialize this provider spec without callable fields."""
        return {
            "name": self.name,
            "description": self.description,
            "env_vars": list(self.env_vars),
            "model_env_vars": list(self.model_env_vars),
            "default_model": self.default_model,
            "suggested_models": list(self.suggested_models),
            "supports_models_endpoint": self.supports_models_endpoint,
            "metadata": dict(self.metadata),
        }


@dataclass(frozen=True)
class ModelCandidate:
    """Provider + model candidate for probing or routing."""

    provider: str
    model: str
    priority: int = 100
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Serialize this model candidate."""
        return {
            "provider": self.provider,
            "model": self.model,
            "priority": self.priority,
            "metadata": dict(self.metadata),
        }


@dataclass(frozen=True)
class ProviderProbeResult:
    """Safe result for a provider/model probe."""

    provider: str
    model: str
    success: bool
    output: str = ""
    error: str = ""
    latency_seconds: float = 0.0
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Serialize this probe result."""
        return {
            "provider": self.provider,
            "model": self.model,
            "success": self.success,
            "output": self.output,
            "error": self.error,
            "latency_seconds": self.latency_seconds,
            "metadata": dict(self.metadata),
        }

    def to_json(self) -> str:
        """Serialize this probe result as JSON."""
        return json.dumps(self.to_dict(), indent=2, sort_keys=True)


class ProviderSelector:
    """Experimental selector for known HandoffKit providers."""

    def __init__(self, specs: Sequence[ProviderSpec] | None = None) -> None:
        self._specs = {spec.name: spec for spec in (specs or default_provider_specs())}

    def list_providers(self) -> list[ProviderSpec]:
        """Return provider specs sorted by name."""
        return [self._specs[name] for name in sorted(self._specs)]

    def get_provider(self, name: str) -> ProviderSpec:
        """Return one provider spec."""
        try:
            return self._specs[name]
        except KeyError as exc:
            known = ", ".join(sorted(self._specs))
            raise ProviderConfigurationError(f"Unknown provider '{name}'. Known: {known}") from exc

    def known_models(self, provider: str) -> list[str]:
        """Return bundled suggested models for a provider without network access."""
        return list(self.get_provider(provider).suggested_models)

    def list_models(self, provider: str, *, real: bool = False) -> list[str]:
        """List known models offline, or query a provider endpoint when real=True."""
        spec = self.get_provider(provider)
        if real:
            if spec.list_models is None:
                raise ProviderConfigurationError(
                    f"Provider '{provider}' does not expose a models endpoint."
                )
            return sorted(set(spec.list_models()))
        return list(spec.suggested_models)

    def candidates(
        self,
        provider: str,
        models: Sequence[str] | None = None,
    ) -> list[ModelCandidate]:
        """Build prioritized model candidates."""
        spec = self.get_provider(provider)
        selected = list(models) if models else list(spec.suggested_models)
        return [
            ModelCandidate(provider=provider, model=model, priority=index)
            for index, model in enumerate(selected)
        ]

    def probe(
        self,
        candidate: ModelCandidate,
        *,
        real: bool = False,
        prompt: str = "Reply with exactly: OK",
        timeout: float | None = None,
    ) -> ProviderProbeResult:
        """Probe one provider/model candidate.

        With real=False this performs no network call and returns an offline dry-run result.
        """
        start = time.perf_counter()
        if not real:
            return ProviderProbeResult(
                provider=candidate.provider,
                model=candidate.model,
                success=True,
                output="[offline dry-run]",
                latency_seconds=0.0,
                metadata={"mode": "offline", **candidate.metadata},
            )
        spec = self.get_provider(candidate.provider)
        try:
            provider = spec.factory(candidate.model)
            kwargs: dict[str, Any] = {}
            if timeout is not None and hasattr(provider, "timeout"):
                provider.timeout = timeout
            response = provider.generate(prompt, temperature=0, max_tokens=8)
            latency = round(time.perf_counter() - start, 3)
            return ProviderProbeResult(
                provider=candidate.provider,
                model=candidate.model,
                success=bool(str(response).strip()),
                output=str(response).strip(),
                latency_seconds=latency,
                metadata={"mode": "real", **kwargs, **candidate.metadata},
            )
        except (ProviderConfigurationError, ProviderExecutionError, OSError) as exc:
            latency = round(time.perf_counter() - start, 3)
            return ProviderProbeResult(
                provider=candidate.provider,
                model=candidate.model,
                success=False,
                error=_redact_secret_like_text(str(exc)),
                latency_seconds=latency,
                metadata={"mode": "real", **candidate.metadata},
            )

    def select(
        self,
        provider: str,
        models: Sequence[str] | None = None,
        *,
        real: bool = False,
        prompt: str = "Reply with exactly: OK",
        timeout: float | None = None,
    ) -> ProviderProbeResult:
        """Return first successful probe result."""
        failures: list[ProviderProbeResult] = []
        for candidate in self.candidates(provider, models):
            result = self.probe(candidate, real=real, prompt=prompt, timeout=timeout)
            if result.success:
                return result
            failures.append(result)
        details = "; ".join(f"{item.model}: {item.error}" for item in failures)
        raise ProviderExecutionError(
            "No working model found for provider "
            f"'{provider}'. Failures: {_redact_secret_like_text(details)}"
        )


class ProviderRouter(BaseProvider):
    """BaseProvider that tries model candidates in order until one succeeds."""

    def __init__(
        self,
        candidates: Sequence[ModelCandidate],
        *,
        selector: ProviderSelector | None = None,
    ) -> None:
        self.selector = selector or ProviderSelector()
        self.candidates = list(candidates)
        self.model = self.candidates[0].model if self.candidates else "router"
        if not self.candidates:
            raise ProviderConfigurationError("ProviderRouter requires at least one candidate.")

    def generate(self, prompt: str, **kwargs: Any) -> str:
        """Generate using the first candidate that succeeds."""
        failures: list[str] = []
        for candidate in self.candidates:
            spec = self.selector.get_provider(candidate.provider)
            try:
                provider = spec.factory(candidate.model)
                return provider.generate(prompt, **kwargs)
            except (ProviderConfigurationError, ProviderExecutionError, OSError) as exc:
                failures.append(
                    f"{candidate.provider}/{candidate.model}: {_redact_secret_like_text(str(exc))}"
                )
        raise ProviderExecutionError(
            "All provider router candidates failed: " + "; ".join(failures)
        )


def default_provider_specs() -> list[ProviderSpec]:
    """Return built-in experimental provider specs."""
    native_specs = [
        ProviderSpec(
            name=config.name,
            description=f"{config.display_name} OpenAI-compatible provider.",
            env_vars=(config.api_key_env, config.base_url_env),
            model_env_vars=(config.model_env,),
            default_model=config.default_model,
            suggested_models=config.suggested_models,
            supports_models_endpoint=config.supports_models_endpoint,
            factory=lambda model, provider=name: NativeOpenAIProvider(provider, model=model),
            list_models=lambda provider=name: list_native_provider_models(provider),
            metadata={"native": True, "experimental": True, **config.metadata},
        )
        for name, config in NATIVE_OPENAI_PROVIDER_CONFIGS.items()
    ]
    return [
        ProviderSpec(
            name="opencode-go",
            description="OpenCode Go provider for open coding and reasoning models.",
            env_vars=("OPENCODE_API_KEY", "OPENCODE_GO_BASE_URL", "OPENCODE_BASE_URL"),
            model_env_vars=("OPENCODE_GO_MODEL", "OPENCODE_MODEL"),
            default_model=DEFAULT_OPENCODE_GO_MODEL,
            suggested_models=OPENCODE_GO_MODELS,
            supports_models_endpoint=True,
            factory=lambda model: OpenCodeGoProvider(model=model),
            list_models=lambda: list_opencode_models(catalog="go"),
            metadata={"catalog": "go", "experimental": True},
        ),
        ProviderSpec(
            name="opencode-zen",
            description="OpenCode Zen provider for GPT, Claude, Qwen, DeepSeek and more.",
            env_vars=("OPENCODE_API_KEY", "OPENCODE_ZEN_BASE_URL", "OPENCODE_BASE_URL"),
            model_env_vars=("OPENCODE_ZEN_MODEL", "OPENCODE_MODEL"),
            default_model=DEFAULT_OPENCODE_ZEN_MODEL,
            suggested_models=OPENCODE_ZEN_MODELS,
            supports_models_endpoint=True,
            factory=lambda model: OpenCodeZenProvider(model=model),
            list_models=lambda: list_opencode_models(catalog="zen"),
            metadata={"catalog": "zen", "experimental": True},
        ),
        ProviderSpec(
            name="openai-compatible",
            description="OpenAI-compatible chat completions provider.",
            env_vars=("OPENAI_API_KEY", "OPENAI_BASE_URL"),
            model_env_vars=("OPENAI_MODEL",),
            default_model="gpt-4o-mini",
            suggested_models=("gpt-5.4", "gpt-4o-mini"),
            supports_models_endpoint=True,
            factory=lambda model: OpenAIProvider(model=model),
            list_models=list_openai_compatible_models,
            metadata={"compatibility": "openai", "experimental": True},
        ),
        ProviderSpec(
            name="ollama",
            description="Local Ollama provider.",
            env_vars=("OLLAMA_BASE_URL",),
            model_env_vars=("OLLAMA_MODEL",),
            default_model="llama3.1",
            suggested_models=("llama3.1", "qwen2.5", "mistral"),
            supports_models_endpoint=False,
            factory=lambda model: OllamaProvider(model=model or "llama3.1"),
            metadata={"local": True, "experimental": True},
        ),
        *native_specs,
    ]


def _redact_secret_like_text(text: str) -> str:
    """Redact common token shapes from diagnostics."""
    redacted = re.sub(r"sk-[A-Za-z0-9_-]{8,}", "[redacted-api-key]", text)
    redacted = re.sub(r"pypi-[A-Za-z0-9_-]{8,}", "[redacted-api-key]", redacted)
    redacted = re.sub(r"secret-[A-Za-z0-9_-]{3,}", "[redacted-secret]", redacted)
    redacted = re.sub(r"user_[A-Za-z0-9_-]{8,}", "[redacted-user-id]", redacted)
    return redacted
