"""Opt-in workspace web index. Never a complete index of the Internet."""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from pathlib import Path
from typing import Any

SCHEMA_VERSION = 1
DISCLAIMER = (
    "project_index is an opt-in workspace document index, not a complete index of the Internet."
)


def sha256_text(text: str) -> str:
    return hashlib.sha256(str(text or "").encode("utf-8")).hexdigest()


def _tokens(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]{2,}", (text or "").lower())


class ProjectWebIndex:
    def __init__(
        self,
        *,
        root: str | Path | None = None,
        enabled: bool = False,
        max_documents: int = 5000,
        max_bytes: int = 50 * 1024 * 1024,
        allow_hosts: list[str] | None = None,
    ) -> None:
        self.root = Path(root) if root else None
        self.enabled = bool(enabled)
        self.max_documents = int(max_documents)
        self.max_bytes = int(max_bytes)
        self.allow_hosts = [str(item).lower() for item in (allow_hosts or [])]
        self.backend = "unavailable"
        self._conn: sqlite3.Connection | None = None

    @staticmethod
    def disclaimer() -> str:
        return DISCLAIMER

    def open(self) -> ProjectWebIndex:
        if not self.enabled:
            self.backend = "unavailable"
            return self
        if self.root is None:
            raise ValueError("project_index requires an explicit workspace root")
        self.root.mkdir(parents=True, exist_ok=True)
        db_path = self.root / "project-index.sqlite"
        self._conn = sqlite3.connect(db_path)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute(
            "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
        )
        self._conn.execute(
            """CREATE TABLE IF NOT EXISTS documents (
                document_id TEXT PRIMARY KEY,
                sha256 TEXT NOT NULL UNIQUE,
                url TEXT,
                final_url TEXT,
                title TEXT,
                host TEXT,
                fetched_at TEXT,
                indexed_at TEXT,
                bytes INTEGER,
                content_type TEXT,
                markdown TEXT,
                provenance TEXT,
                quarantined INTEGER DEFAULT 0
            )"""
        )
        try:
            self._conn.execute(
                "CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(title, markdown, url)"
            )
            self.backend = "fts5"
        except sqlite3.OperationalError:
            self.backend = "sqlite"
        self._conn.execute(
            "INSERT OR IGNORE INTO meta(key, value) VALUES ('schema_version', ?)",
            (str(SCHEMA_VERSION),),
        )
        self._conn.commit()
        return self

    def ingest(self, record: dict[str, Any]) -> dict[str, Any]:
        if not self.enabled or self._conn is None:
            return {"ok": False, "error_code": "index_unavailable"}
        markdown = str(record.get("markdown") or "")
        digest = str(record.get("sha256") or sha256_text(markdown)).lower()
        host = str(record.get("host") or "").lower()
        if self.allow_hosts and host and host not in self.allow_hosts:
            return {"ok": False, "error_code": "policy_denied"}
        count = self._conn.execute("SELECT COUNT(*) FROM documents").fetchone()[0]
        used = self._conn.execute("SELECT COALESCE(SUM(bytes), 0) FROM documents").fetchone()[0]
        payload = markdown.encode("utf-8")
        if count >= self.max_documents or used + len(payload) > self.max_bytes:
            return {"ok": False, "error_code": "policy_denied"}
        doc_id = str(record.get("document_id") or digest[:16])
        self._conn.execute(
            """INSERT OR REPLACE INTO documents
            (document_id, sha256, url, final_url, title, host, fetched_at, indexed_at,
             bytes, content_type, markdown, provenance, quarantined)
            VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?, 0)""",
            (
                doc_id,
                digest,
                record.get("url") or "",
                record.get("final_url") or record.get("url") or "",
                record.get("title") or "",
                host,
                record.get("fetched_at") or "",
                len(payload),
                record.get("content_type") or "text/markdown",
                markdown,
                json.dumps(
                    record.get("provenance") or {"product": "lite", "source": "project_index"}
                ),
            ),
        )
        if self.backend == "fts5":
            self._conn.execute(
                "INSERT INTO documents_fts(title, markdown, url) VALUES (?, ?, ?)",
                (record.get("title") or "", markdown, record.get("url") or ""),
            )
        self._conn.commit()
        return {"ok": True, "sha256": digest, "backend": self.backend}

    def search(self, query: str, *, max_results: int = 8, timeout_ms: int = 0) -> dict[str, Any]:
        _ = timeout_ms
        if not self.enabled or self._conn is None:
            return {
                "hits": [],
                "results": [],
                "error_code": "index_unavailable",
                "error": DISCLAIMER,
            }
        query_tokens = _tokens(query)
        rows = self._conn.execute(
            "SELECT title, url, final_url, markdown, sha256 FROM documents WHERE quarantined = 0"
        ).fetchall()
        ranked: list[dict[str, Any]] = []
        for row in rows:
            hay = f"{row['title']} {row['markdown']} {row['url']}".lower()
            score = sum(1 for token in query_tokens if token in hay)
            if score:
                ranked.append(
                    {
                        "title": row["title"] or row["url"],
                        "url": row["final_url"] or row["url"],
                        "score": score,
                        "sha256": row["sha256"],
                    }
                )
        ranked.sort(key=lambda item: int(item["score"]), reverse=True)
        hits = ranked[: max(1, int(max_results))]
        return {"hits": hits, "results": hits, "backend": self.backend, "disclaimer": DISCLAIMER}

    def integrity_check(self) -> dict[str, Any]:
        if self._conn is None:
            return {"ok": False, "error_code": "index_unavailable"}
        bad: list[str] = []
        for row in self._conn.execute("SELECT document_id, sha256, markdown FROM documents"):
            if sha256_text(row["markdown"]) != row["sha256"]:
                bad.append(row["document_id"])
                self._conn.execute(
                    "UPDATE documents SET quarantined = 1 WHERE document_id = ?",
                    (row["document_id"],),
                )
        self._conn.commit()
        return {"ok": not bad, "quarantined": bad, "backend": self.backend}

    def close(self) -> None:
        if self._conn is not None:
            self._conn.close()
            self._conn = None
