"""Explicit bridge client for the operating system's default browser.

The host owns the browser profile, permissions, cookies, and UI.  HandoffKit
only calls a loopback/HTTPS JSON bridge with bounded ``/search`` and ``/fetch``
operations.  Missing or unsafe endpoints fail closed; there is no HTTP or
other-browser fallback.
"""

from __future__ import annotations

import json
import os
from collections.abc import Callable, Mapping
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse, urlunparse
from urllib.request import Request, urlopen

DEFAULT_BROWSER_PROVIDER = "default_browser"
DEFAULT_BROWSER_BRIDGE_ENV = "HANDOFFKIT_DEFAULT_BROWSER_BRIDGE_URL"
DEFAULT_BROWSER_TOKEN_ENV = "HANDOFFKIT_DEFAULT_BROWSER_BRIDGE_TOKEN"


class DefaultBrowserBridgeError(RuntimeError):
    """Structured default-browser bridge failure."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def _bounded(value: Any, fallback: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return fallback
    return max(minimum, min(parsed, maximum))


def _loopback(hostname: str) -> bool:
    host = str(hostname or "").lower().strip("[]")
    return host in {"localhost", "127.0.0.1", "::1"} or host.endswith(".localhost")


def _normalize_endpoint(value: Any) -> tuple[str, DefaultBrowserBridgeError | None]:
    raw = str(value or "").strip()
    if not raw:
        return "", DefaultBrowserBridgeError(
            "default_browser_bridge_required",
            f"default_browser requires {DEFAULT_BROWSER_BRIDGE_ENV} or an explicit endpoint",
        )
    try:
        parsed = urlparse(raw)
    except ValueError:
        parsed = None
    if parsed is None or parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return "", DefaultBrowserBridgeError(
            "default_browser_invalid_endpoint",
            "default_browser endpoint must be an absolute http(s) URL",
        )
    if parsed.scheme != "https" and not _loopback(parsed.hostname or ""):
        return "", DefaultBrowserBridgeError(
            "default_browser_insecure_endpoint",
            (
                "default_browser HTTP bridge must use localhost, 127.0.0.1, or ::1; "
                "use HTTPS for a remote bridge"
            ),
        )
    clean = parsed._replace(fragment="")
    return urlunparse(clean).rstrip("/"), None


def _error_payload(kind: str, error: DefaultBrowserBridgeError | Exception) -> dict[str, Any]:
    code = str(getattr(error, "code", "default_browser_error") or "default_browser_error")
    message = " ".join(str(error).split())[:300] or code
    if kind == "search":
        return {"results": [], "error_code": code, "error": message}
    return {
        "success": False,
        "status": 0,
        "url": "",
        "final_url": "",
        "html": "",
        "text": "",
        "markdown": "",
        "links": [],
        "error_code": code,
        "error": message,
        "metadata": {"transport": "default_browser_bridge"},
    }


class DefaultBrowserBridge:
    """JSON bridge to the host's system-default browser session.

    ``endpoint`` points at a local service such as ``http://127.0.0.1:8765``.
    The service implements ``POST /search`` and ``POST /fetch``.  Tests may
    inject ``opener`` with the same signature as ``urllib.request.urlopen``.
    """

    provider = DEFAULT_BROWSER_PROVIDER

    def __init__(
        self,
        endpoint: str | None = None,
        *,
        token: str | None = None,
        timeout_ms: int = 20000,
        max_response_bytes: int = 8_000_000,
        opener: Callable[..., Any] | None = None,
    ) -> None:
        self.endpoint, self._endpoint_error = _normalize_endpoint(
            endpoint or os.environ.get(DEFAULT_BROWSER_BRIDGE_ENV, "")
        )
        self.token = str(
            token if token is not None else os.environ.get(DEFAULT_BROWSER_TOKEN_ENV, "")
        ).strip()
        self.timeout_ms = _bounded(timeout_ms, 20000, 1000, 120000)
        self.max_response_bytes = _bounded(max_response_bytes, 8_000_000, 1024, 50_000_000)
        self._opener = opener or urlopen

    @property
    def configured(self) -> bool:
        return self._endpoint_error is None

    @property
    def error(self) -> str:
        return str(self._endpoint_error or "")

    def _post(
        self, path: str, payload: Mapping[str, Any], timeout_ms: int, kind: str
    ) -> dict[str, Any]:
        if self._endpoint_error:
            return _error_payload(kind, self._endpoint_error)
        timeout = _bounded(timeout_ms, self.timeout_ms, 1, 120000)
        body = json.dumps(dict(payload), ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "X-HandoffKit-Bridge": "default-browser-v1",
        }
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        request = Request(
            f"{self.endpoint}/{path.lstrip('/')}",
            data=body,
            headers=headers,
            method="POST",
        )
        try:
            with self._opener(request, timeout=timeout / 1000) as response:
                status = int(getattr(response, "status", getattr(response, "code", 200)) or 200)
                raw = response.read(self.max_response_bytes + 1)
            if len(raw) > self.max_response_bytes:
                return _error_payload(
                    kind,
                    DefaultBrowserBridgeError(
                        "default_browser_response_too_large",
                        "default_browser bridge response exceeds the configured limit",
                    ),
                )
            try:
                parsed = json.loads(raw.decode("utf-8")) if raw.strip() else {}
            except (UnicodeDecodeError, json.JSONDecodeError):
                return _error_payload(
                    kind,
                    DefaultBrowserBridgeError(
                        "default_browser_invalid_response",
                        "default_browser bridge returned invalid JSON",
                    ),
                )
            if status < 200 or status >= 300:
                message = str(parsed.get("error") if isinstance(parsed, Mapping) else "") or (
                    f"default_browser bridge HTTP {status}"
                )
                return _error_payload(
                    kind, DefaultBrowserBridgeError("default_browser_http_error", message)
                )
            if not isinstance(parsed, (Mapping, list)):
                return _error_payload(
                    kind,
                    DefaultBrowserBridgeError(
                        "default_browser_invalid_response",
                        "default_browser bridge response must be an object or list",
                    ),
                )
            return dict(parsed) if isinstance(parsed, Mapping) else {"results": parsed}
        except HTTPError as exc:
            return _error_payload(
                kind,
                DefaultBrowserBridgeError(
                    "default_browser_http_error", f"default_browser bridge HTTP {exc.code}"
                ),
            )
        except (URLError, TimeoutError, OSError) as exc:
            return _error_payload(
                kind, DefaultBrowserBridgeError("default_browser_unreachable", str(exc))
            )
        except Exception as exc:  # noqa: BLE001
            return _error_payload(
                kind, DefaultBrowserBridgeError("default_browser_error", str(exc))
            )

    def search(self, query: str, **options: Any) -> dict[str, Any]:
        max_results = _bounded(options.get("max_results", options.get("maxResults", 8)), 8, 1, 20)
        timeout = _bounded(
            options.get("timeout_ms", options.get("timeoutMs", self.timeout_ms)),
            self.timeout_ms,
            1,
            120000,
        )
        return self._post(
            "/search",
            {"query": str(query or "").strip(), "max_results": max_results, "timeout_ms": timeout},
            timeout,
            "search",
        )

    def fetch(self, url: str, **options: Any) -> dict[str, Any]:
        timeout = _bounded(
            options.get("timeout_ms", options.get("timeoutMs", self.timeout_ms)),
            self.timeout_ms,
            1,
            120000,
        )
        return self._post(
            "/fetch",
            {
                "url": str(url or "").strip(),
                "timeout_ms": timeout,
                "max_text_chars": _bounded(
                    options.get("max_text_chars", options.get("maxTextChars", 50000)),
                    50000,
                    1,
                    500000,
                ),
                "max_markdown_chars": _bounded(
                    options.get("max_markdown_chars", options.get("maxMarkdownChars", 60000)),
                    60000,
                    1,
                    1_000_000,
                ),
                "max_links_per_page": _bounded(
                    options.get("max_links_per_page", options.get("maxLinksPerPage", 100)),
                    100,
                    1,
                    1000,
                ),
            },
            timeout,
            "fetch",
        )

    def open(self, url: str, **options: Any) -> dict[str, Any]:
        return self.fetch(url, **options)


def is_default_browser_bridge(bridge: Any) -> bool:
    return bool(
        bridge
        and getattr(bridge, "provider", "") == DEFAULT_BROWSER_PROVIDER
        and callable(getattr(bridge, "search", None))
    )


def _remap_error(result: dict[str, Any], prefix: str = DEFAULT_BROWSER_PROVIDER) -> dict[str, Any]:
    out = dict(result or {})
    code = str(out.get("error_code") or out.get("errorCode") or "")
    if code == "user_browser_bridge_required":
        out["error_code"] = f"{prefix}_bridge_required"
    elif code == "user_browser_invalid_response":
        out["error_code"] = f"{prefix}_invalid_response"
    elif code == "user_browser_error":
        out["error_code"] = f"{prefix}_error"
    return out


def search_default_browser(bridge: Any, query: str, **options: Any) -> dict[str, Any]:
    from handoffkit.browser.user_browser import search_user_browser

    if bridge is None:
        error = _error_payload(
            "search",
            DefaultBrowserBridgeError(
                "default_browser_bridge_required",
                "default_browser requires an injected bridge or endpoint",
            ),
        )
        return {"hits": [], "error_code": error["error_code"], "error": error["error"]}
    return _remap_error(search_user_browser(bridge, query, **options))


def search_default_browser_many(bridge: Any, queries: Any, **options: Any) -> dict[str, Any]:
    from handoffkit.browser.user_browser import search_user_browser_many

    if bridge is None:
        return {
            "success": False,
            "queries": [],
            "hits": [],
            "count": 0,
            "query_results": [],
            "errors": ["default_browser requires an injected bridge or endpoint"],
            "error_codes": ["default_browser_bridge_required"],
            "error_code": "default_browser_bridge_required",
            "error": "default_browser requires an injected bridge or endpoint",
            "metadata": {"transport": "default_browser_bridge"},
        }
    return _remap_error(search_user_browser_many(bridge, queries, **options))


def fetch_default_browser_page(bridge: Any, url: str, **options: Any) -> dict[str, Any]:
    from handoffkit.browser.user_browser import fetch_user_browser_page

    if bridge is None:
        return _error_payload(
            "fetch",
            DefaultBrowserBridgeError(
                "default_browser_bridge_required",
                "default_browser requires an injected bridge or endpoint",
            ),
        )
    return _remap_error(fetch_user_browser_page(bridge, url, **options))


def explore_default_browser(bridge: Any, start_urls: Any, **options: Any) -> dict[str, Any]:
    from handoffkit.browser.user_browser import explore_user_browser

    if bridge is None:
        start = (
            start_urls[0] if isinstance(start_urls, (list, tuple)) and start_urls else start_urls
        )
        return {
            "success": False,
            "start_url": str(start or ""),
            "final_url": "",
            "pages_fetched": 0,
            "max_depth_reached": 0,
            "title": "",
            "text": "",
            "markdown": "",
            "links": [],
            "steps": [],
            "policy": options,
            "error": "default_browser requires an injected bridge or endpoint",
            "metadata": {
                "transport": "default_browser_bridge",
                "mode": "default_browser_explore",
                "error_code": "default_browser_bridge_required",
            },
        }
    result = explore_user_browser(bridge, start_urls, **options)
    result.setdefault("metadata", {}).update(
        {
            "transport": "default_browser_bridge",
            "source": "system_default_browser",
            "mode": "default_browser_explore",
        }
    )
    for step in result.get("steps") or []:
        if step.get("error_code") == "user_browser_fetch_bridge_required":
            step["error_code"] = "default_browser_bridge_required"
        elif step.get("error_code") == "user_browser_fetch_error":
            step["error_code"] = "default_browser_error"
    return result


__all__ = [
    "DEFAULT_BROWSER_PROVIDER",
    "DEFAULT_BROWSER_BRIDGE_ENV",
    "DEFAULT_BROWSER_TOKEN_ENV",
    "DefaultBrowserBridge",
    "DefaultBrowserBridgeError",
    "is_default_browser_bridge",
    "search_default_browser",
    "search_default_browser_many",
    "fetch_default_browser_page",
    "explore_default_browser",
]
