"""Injectable web transports (map / http / fixture)."""

from __future__ import annotations

import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any, Protocol

from handoffkit.browser.types import DEFAULT_UA


def _retry_after_ms(headers: dict[str, str]) -> int:
    raw = str(headers.get("retry-after") or headers.get("Retry-After") or "").strip()
    if not raw:
        return 0
    if raw.isdigit():
        return max(0, int(raw) * 1000)
    try:
        when = parsedate_to_datetime(raw)
        if when.tzinfo is None:
            when = when.replace(tzinfo=timezone.utc)
        delta = (when - datetime.now(timezone.utc)).total_seconds()
        return max(0, int(delta * 1000))
    except (TypeError, ValueError, OverflowError):
        return 0


@dataclass
class TransportResponse:
    status: int = 0
    final_url: str = ""
    content_type: str = ""
    body: str = ""
    headers: dict[str, str] = field(default_factory=dict)
    error: str = ""
    retry_after_ms: int = 0

    def ok(self) -> bool:
        return not self.error and 200 <= self.status < 400

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "final_url": self.final_url,
            "content_type": self.content_type,
            "body": self.body,
            "headers": dict(self.headers),
            "error": self.error,
            "retry_after_ms": self.retry_after_ms,
        }


class WebTransport(Protocol):
    def name(self) -> str: ...

    def get(
        self,
        url: str,
        timeout_ms: int = 15000,
        headers: dict[str, str] | None = None,
        max_body_bytes: int = 2 * 1024 * 1024,
    ) -> TransportResponse: ...


class MapTransport:
    def __init__(self, pages: dict[str, Any] | None = None) -> None:
        self._pages: dict[str, tuple[str, int, str]] = {}
        self._errors: dict[str, str] = {}
        for url, value in (pages or {}).items():
            if isinstance(value, str):
                self.set_page(url, value)
            else:
                self.set_page(
                    url,
                    value.get("body", ""),
                    int(value.get("status", 200)),
                    value.get("content_type", "text/html; charset=utf-8"),
                )

    def name(self) -> str:
        return "map"

    def set_page(
        self,
        url: str,
        body: str,
        status: int = 200,
        content_type: str = "text/html; charset=utf-8",
    ) -> MapTransport:
        self._pages[url] = (str(body or ""), status, content_type)
        self._errors.pop(url, None)
        return self

    def set_error(self, url: str, error: str) -> MapTransport:
        self._errors[url] = str(error or "transport error")
        self._pages.pop(url, None)
        return self

    def clear(self) -> MapTransport:
        self._pages.clear()
        self._errors.clear()
        return self

    def get(
        self,
        url: str,
        timeout_ms: int = 15000,
        headers: dict[str, str] | None = None,
        max_body_bytes: int = 2 * 1024 * 1024,
    ) -> TransportResponse:
        _ = timeout_ms, headers
        if url in self._errors:
            return TransportResponse(final_url=url, error=self._errors[url])
        page = self._pages.get(url)
        if page is None:
            return TransportResponse(
                status=404,
                final_url=url,
                error=f"map transport: no page for {url}",
            )
        body, status, ctype = page
        if max_body_bytes > 0 and len(body) > max_body_bytes:
            body = body[:max_body_bytes]
        return TransportResponse(
            status=status,
            final_url=url,
            content_type=ctype,
            body=body,
            headers={"content-type": ctype},
        )


class HttpTransport:
    def __init__(self, *, retries: int = 2, base_delay_ms: int = 300) -> None:
        self._retries = max(0, int(retries))
        self._base_delay_ms = max(0, int(base_delay_ms))

    def name(self) -> str:
        return "http"

    def get(
        self,
        url: str,
        timeout_ms: int = 15000,
        headers: dict[str, str] | None = None,
        max_body_bytes: int = 2 * 1024 * 1024,
    ) -> TransportResponse:
        last = TransportResponse(final_url=url, error="no attempt")
        for attempt in range(self._retries + 1):
            last = self._once(url, timeout_ms, headers, max_body_bytes)
            retryable = "timeout" in (last.error or "").lower() or last.status in {
                429,
                502,
                503,
                504,
            }
            if not retryable or attempt >= self._retries:
                return last
            delay = self._base_delay_ms * (2**attempt) / 1000.0
            if last.retry_after_ms > 0:
                delay = max(delay, last.retry_after_ms / 1000.0)
            if delay > 0:
                time.sleep(min(delay, 30.0))
        return last

    def _once(
        self,
        url: str,
        timeout_ms: int,
        headers: dict[str, str] | None,
        max_body_bytes: int,
    ) -> TransportResponse:
        req_headers = {
            "User-Agent": DEFAULT_UA,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        }
        if headers:
            req_headers.update(headers)
        request = urllib.request.Request(url, headers=req_headers, method="GET")
        try:
            with urllib.request.urlopen(request, timeout=max(timeout_ms / 1000.0, 1.0)) as resp:
                raw = resp.read()
                if max_body_bytes > 0 and len(raw) > max_body_bytes:
                    raw = raw[:max_body_bytes]
                charset = resp.headers.get_content_charset() or "utf-8"
                body = raw.decode(charset, errors="replace")
                out_headers = {k.lower(): v for k, v in resp.headers.items()}
                return TransportResponse(
                    status=getattr(resp, "status", 200) or 200,
                    final_url=resp.geturl(),
                    content_type=resp.headers.get("Content-Type", ""),
                    body=body,
                    headers=out_headers,
                    retry_after_ms=_retry_after_ms(out_headers),
                )
        except urllib.error.HTTPError as exc:
            raw = exc.read() if hasattr(exc, "read") else b""
            if max_body_bytes > 0 and len(raw) > max_body_bytes:
                raw = raw[:max_body_bytes]
            body = raw.decode("utf-8", errors="replace") if raw else ""
            err_headers = {k.lower(): v for k, v in (exc.headers.items() if exc.headers else [])}
            return TransportResponse(
                status=int(exc.code),
                final_url=url,
                body=body,
                headers=err_headers,
                error=f"HTTP status {exc.code}",
                retry_after_ms=_retry_after_ms(err_headers),
            )
        except Exception as exc:  # noqa: BLE001
            return TransportResponse(final_url=url, error=str(exc))


def make_transport(kind: str = "http") -> MapTransport | HttpTransport:
    key = str(kind or "http").lower()
    if key in {"map", "stub", "offline"}:
        return MapTransport()
    if key == "fixture":
        return make_fixture_map_transport()
    if key in {"http", "live", "https"}:
        return HttpTransport()
    raise TypeError(f"unknown transport kind: {kind}")


def default_transport(prefer_live: bool = True) -> MapTransport | HttpTransport:
    return HttpTransport() if prefer_live else MapTransport()


def make_fixture_map_transport() -> MapTransport:
    m = MapTransport()
    index = (
        "<!DOCTYPE html><html><head><title>Fixture Home</title></head><body>"
        "<h1>Welcome to Fixture</h1>"
        "<p>Home page for offline web explorer tests. Alpha &amp; beta notes.</p>"
        "<script>secret_should_not_appear();</script>"
        '<a href="/about.html">About Us</a>'
        '<a href="/docs/guide.html">Guide</a>'
        '<a href="https://evil.example/block-me">External Evil</a>'
        "</body></html>"
    )
    about = (
        "<html><head><title>About Fixture</title></head><body>"
        "<p>About page content with more detail.</p>"
        '<a href="/">Home</a><a href="/docs/guide.html">Guide</a>'
        "</body></html>"
    )
    guide = (
        "<html><head><title>Guide</title></head><body>"
        "<h2>User Guide</h2>"
        "<p>Step one: configure ExplorePolicy. Step two: inject WebTransport.</p>"
        '<a href="/">Home</a></body></html>'
    )
    m.set_page("https://fixture.local/", index)
    m.set_page("https://fixture.local/index.html", index)
    m.set_page("https://fixture.local/about.html", about)
    m.set_page("https://fixture.local/docs/guide.html", guide)
    m.set_page("https://fixture.local/missing.html", "", 404)
    m.set_error("https://fixture.local/boom", "simulated transport failure")
    return m
