"""Ollama local HTTP provider."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any

from handoffkit.errors import ProviderExecutionError
from handoffkit.providers.base import BaseProvider


class OllamaProvider(BaseProvider):
    """Provider for a local Ollama server."""

    def __init__(
        self,
        model: str = "llama3.1",
        *,
        base_url: str = "http://localhost:11434",
        timeout: float = 60.0,
    ) -> None:
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def generate(self, prompt: str, **kwargs: Any) -> str:
        """Generate text using Ollama's `/api/generate` endpoint."""
        model = kwargs.pop("model", self.model)
        # Map common OpenAI-style kwargs → Ollama options
        options: dict[str, Any] = dict(kwargs.pop("options", None) or {})
        if "max_tokens" in kwargs:
            options.setdefault("num_predict", int(kwargs.pop("max_tokens")))
        if "temperature" in kwargs:
            options.setdefault("temperature", float(kwargs.pop("temperature")))
        keep_alive = kwargs.pop("keep_alive", "24h")
        # Drop unknown OpenAI-ish keys that Ollama rejects at top level
        for k in ("top_p", "stop", "frequency_penalty", "presence_penalty"):
            kwargs.pop(k, None)

        payload: dict[str, Any] = {
            "model": model,
            "prompt": prompt,
            "stream": False,
            "keep_alive": keep_alive,
        }
        if options:
            payload["options"] = options
        # Allow intentional extra Ollama fields (e.g. format, system)
        payload.update(kwargs)

        data = json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            f"{self.base_url}/api/generate",
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                body = json.loads(response.read().decode("utf-8"))
        except urllib.error.URLError as exc:
            raise ProviderExecutionError(f"Ollama request failed: {exc}") from exc
        return str(body.get("response", ""))
