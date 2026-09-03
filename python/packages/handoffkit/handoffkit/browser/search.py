"""First-party web search (DDG HTML + Wikipedia OpenSearch)."""

from __future__ import annotations

import html as html_lib
import json
import re
import time
from typing import Any
from urllib.parse import (
    parse_qs,
    parse_qsl,
    quote,
    quote_plus,
    unquote,
    urlencode,
    urljoin,
    urlparse,
)

from handoffkit.browser.default_browser import (
    DEFAULT_BROWSER_PROVIDER,
    search_default_browser,
)
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
_GOOGLE_A_RE = re.compile(
    r"<a\b[^>]*\bhref\s*=\s*(?:\"([^\"]*)\"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)</a>",
    re.I,
)
DEFAULT_SEARCH_PROVIDERS = (
    "google_browser",
    "project_index",
    "google_http",
    "duckduckgo",
    "wikipedia",
)
PLATFORM_SEARCH_PROVIDERS = (
    "google_browser",
    "project_index",
    "google_http",
    "duckduckgo",
    "wikipedia",
)
SUPPORTED_SEARCH_PROVIDERS = (
    "google",
    "google_http",
    "google_browser",
    "project_index",
    "duckduckgo",
    "wikipedia",
    "searxng",
    "brave",
    "bing",
    "kagi",
    USER_BROWSER_PROVIDER,
    DEFAULT_BROWSER_PROVIDER,
)


_PROVIDER_ALIASES = {
    "g": "google",
    "google_http": "google",
    "google_html": "google",
    "ddg": "duckduckgo",
    "wiki": "wikipedia",
    "sx": "searxng",
    "dodo": "searxng",
    "user-browser": USER_BROWSER_PROVIDER,
    "default-browser": DEFAULT_BROWSER_PROVIDER,
    "system-browser": DEFAULT_BROWSER_PROVIDER,
}

# SearXNG JSON endpoint; override with HANDOFFKIT_SEARXNG_URL for self-hosted
# instances (e.g. http://127.0.0.1:8888). Never sent to third parties.
SEARXNG_ENV_URL = "HANDOFFKIT_SEARXNG_URL"
SEARXNG_ENV_URLS = "HANDOFFKIT_SEARXNG_URLS"
_DEFAULT_SEARXNG_URL = ""
SEARXNG_CATEGORIES = ("general", "images", "videos", "news")
_ENGINE_TOKEN_RE = re.compile(r"^[a-z0-9_+-]+$")


def _searxng_option_list(value: Any) -> list[str]:
    items = value if isinstance(value, list) else str(value or "").split(",")
    return [str(item or "").strip().lower() for item in items if str(item or "").strip()]


def _canonical_search_provider(raw: str) -> str:
    value = str(raw or "").strip().lower()
    return _PROVIDER_ALIASES.get(value, value)


def _trace_provider_name(internal: str) -> str:
    return "google_http" if internal == "google" else internal


def provider_engine(providers: list[str] | tuple[str, ...] | None) -> str:
    names: list[str] = []
    for raw in providers or []:
        provider = _canonical_search_provider(raw)
        engine = {
            "google": "google_html",
            "google_browser": "google_browser",
            "project_index": "project_index",
            "duckduckgo": "duckduckgo_html",
            "searxng": "searxng_json",
            "brave": "brave_json",
            "bing": "bing_json",
            "kagi": "kagi_json",
            "wikipedia": "wikipedia_opensearch",
            USER_BROWSER_PROVIDER: "user_browser_bridge",
            DEFAULT_BROWSER_PROVIDER: "default_browser_bridge",
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
    return re.sub(r"\s+", " ", html_lib.unescape(_TAG_RE.sub("", s or ""))).strip()


_TRACKING_PARAMS = frozenset(
    {
        "utm_source",
        "utm_medium",
        "utm_campaign",
        "utm_term",
        "utm_content",
        "utm_id",
        "fbclid",
        "gclid",
        "gbraid",
        "wbraid",
        "msclkid",
        "yclid",
        "mc_cid",
        "mc_eid",
        "igshid",
        "_hsenc",
        "_hsmi",
        "ref",
        "ref_src",
    }
)

_RETRYABLE_STATUS = frozenset({408, 425, 429, 500, 502, 503, 504})


def canonical_search_url(raw: Any) -> str:
    """Strip tracking params and fragments so cross-provider dedup works."""
    value = str(raw or "")
    try:
        parsed = urlparse(value)
    except Exception:  # noqa: BLE001
        return value
    if parsed.scheme not in ("http", "https"):
        return value
    query = [(k, v) for k, v in parse_qsl(parsed.query) if k.lower() not in _TRACKING_PARAMS]
    rebuilt = parsed._replace(query=urlencode(query), fragment="")
    return rebuilt.geturl()


def _get_json_with_retry(
    transport: WebTransport,
    url: str,
    headers: dict[str, str],
    timeout_ms: int,
    provider: str,
    attempts: int = 3,
) -> tuple[Any | None, str | None, str | None]:
    """GET JSON with bounded retries on 429/5xx. Returns (data, error_code, error)."""
    last_code = f"{provider}_empty_response"
    last_error: str | None = f"{provider} returned no JSON results"
    rounds = max(int(attempts or 3), 1)
    for attempt in range(1, rounds + 1):
        try:
            resp = transport.get(url, timeout_ms=timeout_ms, headers=headers)
        except Exception as exc:  # noqa: BLE001 - transport failure is terminal
            return None, f"{provider}_transport_error", str(exc)
        if getattr(resp, "error", None):
            return None, f"{provider}_transport_error", str(resp.error)
        status = int(getattr(resp, "status", 0) or 0)
        body = getattr(resp, "body", "")
        if 200 <= status < 300 and body:
            try:
                return json.loads(body), None, None
            except Exception:  # noqa: BLE001
                return None, f"{provider}_invalid_response", f"{provider} returned invalid JSON"
        last_code, last_error = f"{provider}_empty_response", f"{provider} returned no JSON results"
        if status not in _RETRYABLE_STATUS or attempt >= rounds:
            break
        time.sleep(0.25 * (2 ** (attempt - 1)))
    return None, last_code, last_error


def _is_search_ad_url(url: str) -> bool:
    value = str(url or "").lower()
    return (
        not value
        or "googleadservices.com" in value
        or "doubleclick.net" in value
        or "/aclk?" in value
        or "/pagead/" in value
        or "adurl=" in value
        or "/ads/" in value
        or value.endswith("/ads")
    )


def _unwrap_google_link(raw: str) -> str:
    link = html_lib.unescape(str(raw or "").strip())
    if not link:
        return ""
    parsed = urlparse(urljoin("https://www.google.com/", link))
    if parsed.hostname in {"www.google.com", "google.com"}:
        target = (
            parse_qs(parsed.query).get("q", [""])[0] or parse_qs(parsed.query).get("url", [""])[0]
        )
        if not target:
            return ""
        link = target
    parsed = urlparse(link)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return ""
    if (
        parsed.hostname == "google.com" or (parsed.hostname or "").endswith(".google.com")
    ) or _is_search_ad_url(link):
        return ""
    return parsed._replace(fragment="").geturl()


def search_google(
    query: str,
    *,
    max_results: int = 8,
    transport: WebTransport | None = None,
    timeout_ms: int = 20000,
) -> list[dict[str, str]]:
    """Parse Google's server-rendered result page through HandoffKit HTTP.

    This is an explicit provider, not a browser-session bridge. Redirectors,
    sponsored/ad URLs, Google navigation, and empty anchors are discarded
    before host ranking.
    """
    q = (query or "").strip()
    if not q:
        return []
    tr = transport or default_transport(True)
    kw = keyword_compress(q, 10) or q
    url = f"https://www.google.com/search?hl=en&num={max(max_results, 8)}&q={quote_plus(kw)}"
    resp = tr.get(
        url,
        timeout_ms=timeout_ms,
        headers={"User-Agent": DEFAULT_UA, "Accept": "text/html,application/xhtml+xml"},
    )
    if not resp.body or resp.status < 200 or resp.status >= 300:
        return []
    hits: list[dict[str, str]] = []
    seen: set[str] = set()
    for match in _GOOGLE_A_RE.finditer(resp.body):
        link = _unwrap_google_link(match.group(1) or match.group(2) or match.group(3) or "")
        title = _strip(match.group(4) or "")
        if not link or len(title) < 2 or link in seen:
            continue
        seen.add(link)
        hits.append({"title": title, "url": link})
        if len(hits) >= max_results:
            break
    return hits


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


def search_searxng(
    query: str,
    *,
    max_results: int = 8,
    transport: WebTransport | None = None,
    timeout_ms: int = 15000,
    base_url: str | None = None,
    base_urls: list[str] | None = None,
    engines: list[str] | str | None = None,
    categories: list[str] | str | None = None,
    page: int = 1,
    safesearch: int | None = None,
    language: str | None = None,
) -> list[dict[str, str]]:
    """Search SearXNG instances' JSON API (self-hosted metasearch).

    Tries base_urls (then base_url, HANDOFFKIT_SEARXNG_URLS, HANDOFFKIT_SEARXNG_URL)
    in order until one returns hits. engines/categories/safesearch/language/page map
    to SearXNG query params; unknown values raise ValueError (fail closed).
    """
    import os

    q = (query or "").strip()
    if not q:
        return []
    bases = [b for b in _searxng_option_list(base_urls or []) if b]
    if base_url:
        bases.append(str(base_url).strip().rstrip("/"))
    bases.extend(_searxng_option_list(os.environ.get(SEARXNG_ENV_URLS, "")))
    env_single = str(os.environ.get(SEARXNG_ENV_URL, "") or _DEFAULT_SEARXNG_URL)
    env_single = env_single.strip().rstrip("/")
    if env_single:
        bases.append(env_single)
    bases = [b for b in bases if b]
    if not bases:
        raise ValueError("searxng: no base URL configured (set HANDOFFKIT_SEARXNG_URL)")
    engine_list = sorted(set(_searxng_option_list(engines or [])))
    for token in engine_list:
        if not _ENGINE_TOKEN_RE.match(token):
            raise ValueError(f"searxng: unknown engine: {token}")
    category_list = sorted(set(_searxng_option_list(categories or [])))
    for category in category_list:
        if category not in SEARXNG_CATEGORIES:
            raise ValueError(f"searxng: unknown category: {category}")
    if not isinstance(page, int) or isinstance(page, bool) or page < 1:
        raise ValueError("searxng: page must be an integer >= 1")
    if safesearch is not None and safesearch not in (0, 1, 2, "0", "1", "2"):
        raise ValueError("searxng: safesearch must be 0, 1, or 2")
    lang = re.sub(r"[^a-z-]", "", str(language or "").strip().lower())[:12]
    if language is not None and not lang:
        raise ValueError("searxng: language must be a locale token")
    extra = ""
    if engine_list:
        extra += "&engines=" + ",".join(quote_plus(e) for e in engine_list)
    if category_list:
        extra += "&categories=" + ",".join(quote_plus(c) for c in category_list)
    if page > 1:
        extra += f"&pageno={page}"
    if safesearch is not None:
        extra += f"&safesearch={safesearch}"
    if lang:
        extra += f"&language={quote_plus(lang)}"
    headers = {"User-Agent": DEFAULT_UA, "Accept": "application/json"}
    if lang:
        headers["Accept-Language"] = lang
    tr = transport or default_transport(True)
    last_error: Exception | None = None
    for base in bases:
        api = f"{base}/search?q={quote_plus(q)}&format=json{extra}"
        data, _code, error = _get_json_with_retry(tr, api, headers, timeout_ms, "searxng")
        if data is None:
            continue
        results = data.get("results") if isinstance(data, dict) else None
        if not isinstance(results, list):
            continue
        hits: list[dict[str, str]] = []
        for item in results:
            url = str(item.get("url") or "")
            title = _strip(item.get("title") or "")
            if url.startswith("http"):
                hits.append({"title": title or url, "url": url})
            if len(hits) >= max_results * 2:
                break
        for box in data.get("infoboxes") or []:
            if not isinstance(box, dict):
                continue
            for link in box.get("urls") or []:
                if not isinstance(link, dict):
                    continue
                url = str(link.get("url") or "")
                title = _strip(link.get("title") or box.get("content") or "")
                if url.startswith("http"):
                    hits.append({"title": title or url, "url": url})
                if len(hits) >= max_results * 2:
                    break
            if len(hits) >= max_results * 2:
                break
        if hits:
            return hits
    if last_error is not None:
        raise last_error
    return []


BRAVE_ENV_API_KEY = "HANDOFFKIT_BRAVE_API_KEY"
BING_ENV_API_KEY = "HANDOFFKIT_BING_API_KEY"
KAGI_ENV_API_KEY = "HANDOFFKIT_KAGI_API_KEY"


def search_brave(
    query: str,
    *,
    max_results: int = 8,
    transport: WebTransport | None = None,
    timeout_ms: int = 15000,
    api_key: str | None = None,
) -> list[dict[str, str]]:
    """Search Brave's JSON API (api.search.brave.com)."""
    import os

    q = (query or "").strip()
    if not q:
        return []
    key = str(api_key or os.environ.get(BRAVE_ENV_API_KEY, "")).strip()
    if not key:
        raise ValueError("brave: no API key configured (set HANDOFFKIT_BRAVE_API_KEY)")
    tr = transport or default_transport(True)
    count = min(max(int(max_results or 8), 1), 20)
    api = f"https://api.search.brave.com/res/v1/web/search?q={quote_plus(q)}&count={count}"
    data, _code, _error = _get_json_with_retry(
        tr,
        api,
        {
            "User-Agent": DEFAULT_UA,
            "Accept": "application/json",
            "X-Subscription-Token": key,
        },
        timeout_ms,
        "brave",
    )
    if data is None:
        return []
    results = data.get("web", {}).get("results") if isinstance(data, dict) else None
    if not isinstance(results, list):
        return []
    hits: list[dict[str, str]] = []
    for item in results:
        if not isinstance(item, dict):
            continue
        url = str(item.get("url") or "")
        title = _strip(item.get("title") or "")
        if url.startswith("http"):
            hits.append({"title": title or url, "url": url})
        if len(hits) >= max_results * 2:
            break
    return hits


def search_bing(
    query: str,
    *,
    max_results: int = 8,
    transport: WebTransport | None = None,
    timeout_ms: int = 15000,
    api_key: str | None = None,
) -> list[dict[str, str]]:
    """Search Bing's JSON API (api.bing.microsoft.com)."""
    import os

    q = (query or "").strip()
    if not q:
        return []
    key = str(api_key or os.environ.get(BING_ENV_API_KEY, "")).strip()
    if not key:
        raise ValueError("bing: no API key configured (set HANDOFFKIT_BING_API_KEY)")
    tr = transport or default_transport(True)
    count = min(max(int(max_results or 8), 1), 20)
    api = (
        "https://api.bing.microsoft.com/v7.0/search"
        f"?q={quote_plus(q)}&count={count}&responseFilter=Webpages"
    )
    data, _code, _error = _get_json_with_retry(
        tr,
        api,
        {
            "User-Agent": DEFAULT_UA,
            "Accept": "application/json",
            "Ocp-Apim-Subscription-Key": key,
        },
        timeout_ms,
        "bing",
    )
    if data is None:
        return []
    results = data.get("webPages", {}).get("value") if isinstance(data, dict) else None
    if not isinstance(results, list):
        return []
    hits: list[dict[str, str]] = []
    for item in results:
        if not isinstance(item, dict):
            continue
        url = str(item.get("url") or "")
        title = _strip(item.get("name") or "")
        if url.startswith("http"):
            hits.append({"title": title or url, "url": url})
        if len(hits) >= max_results * 2:
            break
    return hits


def search_kagi(
    query: str,
    *,
    max_results: int = 8,
    transport: WebTransport | None = None,
    timeout_ms: int = 15000,
    api_key: str | None = None,
) -> list[dict[str, str]]:
    """Search Kagi's JSON API (kagi.com)."""
    import os

    q = (query or "").strip()
    if not q:
        return []
    key = str(api_key or os.environ.get(KAGI_ENV_API_KEY, "")).strip()
    if not key:
        raise ValueError("kagi: no API key configured (set HANDOFFKIT_KAGI_API_KEY)")
    tr = transport or default_transport(True)
    api = f"https://kagi.com/api/v0/search?q={quote_plus(q)}"
    data, _code, _error = _get_json_with_retry(
        tr,
        api,
        {
            "User-Agent": DEFAULT_UA,
            "Accept": "application/json",
            "Authorization": f"Bot {key}",
        },
        timeout_ms,
        "kagi",
    )
    if data is None:
        return []
    results = data.get("data") if isinstance(data, dict) else None
    if not isinstance(results, list):
        return []
    hits: list[dict[str, str]] = []
    for item in results:
        if not isinstance(item, dict):
            continue
        url = str(item.get("url") or "")
        title = _strip(item.get("title") or "")
        if url.startswith("http"):
            hits.append({"title": title or url, "url": url})
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
    search_plan: str | None = None,
    strict_provider: bool = False,
    google_browser_search: Any | None = None,
    project_index: Any | None = None,
    searxng: dict[str, Any] | None = None,
) -> dict[str, Any]:
    q = (query or "").strip()
    if providers is None and str(search_plan or "").strip().lower() == "platform":
        requested_default: list[str] | tuple[str, ...] = PLATFORM_SEARCH_PROVIDERS
    else:
        requested_default = providers or DEFAULT_SEARCH_PROVIDERS
    if not q:
        return {
            "success": False,
            "query": "",
            "keywords": "",
            "results": [],
            "count": 0,
            "providers_requested": [str(item) for item in requested_default],
            "providers_used": [],
            "provider_trace": [],
            "errors": ["query is required"],
            "provider_codes": [],
            "engine": provider_engine(list(requested_default)),
            "error_code": "query_required",
            "error": "query is required",
            "strict_provider": bool(strict_provider),
        }
    kw = keyword_compress(q) or q
    requested = list(requested_default)
    normalized: list[str] = []
    errors: list[str] = []
    for raw in requested:
        provider = _canonical_search_provider(raw)
        if not provider:
            continue
        if provider not in SUPPORTED_SEARCH_PROVIDERS and provider != "google":
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
    provider_trace: list[dict[str, Any]] = []

    for provider in normalized:
        trace = {
            "provider": _trace_provider_name(provider),
            "attempted": True,
            "used": False,
            "result_count": 0,
            "error_code": "",
            "fallback_reason": "",
        }
        provider_result: dict[str, Any] | None = None
        hits: list[Any] = []
        try:
            if provider == "google_browser":
                if callable(google_browser_search):
                    provider_result = google_browser_search(
                        q, max_results=max_results, timeout_ms=timeout_ms
                    )
                    if isinstance(provider_result, list):
                        hits = provider_result
                        provider_result = None
                    else:
                        hits = list(
                            (provider_result or {}).get("hits")
                            or (provider_result or {}).get("results")
                            or []
                        )
                else:
                    trace["error_code"] = "provider_unavailable"
                    trace["fallback_reason"] = "google_browser_unavailable"
                    errors.append(
                        "google_browser: google_browser requires an explicit "
                        "Browser Real search hook"
                    )
                    provider_codes.append("provider_unavailable")
                    provider_trace.append(trace)
                    if strict_provider:
                        break
                    continue
            elif provider == "project_index":
                search_fn = (
                    getattr(project_index, "search", None) if project_index is not None else None
                )
                if callable(search_fn):
                    provider_result = search_fn(q, max_results=max_results, timeout_ms=timeout_ms)
                    if isinstance(provider_result, list):
                        hits = provider_result
                        provider_result = None
                    else:
                        hits = list(
                            (provider_result or {}).get("hits")
                            or (provider_result or {}).get("results")
                            or []
                        )
                else:
                    trace["error_code"] = "index_unavailable"
                    trace["fallback_reason"] = "project_index_disabled"
                    errors.append("project_index: project_index is opt-in and was not configured")
                    provider_codes.append("index_unavailable")
                    provider_trace.append(trace)
                    if strict_provider:
                        break
                    continue
            elif provider == "google":
                hits = search_google(
                    q, max_results=max_results, transport=tr, timeout_ms=timeout_ms
                )
            elif provider == "duckduckgo":
                hits = search_duckduckgo(
                    kw, max_results=max_results, transport=tr, timeout_ms=timeout_ms
                )
            elif provider == "wikipedia":
                hits = search_wikipedia(
                    kw,
                    max_results=max_results,
                    transport=tr,
                    timeout_ms=timeout_ms,
                )
            elif provider == "searxng":
                try:
                    searxng_opts = searxng or {}
                    hits = search_searxng(
                        q,
                        max_results=max_results,
                        transport=tr,
                        timeout_ms=timeout_ms,
                        base_url=searxng_opts.get("base_url"),
                        base_urls=searxng_opts.get("base_urls"),
                        engines=searxng_opts.get("engines"),
                        categories=searxng_opts.get("categories"),
                        page=int(searxng_opts.get("page", 1)),
                        safesearch=searxng_opts.get("safesearch"),
                        language=searxng_opts.get("language"),
                    )
                except ValueError as exc:
                    if "no base URL" in str(exc):
                        trace["error_code"] = "provider_unavailable"
                        trace["fallback_reason"] = "searxng_unconfigured"
                        provider_codes.append("provider_unavailable")
                    else:
                        trace["error_code"] = "searxng_invalid_options"
                        trace["fallback_reason"] = "searxng_invalid_options"
                        provider_codes.append("searxng_invalid_options")
                    errors.append(f"searxng: {exc}")
                    provider_trace.append(trace)
                    if strict_provider:
                        break
                    continue
            elif provider in ("brave", "bing", "kagi"):
                try:
                    search_fn = {"brave": search_brave, "bing": search_bing, "kagi": search_kagi}[
                        provider
                    ]
                    hits = search_fn(
                        q,
                        max_results=max_results,
                        transport=tr,
                        timeout_ms=timeout_ms,
                    )
                except ValueError as exc:
                    trace["error_code"] = "provider_unavailable"
                    trace["fallback_reason"] = f"{provider}_unconfigured"
                    errors.append(f"{provider}: {exc}")
                    provider_codes.append("provider_unavailable")
                    provider_trace.append(trace)
                    if strict_provider:
                        break
                    continue
            elif provider == DEFAULT_BROWSER_PROVIDER:
                provider_result = search_default_browser(
                    user_browser,
                    q,
                    max_results=max_results,
                    timeout_ms=timeout_ms,
                )
                hits = provider_result.get("hits") or []
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
                trace["used"] = True
                trace["result_count"] = len(hits)
            elif provider_result and provider_result.get("error_code"):
                code = str(provider_result["error_code"])
                provider_codes.append(code)
                errors.append(f"{provider}: {provider_result.get('error') or code}")
                trace["error_code"] = code
                trace["fallback_reason"] = f"{trace['provider']}_empty"
            else:
                errors.append(f"{provider}: empty")
                trace["error_code"] = "no_results"
                trace["fallback_reason"] = f"{trace['provider']}_empty"
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{provider}: {exc}")
            trace["error_code"] = "provider_unavailable"
            trace["fallback_reason"] = f"{trace['provider']}_error"
        provider_trace.append(trace)
        if strict_provider and not trace["used"]:
            break

    if strict_provider and any(item.get("fallback_reason") for item in provider_trace):
        return {
            "success": False,
            "query": q,
            "keywords": kw,
            "results": [],
            "count": 0,
            "providers_requested": [str(item) for item in requested],
            "providers_used": [],
            "provider_trace": provider_trace,
            "errors": errors,
            "engine": provider_engine(requested),
            "provider_codes": provider_codes,
            "error_code": "strict_provider_rejected",
            "error": "strict_provider forbids fallback",
            "strict_provider": True,
        }

    seen_urls: set[str] = set()
    unique_raw: list[dict[str, Any]] = []
    for hit in raw:
        canonical = canonical_search_url(hit.get("url"))
        if canonical in seen_urls:
            continue
        seen_urls.add(canonical)
        unique_raw.append({**hit, "url": canonical})
    ranked = rank_search_hits(unique_raw, allow_hosts=allow_hosts, deny_hosts=deny_hosts)
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
        "provider_trace": provider_trace,
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
            else "default_browser_bridge_required"
            if "default_browser_bridge_required" in provider_codes
            else "default_browser_invalid_response"
            if "default_browser_invalid_response" in provider_codes
            else "strict_provider_rejected"
            if strict_provider
            else "provider_unavailable"
            if any(error.startswith("unsupported provider:") for error in errors)
            else "no_results"
        ),
        "error": "" if results else "no search results",
        "strict_provider": bool(strict_provider),
    }
