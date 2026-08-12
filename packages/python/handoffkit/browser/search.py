"""First-party web search (DDG HTML + Wikipedia OpenSearch)."""

from __future__ import annotations

import json
import re
from typing import Any
from urllib.parse import parse_qs, quote, quote_plus, unquote, urlparse

from handoffkit.browser.rank import rank_search_hits
from handoffkit.browser.transport import WebTransport, default_transport
from handoffkit.browser.types import DEFAULT_UA
from handoffkit.browser.user_browser import USER_BROWSER_PROVIDER, search_user_browser
from handoffkit.browser.util import detect_soft_block

STOPWORDS = {
    "a",
    "an",
    "the",
    "of",
    "in",
    "on",
    "at",
    "to",
    "for",
    "and",
    "or",
    "that",
    "this",
    "was",
    "were",
    "is",
    "are",
    "had",
    "have",
    "has",
    "with",
    "its",
    "it",
    "as",
    "by",
    "from",
    "what",
    "which",
    "who",
    "when",
    "where",
    "how",
}

_RESULT_RE = re.compile(
    r"""<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)</a>""",
    re.I,
)
_TAG_RE = re.compile(r"<[^>]+>")
_UDDG_RE = re.compile(r'uddg=([^&"\'>\s]+)', re.I)
DEFAULT_SEARCH_PROVIDERS = ("duckduckgo", "wikipedia")
SUPPORTED_SEARCH_PROVIDERS = ("duckduckgo", "wikipedia", USER_BROWSER_PROVIDER)


def provider_engine(providers: list[str] | tuple[str, ...] | None) -> str:
    names: list[str] = []
    for raw in providers or []:
        value = str(raw or "").strip().lower()
        provider = {
            "ddg": "duckduckgo",
            "wiki": "wikipedia",
            "user-browser": USER_BROWSER_PROVIDER,
        }.get(value, value)
        engine = {
            "duckduckgo": "duckduckgo_html",
            "wikipedia": "wikipedia_opensearch",
            USER_BROWSER_PROVIDER: "user_browser_bridge",
        }.get(provider)
        if engine and engine not in names:
            names.append(engine)
    return "+".join(names) or "none"


def keyword_compress(query: str, max_words: int = 10) -> str:
    words: list[str] = []
    for raw in re.findall(r"[A-Za-z0-9][A-Za-z0-9'-]*", query or ""):
        if raw.lower() in STOPWORDS or len(raw) < 2:
            continue
        words.append(raw)
        if len(words) >= max_words:
            break
    return " ".join(words)


def _strip(s: str) -> str:
    return re.sub(r"\s+", " ", _TAG_RE.sub("", s or "")).strip()


def _unwrap_ddg(href: str) -> str:
    raw = href or ""
    if "uddg=" in raw:
        try:
            qs = parse_qs(urlparse(raw).query)
            if "uddg" in qs and qs["uddg"]:
                return unquote(qs["uddg"][0])
        except Exception:  # noqa: BLE001
            pass
        m = _UDDG_RE.search(raw)
        if m:
            return unquote(m.group(1))
    if raw.startswith("//"):
        return "https:" + raw
    return raw


def search_duckduckgo(
    query: str,
    *,
    max_results: int = 8,
    transport: WebTransport | None = None,
    timeout_ms: int = 15000,
) -> list[dict[str, str]]:
    q = (query or "").strip()
    if not q:
        return []
    tr = transport or default_transport(True)
    url = f"https://html.duckduckgo.com/html/?q={quote_plus(q)}"
    resp = tr.get(
        url,
        timeout_ms=timeout_ms,
        headers={"User-Agent": DEFAULT_UA, "Accept": "text/html"},
    )
    if detect_soft_block(resp.body, resp.status)["blocked"] or not resp.body:
        return []
    hits: list[dict[str, str]] = []
    seen: set[str] = set()

    for m in _RESULT_RE.finditer(resp.body):
        link = _unwrap_ddg(m.group(1))
        title = _strip(m.group(2))
        if link and link.startswith("http") and "duckduckgo.com" not in link and link not in seen:
            seen.add(link)
            hits.append({"title": title or link, "url": link})
        if len(hits) >= max_results * 2:
            return hits

    for m in _UDDG_RE.finditer(resp.body):
        link = unquote(m.group(1))
        if link.startswith("http") and "duckduckgo.com" not in link and link not in seen:
            seen.add(link)
            hits.append({"title": "", "url": link})
        if len(hits) >= max_results * 2:
            break
    return hits


def search_wikipedia(
    query: str,
    *,
    max_results: int = 8,
    transport: WebTransport | None = None,
    timeout_ms: int = 15000,
    lang: str = "en",
) -> list[dict[str, str]]:
    q = (query or "").strip()
    if not q:
        return []
    tr = transport or default_transport(True)
    # Keep query-string shape stable for map-transport fixtures / tests.
    api = (
        f"https://{lang}.wikipedia.org/w/api.php?action=opensearch&format=json"
        f"&limit={max_results}&search={quote(q)}"
    )
    resp = tr.get(
        api,
        timeout_ms=timeout_ms,
        headers={"User-Agent": DEFAULT_UA, "Accept": "application/json"},
    )
    if not resp.body:
        return []
    try:
        data = json.loads(resp.body)
    except Exception:  # noqa: BLE001
        return []
    if not isinstance(data, list) or len(data) < 4:
        return []
    titles = data[1] if isinstance(data[1], list) else []
    urls = data[3] if isinstance(data[3], list) else []
    hits: list[dict[str, str]] = []
    for i, title in enumerate(titles):
        url = urls[i] if i < len(urls) else ""
        if title and url:
            hits.append({"title": str(title), "url": str(url)})
    return hits


def web_search(
    query: str,
    *,
    max_results: int = 8,
    transport: WebTransport | None = None,
    timeout_ms: int = 20000,
    providers: list[str] | None = None,
    allow_hosts: list[str] | None = None,
    deny_hosts: list[str] | None = None,
    user_browser: Any | None = None,
) -> dict[str, Any]:
    q = (query or "").strip()
    if not q:
        return {
            "success": False,
            "query": "",
            "keywords": "",
            "results": [],
            "count": 0,
            "providers_requested": [str(item) for item in (providers or DEFAULT_SEARCH_PROVIDERS)],
            "providers_used": [],
            "errors": ["query is required"],
            "provider_codes": [],
            "engine": provider_engine(providers or list(DEFAULT_SEARCH_PROVIDERS)),
            "error_code": "query_required",
            "error": "query is required",
        }
    kw = keyword_compress(q) or q
    requested = list(providers or DEFAULT_SEARCH_PROVIDERS)
    normalized: list[str] = []
    errors: list[str] = []
    for raw in requested:
        value = str(raw or "").strip().lower()
        provider = {
            "ddg": "duckduckgo",
            "wiki": "wikipedia",
            "user-browser": USER_BROWSER_PROVIDER,
        }.get(value, value)
        if not provider:
            continue
        if provider not in SUPPORTED_SEARCH_PROVIDERS:
            errors.append(f"unsupported provider: {provider}")
            continue
        if provider not in normalized:
            normalized.append(provider)
    if not normalized and not errors:
        errors.append("no search providers configured")
    tr = transport or default_transport(True)
    raw: list[dict[str, str]] = []
    used: list[str] = []
    provider_codes: list[str] = []

    for provider in normalized:
        try:
            if provider == "duckduckgo":
                hits = search_duckduckgo(
                    kw, max_results=max_results, transport=tr, timeout_ms=timeout_ms
                )
                provider_result: dict[str, Any] | None = None
            elif provider == "wikipedia":
                hits = search_wikipedia(
                    kw,
                    max_results=max_results,
                    transport=tr,
                    timeout_ms=timeout_ms,
                )
                provider_result = None
            else:
                provider_result = search_user_browser(
                    user_browser,
                    q,
                    max_results=max_results,
                    timeout_ms=timeout_ms,
                )
                hits = provider_result.get("hits") or []
            if hits:
                raw.extend(hits)
                used.append(provider)
            elif provider_result and provider_result.get("error_code"):
                code = str(provider_result["error_code"])
                provider_codes.append(code)
                errors.append(f"{provider}: {provider_result.get('error') or code}")
            else:
                errors.append(f"{provider}: empty")
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{provider}: {exc}")

    ranked = rank_search_hits(raw, allow_hosts=allow_hosts, deny_hosts=deny_hosts)
    results = [
        {"title": str(h["title"]), "url": str(h["url"]), "score": int(h["score"])}
        for h in ranked[:max_results]
    ]
    return {
        "success": bool(results),
        "query": q,
        "keywords": kw,
        "results": results,
        "count": len(results),
        "providers_requested": [str(item) for item in requested],
        "providers_used": used,
        "errors": errors,
        "engine": provider_engine(requested),
        "provider_codes": provider_codes,
        "error_code": (
            ""
            if results
            else "user_browser_bridge_required"
            if "user_browser_bridge_required" in provider_codes
            else "user_browser_invalid_response"
            if "user_browser_invalid_response" in provider_codes
            else "provider_unavailable"
            if any(error.startswith("unsupported provider:") for error in errors)
            else "no_results"
        ),
        "error": "" if results else "no search results",
    }
