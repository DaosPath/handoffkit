"""Curated source catalog for Browser 1.20.

Not a search engine: the user curates pages (docs, bookmarks, history)
with categories and weights, and retrieval prefers higher weights.
Backed by sources.json next to a ProjectWebIndex root.

Snake_case wire format mirrors the JavaScript implementation exactly.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SOURCE_CATALOG_FORMAT = "handoffkit.browser.source_catalog"
SOURCE_CATALOG_VERSION = 1


def _clean_url(value: Any) -> str:
    return str(value or "").strip()


def _clean_weight(value: Any) -> float:
    try:
        weight = float(value if value is not None else 1)
    except (TypeError, ValueError):
        return 1.0
    if weight != weight or weight < 0:  # NaN or negative
        return 1.0
    return weight


class SourceCatalog:
    def __init__(self, root: str | Path | None = None) -> None:
        self.root = Path(root) if root else None
        self.sources: list[dict[str, Any]] = []

    @property
    def file(self) -> Path:
        assert self.root is not None
        return self.root / "sources.json"

    def load(self) -> SourceCatalog:
        try:
            data = json.loads(self.file.read_text(encoding="utf-8"))
            items = data.get("sources") if isinstance(data, dict) else None
            self.sources = [
                s
                for s in (items or [])
                if isinstance(s, dict) and isinstance(s.get("url"), str)
            ]
        except (OSError, ValueError):
            self.sources = []
        return self

    def save(self) -> SourceCatalog:
        if self.root is None:
            raise ValueError("source catalog requires a root")
        self.root.mkdir(parents=True, exist_ok=True)
        self.file.write_text(
            json.dumps(
                {
                    "format": SOURCE_CATALOG_FORMAT,
                    "format_version": SOURCE_CATALOG_VERSION,
                    "sources": self.sources,
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        return self

    def list(self, category: str = "") -> list[dict[str, Any]]:
        wanted = str(category or "").strip().lower()
        return [
            dict(source)
            for source in self.sources
            if not wanted or str(source.get("category") or "").lower() == wanted
        ]

    def add(self, source: dict[str, Any]) -> dict[str, Any]:
        url = _clean_url((source or {}).get("url"))
        if not url.lower().startswith(("http://", "https://")):
            raise ValueError("catalog url must be http(s)")
        existing = next((s for s in self.sources if s.get("url") == url), None)
        record = {
            "url": url,
            "category": str((source or {}).get("category") or "").strip().lower(),
            "weight": _clean_weight((source or {}).get("weight", 1)),
            "title": str((source or {}).get("title") or ""),
            "notes": str((source or {}).get("notes") or ""),
            "added_at": (existing or {}).get("added_at")
            or datetime.now(timezone.utc).isoformat(),
        }
        if existing is not None:
            existing.update(record)
        else:
            self.sources.append(record)
        self.save()
        return dict(record)

    def remove(self, url: str) -> bool:
        clean = _clean_url(url)
        before = len(self.sources)
        self.sources = [s for s in self.sources if s.get("url") != clean]
        if len(self.sources) != before:
            self.save()
            return True
        return False

    def set_weight(self, url: str, weight: float) -> bool:
        clean = _clean_url(url)
        for source in self.sources:
            if source.get("url") == clean:
                source["weight"] = _clean_weight(weight)
                self.save()
                return True
        return False

    def search(
        self,
        index: Any,
        query: str,
        *,
        category: str = "",
        min_weight: float = 0,
        max_results: int = 8,
    ) -> dict[str, Any]:
        """Weighted retrieval: weight dominates, BM25 score tie-breaks."""
        wanted = str(category or "").strip().lower()
        eligible = [
            s
            for s in self.sources
            if float(s.get("weight", 1)) > 0
            and float(s.get("weight", 1)) >= min_weight
            and (not wanted or str(s.get("category") or "").lower() == wanted)
        ]
        if not eligible:
            return {"hits": [], "results": [], "error_code": "catalog_empty"}
        by_url = {s["url"]: s for s in eligible}
        found = index.search(query, max_results=max(len(eligible) * 2, 8))
        hits: list[dict[str, Any]] = []
        for hit in found.get("hits") or found.get("results") or []:
            source = by_url.get(hit.get("url"))
            if source is None:
                continue
            hits.append(
                {
                    "title": hit.get("title") or hit.get("url"),
                    "url": hit.get("url"),
                    "score": float(hit.get("score") or 0) * float(source.get("weight", 1)),
                    "weight": source.get("weight", 1),
                    "category": source.get("category", ""),
                    "sha256": hit.get("sha256") or "",
                }
            )
        hits.sort(key=lambda h: (h["weight"], h["score"]), reverse=True)
        hits.sort(key=lambda h: (h["weight"], h["score"]), reverse=True)
        sliced = hits[: max(1, int(max_results))]
        return {"hits": sliced, "results": sliced}

    def ingest_all(
        self,
        *,
        index: Any,
        fetch_markdown: Any = None,
        transport: Any = None,
        timeout_ms: int = 20000,
    ) -> list[dict[str, Any]]:
        if not callable(fetch_markdown):
            raise ValueError("ingest_all requires fetch_markdown")
        results: list[dict[str, Any]] = []
        for source in self.sources:
            try:
                page = fetch_markdown(source["url"], transport=transport, timeout_ms=timeout_ms)
                page = page if isinstance(page, dict) else {}
                outcome = index.ingest(
                    {
                        "url": source["url"],
                        "title": source.get("title") or page.get("title") or source["url"],
                        "markdown": page.get("markdown") or "",
                    }
                )
                results.append(
                    {
                        "url": source["url"],
                        "ok": bool(outcome.get("ok")),
                        "error_code": outcome.get("error_code", ""),
                    }
                )
            except Exception as exc:  # noqa: BLE001 - per-source failure is recorded
                results.append(
                    {
                        "url": source["url"],
                        "ok": False,
                        "error_code": "ingest_failed",
                        "error": str(exc),
                    }
                )
        return results


def create_source_catalog(root: str | Path | None = None) -> SourceCatalog:
    return SourceCatalog(root)
