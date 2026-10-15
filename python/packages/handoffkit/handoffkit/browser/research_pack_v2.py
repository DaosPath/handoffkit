"""ResearchPack v2 helpers: snapshots, claims, contradictions, at-least-once checkpoints."""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from handoffkit.browser.core import PageSnapshot, ResearchClaim

CONTRACT_VERSION = "1.20.0-alpha.1"


def sha256_utf8(text: str) -> str:
    return hashlib.sha256(str(text or "").encode("utf-8")).hexdigest()


def snapshots_from_pages(pages: list[Any], **extras: Any) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for index, page in enumerate(pages or []):
        markdown = (
            getattr(page, "markdown", None)
            or (page.get("markdown") if isinstance(page, dict) else "")
            or ""
        )
        url = (
            getattr(page, "final_url", None)
            or getattr(page, "url", None)
            or (page.get("final_url") if isinstance(page, dict) else "")
            or (page.get("url") if isinstance(page, dict) else "")
            or ""
        )
        title = (
            getattr(page, "title", None)
            or (page.get("title") if isinstance(page, dict) else "")
            or ""
        )
        page_url = (
            getattr(page, "url", None) or (page.get("url") if isinstance(page, dict) else "") or url
        )
        out.append(
            PageSnapshot.from_wire(
                {
                    "snapshot_id": sha256_utf8(str(url) + str(markdown))[:16],
                    "request_id": extras.get("request_id") or "",
                    "session_id": extras.get("session_id") or "",
                    "url": page_url,
                    "final_url": url,
                    "fetched_at": extras.get("fetched_at")
                    or datetime.now(timezone.utc).isoformat(),
                    "sha256": sha256_utf8(str(markdown)),
                    "content_type": "text/markdown",
                    "title": title,
                    "markdown": markdown,
                    "provenance": {
                        "product": extras.get("product") or "lite",
                        "source": extras.get("source") or "research",
                    },
                }
            ).to_wire()
        )
        _ = index
    return out


def not_found_claim(query: str) -> dict[str, Any]:
    return ResearchClaim.from_wire(
        {"claim_id": "not-found", "statement": query or "requested fact", "status": "not_found"}
    ).to_wire()


def detect_contradictions(claims: list[dict[str, Any]]) -> list[dict[str, Any]]:
    supported = [
        item for item in (claims or []) if item.get("status") == "supported" and item.get("quote")
    ]
    out: list[dict[str, Any]] = []
    for i, a in enumerate(supported):
        for b in supported[i + 1 :]:
            a_not = bool(re.search(r"\b(not|no|never)\b", str(a.get("quote") or ""), re.I))
            b_not = bool(re.search(r"\b(not|no|never)\b", str(b.get("quote") or ""), re.I))
            if a.get("source_url") != b.get("source_url") and a_not != b_not:
                overlap = [
                    word
                    for word in str(a.get("statement") or "").lower().split()
                    if len(word) > 4 and word in str(b.get("statement") or "").lower()
                ]
                if len(overlap) >= 2:
                    out.append(
                        {
                            "claim_ids": [a.get("claim_id"), b.get("claim_id")],
                            "urls": [a.get("source_url"), b.get("source_url")],
                            "reason": "conflicting_quotes",
                        }
                    )
    return out


def finalize_research_pack_v2(pack: Any) -> Any:
    pack.pack_version = 2
    if not getattr(pack, "selected_urls", None):
        pack.selected_urls = list(getattr(pack, "urls_fetched", []) or [])
    if not getattr(pack, "snapshots", None) and getattr(pack, "pages", None):
        pack.snapshots = snapshots_from_pages(pack.pages, product="lite", source="research")
    pack.snapshots = getattr(pack, "snapshots", None) or []
    pack.claims = getattr(pack, "claims", None) or []
    if not pack.claims and not getattr(pack, "pages", None):
        queries = getattr(pack, "queries", None) or []
        pack.claims = [not_found_claim(queries[0] if queries else "")]
    pack.contradictions = getattr(pack, "contradictions", None) or detect_contradictions(
        pack.claims
    )
    pack.idempotency_key = (
        getattr(pack, "idempotency_key", "") or getattr(pack, "checkpoint_id", "") or ""
    )
    return pack


def write_research_checkpoint(
    root: str | Path, pack: Any, *, idempotency_key: str = "default"
) -> dict[str, Any]:
    directory = Path(root)
    directory.mkdir(parents=True, exist_ok=True)
    key = re.sub(r"[^a-zA-Z0-9._-]+", "_", idempotency_key or "default")
    path = directory / f"{key}.json"
    payload = {
        "contract_version": CONTRACT_VERSION,
        "delivery": "at_least_once",
        "idempotency_key": idempotency_key,
        "pack": pack.to_dict() if hasattr(pack, "to_dict") else pack,
        "written_at": datetime.now(timezone.utc).isoformat(),
    }
    path.write_text(json.dumps(payload), encoding="utf-8")
    return {"file": str(path), "delivery": "at_least_once"}


def read_research_checkpoint(root: str | Path, idempotency_key: str) -> dict[str, Any]:
    key = re.sub(r"[^a-zA-Z0-9._-]+", "_", idempotency_key or "default")
    return json.loads((Path(root) / f"{key}.json").read_text(encoding="utf-8"))
