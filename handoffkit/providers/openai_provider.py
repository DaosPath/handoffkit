"""Minimal OpenAI HTTP provider."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any

from handoffkit.errors import ProviderConfigurationError, ProviderExecutionError
from handoffkit.providers.base import BaseProvider


class OpenAIProvider(BaseProvider):
    """Provider that calls OpenAI using `OPENAI_API_KEY`."""

    def __init__(
        self,
        model: str = "gpt-4o-mini",
        *,
        api_key: str | None = None,
        base_url: str = "https://api.openai.com/v1",
        timeout: float = 60.0,
    ) -> None:
        self.model = model
        self.api_key = api_key or os.getenv("OPENAI_API_KEY")
        self.base_url = base_url.rstrip("/")
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
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                body = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise ProviderExecutionError(f"OpenAI request failed: {detail}") from exc
        except urllib.error.URLError as exc:
            raise ProviderExecutionError(f"OpenAI request failed: {exc}") from exc
        choices = body.get("choices") or []
        if not choices:
            return ""
        message = choices[0].get("message") or {}
        return str(message.get("content", ""))
