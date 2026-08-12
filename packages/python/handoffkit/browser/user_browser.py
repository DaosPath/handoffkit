"""Explicit bridge for a host application's already-authorized browser.

The browser package does not discover profiles, read cookies, open tabs, or
control an engine. A host may inject an object exposing ``search(query, ...)``;
the response is normalized to safe HTTP(S) hits and structured errors.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Protocol, runtime_checkable
from urllib.parse import urlparse, urlunparse

USER_BROWSER_PROVIDER = "user_browser"


@runtime_checkable
class UserBrowserBridge(Protocol):
    def search(self, query: str, **options: Any) -> Any:
        """Return a list of hits or ``{"results": [...]}`` for one query."""


def is_user_browser_bridge(bridge: Any) -> bool:
    return callable(getattr(bridge, "search", None))


def _bounded_int(value: Any, fallback: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return fallback
    return max(1, min(parsed, maximum))


def _normalize_hit(raw: Any) -> dict[str, str] | None:
    if not isinstance(raw, Mapping):
        return None
    raw_url = str(raw.get("url") or raw.get("href") or raw.get("link") or "").strip()
    if not raw_url:
        return None
    parsed = urlparse(raw_url)
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.netloc:
        return None
    # Drop fragments so the same page is not returned twice by a DOM bridge.
    url = urlunparse(
        (parsed.scheme.lower(), parsed.netloc, parsed.path, parsed.params, parsed.query, "")
    )
    title = str(raw.get("title") or raw.get("name") or raw.get("text") or "").strip()
    return {"title": title or url, "url": url}


def search_user_browser(
    bridge: Any,
    query: str,
    *,
    max_results: int = 8,
    timeout_ms: int = 20000,
) -> dict[str, Any]:
    """Execute one explicit user-browser search without leaking session data."""
    q = str(query or "").strip()
    if not q:
        return {"hits": [], "error_code": "query_required", "error": "query is required"}
    if not is_user_browser_bridge(bridge):
        return {
            "hits": [],
            "error_code": "user_browser_bridge_required",
            "error": "user_browser requires an injected search bridge",
        }

    limit = _bounded_int(max_results, 8, 8)
    timeout = _bounded_int(timeout_ms, 20000, 60000)
    try:
        response = bridge.search(q, max_results=limit, timeout_ms=timeout)
        raw_hits = (
            response
            if isinstance(response, list)
            else response.get("results")
            if isinstance(response, Mapping)
            else None
        )
        if not isinstance(raw_hits, list):
            return {
                "hits": [],
                "error_code": "user_browser_invalid_response",
                "error": "user_browser bridge must return a list or { results }",
            }
        hits: list[dict[str, str]] = []
        seen: set[str] = set()
        for raw in raw_hits:
            hit = _normalize_hit(raw)
            if not hit or hit["url"] in seen:
                continue
            seen.add(hit["url"])
            hits.append(hit)
            if len(hits) >= limit:
                break
        response_map = response if isinstance(response, Mapping) else {}
        return {
            "hits": hits,
            "error_code": str(response_map.get("error_code") or ""),
            "error": str(response_map.get("error") or ""),
        }
    except Exception as exc:  # noqa: BLE001
        code = str(getattr(exc, "code", "") or "user_browser_error")
        message = " ".join(str(exc).split())[:240]
        return {"hits": [], "error_code": code, "error": message or code}


__all__ = [
    "USER_BROWSER_PROVIDER",
    "UserBrowserBridge",
    "is_user_browser_bridge",
    "search_user_browser",
]
