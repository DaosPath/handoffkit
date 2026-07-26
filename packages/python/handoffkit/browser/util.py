"""Shared browser helpers."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Callable, TypeVar

T = TypeVar("T")
R = TypeVar("R")


def detect_soft_block(body: str = "", status: int = 0) -> dict[str, Any]:
    text = (body or "")[:8000].lower()
    markers = (
        "cf-browser-verification",
        "just a moment",
        "attention required",
        "cloudflare",
        "access denied",
        "captcha",
        "enable javascript",
        "checking your browser",
    )
    if status in {403, 429, 503}:
        if any(m in text for m in markers):
            return {"blocked": True, "reason": f"soft_block_status_{status}"}
        if status in {403, 429}:
            return {"blocked": True, "reason": f"http_{status}"}
    if "cf-browser-verification" in text or "checking your browser" in text:
        return {"blocked": True, "reason": "challenge_page"}
    if "captcha" in text and "cloudflare" in text:
        return {"blocked": True, "reason": "challenge_page"}
    return {"blocked": False, "reason": ""}


def smart_truncate(markdown: str, max_chars: int = 60000) -> str:
    md = markdown or ""
    if not max_chars or len(md) <= max_chars:
        return md
    cut = md[:max_chars]
    last_heading = max(cut.rfind("\n## "), cut.rfind("\n# "))
    last_para = cut.rfind("\n\n")
    end = max_chars
    if last_heading > max_chars * 0.5:
        end = last_heading
    elif last_para > max_chars * 0.6:
        end = last_para
    return cut[:end].rstrip() + "\n\n...[truncated]\n"


def map_with_concurrency(
    items: list[T],
    max_parallel: int,
    worker: Callable[[T], R],
) -> list[R]:
    if not items:
        return []
    limit = max(1, min(len(items), int(max_parallel or 1)))
    if limit == 1:
        return [worker(item) for item in items]
    results: list[R | None] = [None] * len(items)
    with ThreadPoolExecutor(max_workers=limit) as pool:
        futures = {pool.submit(worker, item): idx for idx, item in enumerate(items)}
        for fut in as_completed(futures):
            idx = futures[fut]
            results[idx] = fut.result()
    return [r for r in results if r is not None]  # type: ignore[misc]
