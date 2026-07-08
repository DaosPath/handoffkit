"""Minimal OpenAI-compatible HTTP provider."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any

from handoffkit.errors import ProviderConfigurationError, ProviderExecutionError
from handoffkit.providers.base import BaseProvider

DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1"
DEFAULT_OPENAI_MODEL = "gpt-4o-mini"
DEFAULT_USER_AGENT = "handoffkit/1.4.5"


class OpenAIProvider(BaseProvider):
    """Provider that calls OpenAI or an OpenAI-compatible API."""

    def __init__(
        self,
        model: str | None = None,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
        headers: dict[str, str] | None = None,
        timeout: float = 60.0,
    ) -> None:
        self.model = model or os.getenv("OPENAI_MODEL") or DEFAULT_OPENAI_MODEL
        self.api_key = api_key or os.getenv("OPENAI_API_KEY")
        configured_base_url = base_url or os.getenv("OPENAI_BASE_URL") or DEFAULT_OPENAI_BASE_URL
        self.base_url = configured_base_url.rstrip("/")
        self.headers = dict(headers or {})
        self.timeout = timeout
        if not self.api_key:
            raise ProviderConfigurationError(
                "OPENAI_API_KEY is required for OpenAIProvider. "
                "Set the environment variable or pass api_key explicitly."
            )

    def generate(self, prompt: str, **kwargs: Any) -> str:
        """Generate text using OpenAI chat completions."""
        payload = {
            "model": kwargs.pop("model", self.model),
            "messages": [{"role": "user", "content": prompt}],
            **kwargs,
        }
        data = json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            f"{self.base_url}/chat/completions",
            data=data,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
                "User-Agent": DEFAULT_USER_AGENT,
                **self.headers,
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                body = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise ProviderExecutionError(
                f"OpenAI-compatible request failed with HTTP {exc.code}: "
                f"{self._sanitize_error_detail(detail)}"
            ) from exc
        except urllib.error.URLError as exc:
            raise ProviderExecutionError(
                f"OpenAI-compatible request failed for {self.base_url}: {exc.reason}"
            ) from exc
        choices = body.get("choices") or []
        if not choices:
            return ""
        message = choices[0].get("message") or {}
        return str(message.get("content", ""))

    def _sanitize_error_detail(self, detail: str) -> str:
        """Return provider error text without leaking the configured API key."""
        if not self.api_key:
            return detail
        return detail.replace(self.api_key, "[redacted-api-key]")
