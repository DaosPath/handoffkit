"""Native provider wrappers for OpenAI-compatible APIs."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any

from handoffkit.errors import ProviderConfigurationError, ProviderExecutionError
from handoffkit.providers.openai_provider import OpenAIProvider


@dataclass(frozen=True)
class NativeProviderConfig:
    """Configuration for a native OpenAI-compatible provider."""

    name: str
    display_name: str
    api_key_env: str
    base_url_env: str
    model_env: str
    default_base_url: str
    default_model: str
    suggested_models: tuple[str, ...]
    supports_models_endpoint: bool = True
    headers_env: dict[str, str] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)


NATIVE_OPENAI_PROVIDER_CONFIGS: dict[str, NativeProviderConfig] = {
    "nvidia": NativeProviderConfig(
        name="nvidia",
        display_name="NVIDIA NIM",
        api_key_env="NVIDIA_API_KEY",
        base_url_env="NVIDIA_BASE_URL",
        model_env="NVIDIA_MODEL",
        default_base_url="https://integrate.api.nvidia.com/v1",
        default_model="z-ai/glm-5.2",
        suggested_models=("z-ai/glm-5.2",),
        metadata={"compatibility": "openai", "vendor": "nvidia"},
    ),
    "openrouter": NativeProviderConfig(
        name="openrouter",
        display_name="OpenRouter",
        api_key_env="OPENROUTER_API_KEY",
        base_url_env="OPENROUTER_BASE_URL",
        model_env="OPENROUTER_MODEL",
        default_base_url="https://openrouter.ai/api/v1",
        default_model="openrouter/auto",
        suggested_models=("openrouter/auto", "openrouter/free", "~openai/gpt-latest"),
        headers_env={
            "HTTP-Referer": "OPENROUTER_HTTP_REFERER",
            "X-Title": "OPENROUTER_X_TITLE",
        },
        metadata={"compatibility": "openai", "gateway": True},
    ),
    "groq": NativeProviderConfig(
        name="groq",
        display_name="Groq",
        api_key_env="GROQ_API_KEY",
        base_url_env="GROQ_BASE_URL",
        model_env="GROQ_MODEL",
        default_base_url="https://api.groq.com/openai/v1",
        default_model="llama-3.3-70b-versatile",
        suggested_models=("llama-3.3-70b-versatile", "llama-3.1-8b-instant"),
        metadata={"compatibility": "openai"},
    ),
    "grok": NativeProviderConfig(
        name="grok",
        display_name="xAI Grok",
        api_key_env="XAI_API_KEY",
        base_url_env="XAI_BASE_URL",
        model_env="XAI_MODEL",
        default_base_url="https://api.x.ai/v1",
        default_model="grok-4.3",
        suggested_models=("grok-4.3", "grok-build-0.1"),
        metadata={"compatibility": "openai", "vendor": "xai"},
    ),
    "together": NativeProviderConfig(
        name="together",
        display_name="Together AI",
        api_key_env="TOGETHER_API_KEY",
        base_url_env="TOGETHER_BASE_URL",
        model_env="TOGETHER_MODEL",
        default_base_url="https://api.together.xyz/v1",
        default_model="meta-llama/Llama-3.3-70B-Instruct-Turbo",
        suggested_models=(
            "meta-llama/Llama-3.3-70B-Instruct-Turbo",
            "deepseek-ai/DeepSeek-V3",
            "Qwen/Qwen2.5-72B-Instruct-Turbo",
        ),
        metadata={"compatibility": "openai"},
    ),
    "fireworks": NativeProviderConfig(
        name="fireworks",
        display_name="Fireworks AI",
        api_key_env="FIREWORKS_API_KEY",
        base_url_env="FIREWORKS_BASE_URL",
        model_env="FIREWORKS_MODEL",
        default_base_url="https://api.fireworks.ai/inference/v1",
        default_model="accounts/fireworks/models/deepseek-v3p1",
        suggested_models=(
            "accounts/fireworks/models/deepseek-v3p1",
            "accounts/fireworks/routers/glm-5p2-fast",
        ),
        metadata={"compatibility": "openai"},
    ),
    "deepinfra": NativeProviderConfig(
        name="deepinfra",
        display_name="DeepInfra",
        api_key_env="DEEPINFRA_API_KEY",
        base_url_env="DEEPINFRA_BASE_URL",
        model_env="DEEPINFRA_MODEL",
        default_base_url="https://api.deepinfra.com/v1/openai",
        default_model="meta-llama/Llama-3.3-70B-Instruct-Turbo",
        suggested_models=(
            "meta-llama/Llama-3.3-70B-Instruct-Turbo",
            "Qwen/Qwen2.5-72B-Instruct",
        ),
        metadata={"compatibility": "openai"},
    ),
    "perplexity": NativeProviderConfig(
        name="perplexity",
        display_name="Perplexity Sonar",
        api_key_env="PERPLEXITY_API_KEY",
        base_url_env="PERPLEXITY_BASE_URL",
        model_env="PERPLEXITY_MODEL",
        default_base_url="https://api.perplexity.ai",
        default_model="sonar-pro",
        suggested_models=("sonar-pro", "sonar"),
        metadata={"compatibility": "openai", "search_grounded": True},
    ),
    "mistral": NativeProviderConfig(
        name="mistral",
        display_name="Mistral AI",
        api_key_env="MISTRAL_API_KEY",
        base_url_env="MISTRAL_BASE_URL",
        model_env="MISTRAL_MODEL",
        default_base_url="https://api.mistral.ai/v1",
        default_model="mistral-small-latest",
        suggested_models=("mistral-small-latest", "mistral-medium-latest"),
        metadata={"compatibility": "openai"},
    ),
    "cerebras": NativeProviderConfig(
        name="cerebras",
        display_name="Cerebras Inference",
        api_key_env="CEREBRAS_API_KEY",
        base_url_env="CEREBRAS_BASE_URL",
        model_env="CEREBRAS_MODEL",
        default_base_url="https://api.cerebras.ai/v1",
        default_model="llama3.1-8b",
        suggested_models=("llama3.1-8b", "llama-3.3-70b"),
        metadata={"compatibility": "openai"},
    ),
    "sambanova": NativeProviderConfig(
        name="sambanova",
        display_name="SambaNova Cloud",
        api_key_env="SAMBANOVA_API_KEY",
        base_url_env="SAMBANOVA_BASE_URL",
        model_env="SAMBANOVA_MODEL",
        default_base_url="https://api.sambanova.ai/v1",
        default_model="Meta-Llama-3.3-70B-Instruct",
        suggested_models=("Meta-Llama-3.3-70B-Instruct", "DeepSeek-V3.1", "DeepSeek-V3.2"),
        metadata={"compatibility": "openai"},
    ),
    "zai": NativeProviderConfig(
        name="zai",
        display_name="Z.ai / GLM",
        api_key_env="ZAI_API_KEY",
        base_url_env="ZAI_BASE_URL",
        model_env="ZAI_MODEL",
        default_base_url="https://api.z.ai/api/paas/v4",
        default_model="glm-5.2",
        suggested_models=("glm-5.2", "glm-4.7"),
        metadata={"compatibility": "openai", "vendor": "zai"},
    ),
}


class NativeOpenAIProvider(OpenAIProvider):
    """OpenAI-compatible provider with provider-specific env vars."""

    def __init__(
        self,
        provider: str,
        model: str | None = None,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
        timeout: float = 60.0,
    ) -> None:
        config = get_native_provider_config(provider)
        resolved_api_key = api_key or os.getenv(config.api_key_env)
        resolved_base_url = base_url or os.getenv(config.base_url_env) or config.default_base_url
        resolved_model = model or os.getenv(config.model_env) or config.default_model
        if not resolved_api_key:
            raise ProviderConfigurationError(
                f"{config.api_key_env} is required for {config.display_name}. "
                "Set the environment variable or pass api_key explicitly."
            )
        self.provider_name = config.name
        self.config = config
        super().__init__(
            model=resolved_model,
            api_key=resolved_api_key,
            base_url=resolved_base_url,
            headers=_headers_from_env(config),
            timeout=timeout,
        )


def get_native_provider_config(name: str) -> NativeProviderConfig:
    """Return one native provider config."""
    try:
        return NATIVE_OPENAI_PROVIDER_CONFIGS[name]
    except KeyError as exc:
        known = ", ".join(sorted(NATIVE_OPENAI_PROVIDER_CONFIGS))
        message = f"Unknown native provider '{name}'. Known: {known}"
        raise ProviderConfigurationError(message) from exc


def list_native_provider_models(
    provider: str,
    *,
    api_key: str | None = None,
    base_url: str | None = None,
    timeout: float = 20.0,
) -> list[str]:
    """Return model ids from a native provider `/models` endpoint."""
    config = get_native_provider_config(provider)
    if not config.supports_models_endpoint:
        raise ProviderConfigurationError(f"Provider '{provider}' does not expose /models.")
    resolved_api_key = api_key or os.getenv(config.api_key_env)
    if not resolved_api_key:
        raise ProviderConfigurationError(f"{config.api_key_env} is required to list models.")
    configured_base_url = base_url or os.getenv(config.base_url_env) or config.default_base_url
    resolved_base_url = configured_base_url.rstrip("/")
    request = urllib.request.Request(
        f"{resolved_base_url}/models",
        headers={
            "Authorization": f"Bearer {resolved_api_key}",
            **_headers_from_env(config),
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace").replace(
            resolved_api_key, "[redacted-api-key]"
        )
        raise ProviderExecutionError(
            f"{config.display_name} models request failed with HTTP {exc.code}: {detail}"
        ) from exc
    except urllib.error.URLError as exc:
        raise ProviderExecutionError(
            f"{config.display_name} models request failed for {resolved_base_url}: {exc.reason}"
        ) from exc

    return _parse_model_ids(body)


def _headers_from_env(config: NativeProviderConfig) -> dict[str, str]:
    headers: dict[str, str] = {}
    for header, env_var in config.headers_env.items():
        value = os.getenv(env_var)
        if value:
            headers[header] = value
    return headers


def _parse_model_ids(body: Any) -> list[str]:
    raw_items = body.get("data", body if isinstance(body, list) else [])
    models: list[str] = []
    for item in raw_items:
        if isinstance(item, dict) and isinstance(item.get("id"), str):
            models.append(item["id"])
        elif isinstance(item, dict) and isinstance(item.get("name"), str):
            models.append(item["name"])
        elif isinstance(item, str):
            models.append(item)
    return sorted(set(models))
