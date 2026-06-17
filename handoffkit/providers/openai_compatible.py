"""Helpers for OpenAI-compatible providers."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any

from handoffkit.errors import ProviderConfigurationError, ProviderExecutionError
from handoffkit.providers.openai_provider import (
    DEFAULT_OPENAI_BASE_URL,
    DEFAULT_OPENAI_MODEL,
    OpenAIProvider,
)

DEFAULT_MODEL_CANDIDATES = ("gpt-5.4", DEFAULT_OPENAI_MODEL)


@dataclass
class ModelSelectionResult:
    """Result returned by OpenAI-compatible model selection."""

    model: str
    base_url: str
    models_endpoint_ok: bool
    available_models: list[str] = field(default_factory=list)
    attempted_models: list[str] = field(default_factory=list)
    errors: dict[str, str] = field(default_factory=dict)


def list_openai_compatible_models(
    *,
    api_key: str | None = None,
    base_url: str | None = None,
    timeout: float = 20.0,
) -> list[str]:
    """Return model ids from an OpenAI-compatible `/models` endpoint."""
    resolved_api_key = api_key or os.getenv("OPENAI_API_KEY")
    if not resolved_api_key:
        raise ProviderConfigurationError("OPENAI_API_KEY is required to list models.")
    configured_base_url = base_url or os.getenv("OPENAI_BASE_URL") or DEFAULT_OPENAI_BASE_URL
    resolved_base_url = configured_base_url.rstrip("/")
    request = urllib.request.Request(
        f"{resolved_base_url}/models",
        headers={"Authorization": f"Bearer {resolved_api_key}"},
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
            f"OpenAI-compatible models request failed with HTTP {exc.code}: {detail}"
        ) from exc
    except urllib.error.URLError as exc:
        raise ProviderExecutionError(
            f"OpenAI-compatible models request failed for {resolved_base_url}: {exc.reason}"
        ) from exc

    raw_items: Any = body.get("data", body if isinstance(body, list) else [])
    models: list[str] = []
    for item in raw_items:
        if isinstance(item, dict) and isinstance(item.get("id"), str):
            models.append(item["id"])
        elif isinstance(item, str):
            models.append(item)
    return sorted(set(models))


def choose_openai_compatible_model(
    *,
    api_key: str | None = None,
    base_url: str | None = None,
    model: str | None = None,
    fallback_models: tuple[str, ...] = DEFAULT_MODEL_CANDIDATES,
    timeout: float = 30.0,
) -> ModelSelectionResult:
    """Choose the first working model for an OpenAI-compatible endpoint."""
    resolved_api_key = api_key or os.getenv("OPENAI_API_KEY")
    if not resolved_api_key:
        raise ProviderConfigurationError("OPENAI_API_KEY is required to choose a model.")
    configured_base_url = base_url or os.getenv("OPENAI_BASE_URL") or DEFAULT_OPENAI_BASE_URL
    resolved_base_url = configured_base_url.rstrip("/")
    env_model = model or os.getenv("OPENAI_MODEL")
    candidates = [env_model] if env_model else list(fallback_models)
    result = ModelSelectionResult(
        model="",
        base_url=resolved_base_url,
        models_endpoint_ok=False,
        attempted_models=[],
    )

    try:
        result.available_models = list_openai_compatible_models(
            api_key=resolved_api_key,
            base_url=resolved_base_url,
            timeout=timeout,
        )
        result.models_endpoint_ok = True
    except ProviderExecutionError as exc:
        result.errors["/models"] = str(exc)

    for candidate in candidates:
        if not candidate:
            continue
        if result.available_models and candidate not in result.available_models:
            result.errors[candidate] = "Model not listed by /models endpoint."
            continue
        result.attempted_models.append(candidate)
        provider = OpenAIProvider(
            api_key=resolved_api_key,
            base_url=resolved_base_url,
            model=candidate,
            timeout=timeout,
        )
        try:
            response = provider.generate(
                "Reply with exactly: OK",
                max_tokens=8,
                temperature=0,
            )
        except ProviderExecutionError as exc:
            result.errors[candidate] = str(exc)
            continue
        if response.strip():
            result.model = candidate
            return result
        result.errors[candidate] = "Model returned an empty response."

    attempted = ", ".join(candidates)
    raise ProviderExecutionError(
        f"No OpenAI-compatible model succeeded for {resolved_base_url}. "
        f"Candidates: {attempted}. Errors: {result.errors}"
    )
