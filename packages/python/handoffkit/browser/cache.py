"""Optional on-disk page cache."""

from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path
from typing import Any

from handoffkit.browser.types import canonical_url


class BrowserCache:
    def __init__(self, root: str | Path = "", ttl_ms: int = 24 * 60 * 60 * 1000) -> None:
        self.root = Path(root).resolve() if root else Path()
        self.ttl_ms = int(ttl_ms)
        self.enabled = bool(root)

    def _path(self, url: str) -> Path:
        key = hashlib.sha256(canonical_url(url).encode("utf-8")).hexdigest()[:32]
        return self.root / f"{key}.json"

    def get(self, url: str) -> dict[str, Any] | None:
        if not self.enabled:
            return None
        path = self._path(url)
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            return None
        if not isinstance(raw, dict):
            return None
        if self.ttl_ms > 0 and time.time() * 1000 - float(raw.get("saved_at") or 0) > self.ttl_ms:
            return None
        return raw

    def set(self, url: str, payload: dict[str, Any] | None = None) -> bool:
        if not self.enabled:
            return False
        self.root.mkdir(parents=True, exist_ok=True)
        body = {"url": canonical_url(url), "saved_at": int(time.time() * 1000), **(payload or {})}
        self._path(url).write_text(json.dumps(body, ensure_ascii=False), encoding="utf-8")
        return True


def default_cache_root() -> Path:
    return Path.cwd() / ".cache" / "handoffkit-browser"
