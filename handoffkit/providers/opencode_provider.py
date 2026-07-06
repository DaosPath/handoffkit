"""OpenCode Zen and Go HTTP providers."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any, Literal

from handoffkit.errors import ProviderConfigurationError, ProviderExecutionError
from handoffkit.providers.base import BaseProvider

OpenCodeCatalog = Literal["zen", "go"]
OpenCodeAPIStyle = Literal["auto", "openai_chat", "openai_responses", "anthropic_messages"]

DEFAULT_OPENCODE_ZEN_BASE_URL = "https://opencode.ai/zen/v1"
DEFAULT_OPENCODE_GO_BASE_URL = "https://opencode.ai/zen/go/v1"
DEFAULT_OPENCODE_ZEN_MODEL = "gpt-5.4"
DEFAULT_OPENCODE_GO_MODEL = "deepseek-v4-flash"

_GO_ANTHROPIC_MODELS = {
    "minimax-m3",
    "minimax-m2.7",
    "minimax-m2.5",
    "qwen3.7-max",
    "qwen3.7-plus",
    "qwen3.6-plus",
}

_ZEN_ANTHROPIC_MODELS = {
    "qwen3.7-max",
    "qwen3.7-plus",
    "qwen3.6-plus",
    "qwen3.5-plus",
}

_VALID_API_STYLES = {"auto", "openai_chat", "openai_responses", "anthropic_messages"}


def infer_opencode_api_style(
    model: str,
    catalog: OpenCodeCatalog = "zen",
    api_style: OpenCodeAPIStyle = "auto",
) -> OpenCodeAPIStyle:
    """Infer the OpenCode endpoint style for a model id."""
    resolved_catalog = _normalize_catalog(catalog)
    normalized_model = _strip_opencode_prefix(model, resolved_catalog)
    if api_style not in _VALID_API_STYLES:
        raise ProviderConfigurationError(
            "api_style must be one of: auto, openai_chat, openai_responses, "
            "anthropic_messages."
        )
    if api_style != "auto":
        return api_style
    if normalized_model.startswith("gemini-"):
        raise ProviderConfigurationError(
            "OpenCode Gemini models use a Google-style endpoint that "
            "OpenCodeProvider does not support yet. Choose a GPT, Claude, Qwen, "
            "DeepSeek, MiniMax, GLM, Kimi, MiMo, Grok, or free OpenCode model."
        )
    if resolved_catalog == "go":
        if normalized_model in _GO_ANTHROPIC_MODELS:
            return "anthropic_messages"
        return "openai_chat"
    if normalized_model.startswith("gpt-"):
        return "openai_responses"
    if normalized_model.startswith("claude-") or normalized_model in _ZEN_ANTHROPIC_MODELS:
        return "anthropic_messages"
    return "openai_chat"


def list_opencode_models(
    *,
    catalog: OpenCodeCatalog = "zen",
    api_key: str | None = None,
    base_url: str | None = None,
    timeout: float = 20.0,
) -> list[str]:
    """Return model ids from an OpenCode Zen or Go `/models` endpoint."""
    resolved_catalog = _normalize_catalog(catalog)
    resolved_key = api_key or os.getenv("OPENCODE_API_KEY")
    if not resolved_key:
        raise ProviderConfigurationError(
            "OPENCODE_API_KEY is required to list OpenCode models. "
            "Set the environment variable or pass api_key explicitly."
        )
    resolved_base_url = _resolve_base_url(resolved_catalog, base_url)
    request = urllib.request.Request(
        f"{resolved_base_url}/models",
        headers={
            "Authorization": f"Bearer {resolved_key}",
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "handoffkit/1.2 OpenCodeProvider",
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise ProviderExecutionError(
            f"OpenCode {resolved_catalog} models request failed with HTTP {exc.code}: "
            f"{_sanitize_error_detail(detail, resolved_key)}"
        ) from exc
    except urllib.error.URLError as exc:
        raise ProviderExecutionError(
            f"OpenCode {resolved_catalog} models request failed for "
            f"{resolved_base_url}: {exc.reason}"
        ) from exc
    data = body.get("data", body if isinstance(body, list) else [])
    models: list[str] = []
    if isinstance(data, list):
        for item in data:
            if isinstance(item, str):
                models.append(_strip_opencode_prefix(item, resolved_catalog))
            elif isinstance(item, dict) and isinstance(item.get("id"), str):
                models.append(_strip_opencode_prefix(item["id"], resolved_catalog))
    return models


class OpenCodeProvider(BaseProvider):
    """Provider for OpenCode Zen or OpenCode Go APIs."""

    def __init__(
        self,
        model: str | None = None,
        *,
        catalog: OpenCodeCatalog = "zen",
        api_key: str | None = None,
        base_url: str | None = None,
        api_style: OpenCodeAPIStyle = "auto",
        timeout: float = 60.0,
    ) -> None:
        self.catalog = _normalize_catalog(catalog)
        self.model = _strip_opencode_prefix(
            model or _resolve_model(self.catalog),
            self.catalog,
        )
        self.api_key = api_key or os.getenv("OPENCODE_API_KEY")
        self.base_url = _resolve_base_url(self.catalog, base_url)
        self.api_style = infer_opencode_api_style(self.model, self.catalog, api_style)
        self.timeout = timeout
        if not self.api_key:
            raise ProviderConfigurationError(
                "OPENCODE_API_KEY is required for OpenCodeProvider. "
                "Set the environment variable or pass api_key explicitly."
            )

    def generate(self, prompt: str, **kwargs: Any) -> str:
        """Generate text using the OpenCode endpoint family for the selected model."""
        model = _strip_opencode_prefix(str(kwargs.pop("model", self.model)), self.catalog)
        api_style = infer_opencode_api_style(model, self.catalog, self.api_style)
        if api_style == "openai_responses":
            return self._generate_responses(prompt, model, kwargs)
        if api_style == "anthropic_messages":
            return self._generate_messages(prompt, model, kwargs)
        return self._generate_chat_completions(prompt, model, kwargs)

    def _generate_chat_completions(self, prompt: str, model: str, kwargs: dict[str, Any]) -> str:
        payload = {
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            **kwargs,
        }
        body = self._post_json("/chat/completions", payload)
        choices = body.get("choices") or []
        if not choices:
            return ""
        message = choices[0].get("message") or {}
        content = message.get("content", "")
        if isinstance(content, list):
            return _extract_text_parts(content)
        return str(content)

    def _generate_responses(self, prompt: str, model: str, kwargs: dict[str, Any]) -> str:
        payload = {
            "model": model,
            "input": prompt,
            **kwargs,
        }
        body = self._post_json("/responses", payload)
        output_text = body.get("output_text")
        if isinstance(output_text, str):
            return output_text
        output = body.get("output") or []
        if not isinstance(output, list):
            return ""
        parts: list[str] = []
        for item in output:
            if not isinstance(item, dict):
                continue
            content = item.get("content") or []
            if isinstance(content, list):
                parts.append(_extract_text_parts(content))
        return "\n".join(part for part in parts if part)

    def _generate_messages(self, prompt: str, model: str, kwargs: dict[str, Any]) -> str:
        max_tokens = kwargs.pop("max_tokens", 1024)
        payload = {
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": max_tokens,
            **kwargs,
        }
        body = self._post_json(
            "/messages",
            payload,
            extra_headers={"anthropic-version": "2023-06-01", "x-api-key": self.api_key or ""},
        )
        content = body.get("content", "")
        if isinstance(content, list):
            return _extract_text_parts(content)
        return str(content)

    def _post_json(
        self,
        path: str,
        payload: dict[str, Any],
        *,
        extra_headers: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        data = json.dumps(payload).encode("utf-8")
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "handoffkit/1.2 OpenCodeProvider",
        }
        if extra_headers:
            headers.update(extra_headers)
        request = urllib.request.Request(
            f"{self.base_url}{path}",
            data=data,
            headers=headers,
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                body = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise ProviderExecutionError(
                f"OpenCode {self.catalog} request failed with HTTP {exc.code}: "
                f"{_sanitize_error_detail(detail, self.api_key)}"
            ) from exc
        except urllib.error.URLError as exc:
            raise ProviderExecutionError(
                f"OpenCode {self.catalog} request failed for {self.base_url}: {exc.reason}"
            ) from exc
        if not isinstance(body, dict):
            raise ProviderExecutionError(
                f"OpenCode {self.catalog} response was not a JSON object."
            )
        return body


class OpenCodeZenProvider(OpenCodeProvider):
    """Provider for OpenCode Zen."""

    def __init__(self, model: str | None = None, **kwargs: Any) -> None:
        super().__init__(model=model, catalog="zen", **kwargs)


class OpenCodeGoProvider(OpenCodeProvider):
    """Provider for OpenCode Go."""

    def __init__(self, model: str | None = None, **kwargs: Any) -> None:
        super().__init__(model=model, catalog="go", **kwargs)


def _resolve_model(catalog: OpenCodeCatalog) -> str:
    if catalog == "go":
        return (
            os.getenv("OPENCODE_GO_MODEL")
            or os.getenv("OPENCODE_MODEL")
            or DEFAULT_OPENCODE_GO_MODEL
        )
    return (
        os.getenv("OPENCODE_ZEN_MODEL")
        or os.getenv("OPENCODE_MODEL")
        or DEFAULT_OPENCODE_ZEN_MODEL
    )


def _resolve_base_url(catalog: OpenCodeCatalog, base_url: str | None) -> str:
    if catalog == "go":
        configured = (
            base_url
            or os.getenv("OPENCODE_GO_BASE_URL")
            or os.getenv("OPENCODE_BASE_URL")
            or DEFAULT_OPENCODE_GO_BASE_URL
        )
    else:
        configured = (
            base_url
            or os.getenv("OPENCODE_ZEN_BASE_URL")
            or os.getenv("OPENCODE_BASE_URL")
            or DEFAULT_OPENCODE_ZEN_BASE_URL
        )
    return configured.rstrip("/")


def _normalize_catalog(catalog: str) -> OpenCodeCatalog:
    if catalog not in {"zen", "go"}:
        raise ProviderConfigurationError("catalog must be 'zen' or 'go'.")
    return catalog  # type: ignore[return-value]


def _strip_opencode_prefix(model: str, catalog: OpenCodeCatalog) -> str:
    prefix = "opencode-go/" if catalog == "go" else "opencode/"
    if model.startswith(prefix):
        return model.removeprefix(prefix)
    return model


def _extract_text_parts(content: list[Any]) -> str:
    parts: list[str] = []
    for item in content:
        if isinstance(item, str):
            parts.append(item)
        elif isinstance(item, dict):
            text = item.get("text")
            if isinstance(text, str):
                parts.append(text)
    return "".join(parts)


def _sanitize_error_detail(detail: str, api_key: str | None) -> str:
    if not api_key:
        return detail
    return detail.replace(api_key, "[redacted-api-key]")
