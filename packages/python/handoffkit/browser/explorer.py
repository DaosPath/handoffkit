"""BFS web explorer."""

from __future__ import annotations

from collections import deque
from typing import Any

from handoffkit.browser.cache import BrowserCache
from handoffkit.browser.html_extract import extract_page
from handoffkit.browser.transport import HttpTransport, WebTransport, default_transport
from handoffkit.browser.types import (
    ExplorePolicy,
    ExploreResult,
    ExploreStep,
    ExtractedLink,
    normalize_host,
    parse_url,
    url_allowed,
)
from handoffkit.browser.util import detect_soft_block, smart_truncate


def explore_url(
    start_url: str,
    *,
    policy: ExplorePolicy | dict[str, Any] | None = None,
    transport: WebTransport | None = None,
    cache: BrowserCache | None = None,
) -> ExploreResult:
    pol = policy if isinstance(policy, ExplorePolicy) else ExplorePolicy.from_dict(policy)
    tr = transport or default_transport(True)
    start = (start_url or "").strip()
    result = ExploreResult(start_url=start, policy=pol)
    if not start:
        result.error = "start_url required"
        return result

    origin = normalize_host(parse_url(start)["host"])
    if not origin:
        result.error = "invalid start_url"
        return result

    visited: set[str] = set()
    queue: deque[tuple[str, int]] = deque([(start, 0)])
    steps: list[ExploreStep] = []
    all_links: list[ExtractedLink] = []
    max_depth = 0
    pages = 0

    while queue and pages < pol.max_pages:
        url, depth = queue.popleft()
        if url in visited:
            continue
        visited.add(url)
        if not url_allowed(url, pol, origin):
            continue

        step = ExploreStep(step_index=len(steps), depth=depth, url=url)
        headers = {"User-Agent": pol.user_agent, **pol.extra_headers}

        cached = cache.get(url) if cache else None
        if cached and cached.get("body"):
            body = str(cached.get("body") or "")
            status = int(cached.get("status") or 200)
            final_url = str(cached.get("final_url") or url)
            content_type = str(cached.get("content_type") or "text/html")
            err = ""
        else:
            resp = tr.get(
                url,
                timeout_ms=pol.timeout_ms,
                headers=headers,
                max_body_bytes=pol.max_body_bytes,
            )
            body = resp.body
            status = resp.status
            final_url = resp.final_url or url
            content_type = resp.content_type
            err = resp.error
            if cache and not err and body:
                cache.set(
                    url,
                    {
                        "body": body,
                        "status": status,
                        "final_url": final_url,
                        "content_type": content_type,
                    },
                )

        step.status = status
        step.final_url = final_url
        step.raw_body_bytes = len(body.encode("utf-8", errors="replace"))
        block = detect_soft_block(body, status)
        if err or not (200 <= status < 400) or block["blocked"]:
            step.success = False
            step.error = err or (block["reason"] if block["blocked"] else f"HTTP {status}")
            steps.append(step)
            pages += 1
            continue

        extracted = extract_page(
            body,
            base_url=final_url,
            max_text_chars=pol.max_text_chars,
            max_markdown_chars=pol.max_markdown_chars,
            max_links=pol.max_links_per_page,
            strip_scripts_styles=pol.strip_scripts_styles,
            emit_markdown=pol.emit_markdown,
        )
        step.success = True
        step.title = extracted["title"] if pol.extract_title else ""
        step.text = extracted["text"] if pol.extract_text else ""
        step.markdown = smart_truncate(extracted["markdown"], pol.max_markdown_chars) if pol.emit_markdown else ""
        links: list[ExtractedLink] = extracted["links"] if pol.extract_links else []
        blocked: list[str] = []
        kept: list[ExtractedLink] = []
        for link in links:
            if url_allowed(link.absolute, pol, origin):
                kept.append(link)
            else:
                blocked.append(link.absolute)
        step.links = kept
        step.blocked_links = blocked
        all_links.extend(kept)
        steps.append(step)
        pages += 1
        max_depth = max(max_depth, depth)

        if depth < pol.max_depth:
            for link in kept:
                if link.absolute not in visited:
                    queue.append((link.absolute, depth + 1))

    result.steps = steps
    result.pages_fetched = pages
    result.max_depth_reached = max_depth
    if steps:
        first_ok = next((s for s in steps if s.success), steps[0])
        result.title = first_ok.title
        result.text = first_ok.text
        result.markdown = first_ok.markdown
        result.final_url = first_ok.final_url or start
        result.success = any(s.success for s in steps)
        if not result.success:
            result.error = first_ok.error or "explore failed"
    else:
        result.error = "no pages fetched"
    # unique links
    seen: set[str] = set()
    uniq: list[ExtractedLink] = []
    for link in all_links:
        if link.absolute in seen:
            continue
        seen.add(link.absolute)
        uniq.append(link)
    result.links = uniq
    result.metadata = {
        "transport": getattr(tr, "name", lambda: "unknown")(),
        "origin_host": origin,
    }
    return result


def fetch_markdown(
    url: str,
    *,
    policy: ExplorePolicy | dict[str, Any] | None = None,
    transport: WebTransport | None = None,
    cache: BrowserCache | None = None,
) -> ExploreResult:
    pol = policy if isinstance(policy, ExplorePolicy) else ExplorePolicy.from_dict(policy)
    pol = ExplorePolicy.from_dict({**pol.to_dict(), "max_depth": 0, "max_pages": 1})
    return explore_url(url, policy=pol, transport=transport, cache=cache)
