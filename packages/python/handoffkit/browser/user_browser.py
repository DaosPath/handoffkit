"""Explicit bridge for a host application's already-authorized browser.

The browser package does not discover profiles, read cookies, open tabs, or
control an engine. A host may inject an object exposing ``search(query, ...)``
and, for page research, ``fetch(url, ...)`` or ``open(url, ...)``. Page access
is explicit and fail-closed; selecting this provider never silently falls back
to an unrelated HTTP transport.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Protocol, runtime_checkable
from urllib.parse import urlparse, urlunparse

from handoffkit.browser.html_extract import extract_page
from handoffkit.browser.types import (
    ExplorePolicy,
    canonical_url,
    host_allowed,
    normalize_host,
    parse_url,
    resolve_url,
    url_allowed,
)
from handoffkit.browser.util import smart_truncate

USER_BROWSER_PROVIDER = "user_browser"


@runtime_checkable
class UserBrowserBridge(Protocol):
    def search(self, query: str, **options: Any) -> Any:
        """Return a list of hits or ``{"results": [...]}`` for one query."""


@runtime_checkable
class UserBrowserPageBridge(Protocol):
    def fetch(self, url: str, **options: Any) -> Any:
        """Return a page mapping, optionally including HTML and links."""

    def open(self, url: str, **options: Any) -> Any:
        """Alias for hosts that call page access ``open``."""


def is_user_browser_bridge(bridge: Any) -> bool:
    return callable(getattr(bridge, "search", None))


def is_user_browser_page_bridge(bridge: Any) -> bool:
    return callable(getattr(bridge, "fetch", None)) or callable(getattr(bridge, "open", None))


def _bounded_int(value: Any, fallback: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return fallback
    return max(1, min(parsed, maximum))


def _bounded(value: Any, fallback: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return fallback
    return max(minimum, min(parsed, maximum))


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


def _normalize_page_link(raw: Any, base_url: str) -> dict[str, str] | None:
    source: Mapping[str, Any]
    if isinstance(raw, str):
        source = {"href": raw}
    elif isinstance(raw, Mapping):
        source = raw
    else:
        return None
    raw_href = str(
        source.get("absolute")
        or source.get("url")
        or source.get("href")
        or source.get("link")
        or ""
    ).strip()
    if not raw_href:
        return None
    resolved = resolve_url(base_url, raw_href)
    parsed = parse_url(resolved)
    if not parsed["valid"] or parsed["scheme"] not in {"http", "https"}:
        return None
    absolute = canonical_url(resolved)
    if not absolute:
        return None
    return {
        "href": str(source.get("href") or raw_href),
        "absolute": absolute,
        "text": str(source.get("text") or source.get("title") or source.get("name") or "")[
            :240
        ].strip(),
    }


def _normalize_page_response(
    raw: Any, requested_url: str, options: Mapping[str, Any]
) -> dict[str, Any]:
    envelope = raw if isinstance(raw, Mapping) else {}
    payload_raw = envelope.get("page")
    payload: Mapping[str, Any] = payload_raw if isinstance(payload_raw, Mapping) else envelope
    final_url = canonical_url(
        str(
            payload.get("final_url")
            or payload.get("finalUrl")
            or payload.get("url")
            or requested_url
        ).strip()
    )
    try:
        status = int(payload.get("status") or envelope.get("status") or 200)
    except (TypeError, ValueError):
        status = 0
    html = str(payload.get("html") or payload.get("body") or "")
    max_text_chars = _bounded(
        options.get("max_text_chars", options.get("maxTextChars")), 50000, 1, 500000
    )
    max_markdown_chars = _bounded(
        options.get("max_markdown_chars", options.get("maxMarkdownChars")), 60000, 1, 1000000
    )
    max_links = _bounded(
        options.get("max_links_per_page", options.get("maxLinksPerPage")), 100, 1, 1000
    )
    extracted = (
        extract_page(
            html,
            base_url=final_url,
            max_text_chars=max_text_chars,
            max_markdown_chars=max_markdown_chars,
            max_links=max_links,
            emit_markdown=True,
        )
        if html
        else {"title": "", "text": "", "markdown": "", "links": []}
    )
    title = str(payload.get("title") or extracted.get("title") or "").strip()
    text = smart_truncate(str(payload.get("text") or extracted.get("text") or ""), max_text_chars)
    markdown = smart_truncate(
        str(payload.get("markdown") or extracted.get("markdown") or text), max_markdown_chars
    )
    raw_links = payload.get("links")
    if not isinstance(raw_links, list):
        raw_links = payload.get("outlinks")
    if not isinstance(raw_links, list):
        raw_links = extracted.get("links") or []
    links: list[dict[str, str]] = []
    seen: set[str] = set()
    for raw_link in raw_links:
        link = _normalize_page_link(raw_link, final_url or requested_url)
        if not link or link["absolute"] in seen:
            continue
        seen.add(link["absolute"])
        links.append(link)
        if len(links) >= max_links:
            break
    explicit_error = str(payload.get("error") or envelope.get("error") or "").strip()
    explicit_success = payload.get("success", envelope.get("success"))
    has_content = bool(title or text or markdown or links)
    success = explicit_success is not False and not explicit_error and has_content and status < 400
    return {
        "success": success,
        "url": canonical_url(requested_url),
        "final_url": final_url or canonical_url(requested_url),
        "status": status,
        "title": title,
        "text": text,
        "markdown": markdown,
        "links": links,
        "error_code": ""
        if success
        else str(
            payload.get("error_code")
            or envelope.get("error_code")
            or ("user_browser_page_failed" if has_content else "user_browser_invalid_page")
        ),
        "error": ""
        if success
        else explicit_error
        or (f"page status {status}" if has_content else "user_browser_invalid_page"),
        "metadata": {
            "transport": "user_browser_bridge",
            "source": "authorized_user_browser",
            **(
                dict(payload.get("metadata"))
                if isinstance(payload.get("metadata"), Mapping)
                else {}
            ),
        },
    }


def fetch_user_browser_page(bridge: Any, url: str, **options: Any) -> dict[str, Any]:
    """Fetch one page through ``fetch``/``open`` and normalize its content."""
    requested_url = canonical_url(str(url or "").strip())
    parts = parse_url(requested_url)
    if not parts["valid"] or not parts["host"] or parts["scheme"] not in {"http", "https"}:
        return {
            "success": False,
            "url": requested_url,
            "final_url": requested_url,
            "status": 0,
            "title": "",
            "text": "",
            "markdown": "",
            "links": [],
            "error_code": "invalid_url",
            "error": "user_browser page URL must be http(s)",
            "metadata": {"transport": "user_browser_bridge"},
        }
    if not is_user_browser_page_bridge(bridge):
        return {
            "success": False,
            "url": requested_url,
            "final_url": requested_url,
            "status": 0,
            "title": "",
            "text": "",
            "markdown": "",
            "links": [],
            "error_code": "user_browser_fetch_bridge_required",
            "error": "user_browser research requires an injected fetch(url) or open(url) bridge",
            "metadata": {"transport": "user_browser_bridge"},
        }
    timeout = _bounded(options.get("timeout_ms", options.get("timeoutMs")), 20000, 1, 120000)
    call_options = dict(options)
    call_options.update({"timeout_ms": timeout, "timeoutMs": timeout})
    method = getattr(bridge, "fetch", None) or getattr(bridge, "open", None)
    try:
        response = method(requested_url, **call_options)
        return _normalize_page_response(response, requested_url, call_options)
    except Exception as exc:  # noqa: BLE001
        code = str(getattr(exc, "code", "") or "user_browser_fetch_error")
        message = " ".join(str(exc).split())[:240]
        return {
            "success": False,
            "url": requested_url,
            "final_url": requested_url,
            "status": 0,
            "title": "",
            "text": "",
            "markdown": "",
            "links": [],
            "error_code": code,
            "error": message or code,
            "metadata": {"transport": "user_browser_bridge"},
        }


def explore_user_browser(
    bridge: Any,
    start_urls: list[str] | tuple[str, ...] | str,
    *,
    max_pages: int = 8,
    max_depth: int = 1,
    timeout_ms: int = 20000,
    max_links_per_page: int = 100,
    max_text_chars: int = 50000,
    max_markdown_chars: int = 60000,
    same_host_only: bool = True,
    allow_hosts: list[str] | None = None,
    deny_hosts: list[str] | None = None,
    **options: Any,
) -> dict[str, Any]:
    """Run bounded BFS using only page methods exposed by the host bridge."""
    starts_raw = list(start_urls) if isinstance(start_urls, (list, tuple)) else [start_urls]
    starts = [canonical_url(str(url or "").strip()) for url in starts_raw if str(url or "").strip()]
    starts = list(dict.fromkeys(url for url in starts if url))
    policy = ExplorePolicy.from_dict(
        {
            **options,
            "max_pages": _bounded(max_pages, 8, 1, 100),
            "max_depth": _bounded(max_depth, 1, 0, 4),
            "timeout_ms": _bounded(timeout_ms, 20000, 1, 120000),
            "max_links_per_page": _bounded(max_links_per_page, 100, 1, 1000),
            "max_text_chars": _bounded(max_text_chars, 50000, 1, 500000),
            "max_markdown_chars": _bounded(max_markdown_chars, 60000, 1, 1000000),
            "same_host_only": bool(same_host_only),
            "allow_hosts": list(allow_hosts or []),
            "deny_hosts": list(deny_hosts or []),
            "emit_markdown": True,
        }
    )
    result: dict[str, Any] = {
        "success": False,
        "start_url": starts[0] if starts else "",
        "final_url": "",
        "pages_fetched": 0,
        "max_depth_reached": 0,
        "title": "",
        "text": "",
        "markdown": "",
        "links": [],
        "steps": [],
        "policy": policy.to_dict(),
        "error": "",
        "metadata": {
            "transport": "user_browser_bridge",
            "mode": "user_browser_explore",
            "attempts": 0,
            "max_pages": policy.max_pages,
            "max_depth": policy.max_depth,
        },
    }
    if not starts:
        result["error"] = "start_url required"
        return result
    first_parts = parse_url(starts[0])
    if (
        not first_parts["valid"]
        or not first_parts["host"]
        or not host_allowed(first_parts["host"], policy)
    ):
        result["error"] = "invalid or denied start_url"
        return result
    origin = normalize_host(first_parts["host"])
    queue: list[tuple[str, int]] = [(url, 0) for url in starts]
    visited: set[str] = set()
    seen_links: set[str] = set()
    max_attempts = max(policy.max_pages * 4, policy.max_pages)
    while (
        queue
        and result["pages_fetched"] < policy.max_pages
        and result["metadata"]["attempts"] < max_attempts
    ):
        url, depth = queue.pop(0)
        if url in visited or depth > policy.max_depth:
            continue
        visited.add(url)
        result["metadata"]["attempts"] += 1
        result["max_depth_reached"] = max(result["max_depth_reached"], depth)
        page = fetch_user_browser_page(
            bridge,
            url,
            timeout_ms=policy.timeout_ms,
            max_text_chars=policy.max_text_chars,
            max_markdown_chars=policy.max_markdown_chars,
            max_links_per_page=policy.max_links_per_page,
        )
        step = {
            "step_index": len(result["steps"]),
            "depth": depth,
            "url": url,
            "final_url": page.get("final_url") or url,
            "status": int(page.get("status") or 0),
            "success": bool(page.get("success")),
            "error": page.get("error", ""),
            "error_code": page.get("error_code", ""),
            "title": page.get("title", ""),
            "text": page.get("text", ""),
            "markdown": page.get("markdown", ""),
            "links": list(page.get("links") or []),
            "raw_body_bytes": 0,
            "blocked_links": [],
        }
        result["steps"].append(step)
        if not page.get("success"):
            if not result["error"]:
                result["error"] = (
                    page.get("error") or page.get("error_code") or "user_browser fetch failed"
                )
            continue
        result["success"] = True
        result["pages_fetched"] += 1
        if not result["final_url"]:
            result["final_url"] = page.get("final_url") or url
            result["title"] = page.get("title", "")
            result["text"] = page.get("text", "")
            result["markdown"] = page.get("markdown", "")
        else:
            result["text"] = smart_truncate(
                f"{result['text']}\n\n{page.get('text', '')}", policy.max_text_chars
            )
            result["markdown"] = smart_truncate(
                f"{result['markdown']}\n\n---\n\n{page.get('markdown', '')}",
                policy.max_markdown_chars,
            )
        for link in page.get("links") or []:
            absolute = str(link.get("absolute") or "") if isinstance(link, Mapping) else ""
            if not absolute or absolute in seen_links:
                continue
            seen_links.add(absolute)
            result["links"].append(link)
            if depth >= policy.max_depth:
                continue
            if not url_allowed(absolute, policy, origin):
                step["blocked_links"].append(absolute)
                continue
            if absolute not in visited and len(queue) < policy.max_pages * 4:
                queue.append((absolute, depth + 1))
    if not result["success"] and not result["error"]:
        result["error"] = "no pages fetched"
    result["metadata"].update({"queued": len(queue), "visited": len(visited)})
    return result


__all__ = [
    "USER_BROWSER_PROVIDER",
    "UserBrowserBridge",
    "UserBrowserPageBridge",
    "is_user_browser_bridge",
    "is_user_browser_page_bridge",
    "search_user_browser",
    "fetch_user_browser_page",
    "explore_user_browser",
]
