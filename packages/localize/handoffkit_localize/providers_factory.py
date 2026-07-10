"""Provider factory using HandoffKit."""

from __future__ import annotations

import os
from typing import Any

from handoffkit.providers import (
    NativeOpenAIProvider,
    OllamaProvider,
    OpenAIProvider,
    OpenCodeGoProvider,
    OpenCodeZenProvider,
    default_provider_specs,
    get_native_provider_config,
)

from handoffkit_localize.settings import load_settings


def list_providers_info() -> list[dict[str, Any]]:
    rows = []
    for spec in default_provider_specs():
        env0 = spec.env_vars[0] if spec.env_vars else ""
        rows.append(
            {
                "id": spec.name,
                "description": spec.description,
                "default_model": spec.default_model,
                "suggested": list(spec.suggested_models or ())[:5],
                "env": env0,
                "key_set": (not env0) or bool(os.environ.get(env0)),
            }
        )
    return rows


def make_provider(
    provider: str | None = None,
    model: str | None = None,
    *,
    role: str = "translator",
    timeout: int = 600,
) -> Any:
    s = load_settings()
    role_cfg = (s.get("agents") or {}).get(role) or {}
    prov = (provider or role_cfg.get("provider") or "opencode-go").lower().strip()
    mod = (model or role_cfg.get("model") or "deepseek-v4-flash").strip()

    if prov in ("opencode-go", "go"):
        return OpenCodeGoProvider(model=mod, timeout=timeout)
    if prov in ("opencode-zen", "zen"):
        return OpenCodeZenProvider(model=mod, timeout=timeout)
    if prov == "ollama":
        return OllamaProvider(model=mod)
    if prov in ("openai", "openai-compatible"):
        return OpenAIProvider(model=mod, timeout=timeout)

    try:
        cfg = get_native_provider_config(prov)
    except Exception as exc:
        raise SystemExit(f"Unknown provider '{prov}'. Try: hk-localize providers") from exc
    return NativeOpenAIProvider(
        provider=prov, model=mod or cfg.default_model, timeout=timeout
    )


def provider_label(role: str = "translator") -> str:
    a = (load_settings().get("agents") or {}).get(role) or {}
    return f"{a.get('provider', '?')} / {a.get('model', '?')}"
