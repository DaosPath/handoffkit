"""User settings for public localize CLI (stored under ~/.handoffkit-localize/)."""

from __future__ import annotations

import json
import os
from copy import deepcopy
from pathlib import Path
from typing import Any

APP_DIR = Path.home() / ".handoffkit-localize"
SETTINGS_PATH = APP_DIR / "settings.json"
WORK_DIR = APP_DIR / "workspace"

DEFAULT_SETTINGS: dict[str, Any] = {
    "version": 1,
    "public": True,
    "content_policy": "pg",  # public package: PG sample only
    "work": {"game_root": "", "project_name": ""},
    "languages": {"source": "en", "targets": ["es", "zh", "pt", "hi"]},
    "orchestration": {
        "agents_per_sub": 10,
        "subs_per_lang": 2,
        "reviewers_per_lang": 5,
        "max_items": 60,
        "max_chars": 60000,
        "max_tokens": 64000,
        "review_after_translate": True,
    },
    "agents": {
        "analyzer": {
            "provider": "opencode-go",
            "model": "deepseek-v4-flash",
            "role": "Folder analyzer",
        },
        "translator": {
            "provider": "opencode-go",
            "model": "deepseek-v4-flash",
            "role": "Parallel translators",
        },
        "reviewer": {
            "provider": "opencode-go",
            "model": "deepseek-v4-flash",
            "role": "LQA reviewers",
        },
        "chat": {
            "provider": "opencode-go",
            "model": "deepseek-v4-flash",
            "role": "Fix chat",
        },
    },
}


def ensure_dirs() -> None:
    APP_DIR.mkdir(parents=True, exist_ok=True)
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    (WORK_DIR / "catalog").mkdir(exist_ok=True)
    (WORK_DIR / "memory").mkdir(exist_ok=True)
    (WORK_DIR / "logs" / "quality").mkdir(parents=True, exist_ok=True)
    (WORK_DIR / "glossary").mkdir(exist_ok=True)


def _merge(base: dict, overlay: dict) -> dict:
    out = deepcopy(base)
    for k, v in overlay.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _merge(out[k], v)
        else:
            out[k] = v
    return out


def load_settings() -> dict[str, Any]:
    ensure_dirs()
    if not SETTINGS_PATH.exists():
        save_settings(deepcopy(DEFAULT_SETTINGS))
        return deepcopy(DEFAULT_SETTINGS)
    data = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
    return _merge(DEFAULT_SETTINGS, data)


def save_settings(settings: dict[str, Any]) -> Path:
    ensure_dirs()
    SETTINGS_PATH.write_text(
        json.dumps(settings, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return SETTINGS_PATH


def game_root(settings: dict[str, Any] | None = None) -> Path:
    s = settings or load_settings()
    raw = (s.get("work") or {}).get("game_root") or ""
    if not raw:
        return Path("")
    p = Path(raw).expanduser()
    if p.name.lower() == "www" and p.parent.exists():
        return p.parent.resolve()
    return p.resolve() if p.exists() or raw else p


def set_game_root(path: str | Path) -> Path:
    s = load_settings()
    p = Path(path).expanduser().resolve()
    if p.name.lower() == "www":
        p = p.parent
    s["work"]["game_root"] = str(p)
    s["work"]["project_name"] = p.name[:80]
    save_settings(s)
    return p


def set_agent(
    role: str, *, provider: str | None = None, model: str | None = None
) -> None:
    s = load_settings()
    roles = list(s["agents"].keys()) if role == "all" else [role]
    for r in roles:
        if r not in s["agents"]:
            raise SystemExit(f"Unknown role {r}")
        if provider:
            s["agents"][r]["provider"] = provider
        if model:
            s["agents"][r]["model"] = model
    save_settings(s)


def set_targets(targets: list[str]) -> None:
    s = load_settings()
    s["languages"]["targets"] = [t.strip().lower() for t in targets if t.strip()]
    save_settings(s)


def workspace() -> Path:
    ensure_dirs()
    return WORK_DIR


def env_status(provider: str) -> str:
    """Human-readable API key status for known providers."""
    env_map = {
        "opencode-go": "OPENCODE_API_KEY",
        "opencode-zen": "OPENCODE_API_KEY",
        "openai-compatible": "OPENAI_API_KEY",
        "openai": "OPENAI_API_KEY",
        "nvidia": "NVIDIA_API_KEY",
        "openrouter": "OPENROUTER_API_KEY",
        "groq": "GROQ_API_KEY",
        "grok": "XAI_API_KEY",
        "together": "TOGETHER_API_KEY",
        "fireworks": "FIREWORKS_API_KEY",
        "deepinfra": "DEEPINFRA_API_KEY",
        "perplexity": "PERPLEXITY_API_KEY",
        "mistral": "MISTRAL_API_KEY",
        "cerebras": "CEREBRAS_API_KEY",
        "sambanova": "SAMBANOVA_API_KEY",
        "zai": "ZAI_API_KEY",
        "ollama": "",
    }
    key = env_map.get(provider, "")
    if not key:
        return "local/n-a"
    val = os.environ.get(key, "")
    return f"set ({key})" if val else f"MISSING ${key}"
