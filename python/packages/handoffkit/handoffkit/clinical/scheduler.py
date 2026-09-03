"""Durable 897-case scheduler. Never claims exactly-once delivery."""

from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path
from typing import Any

from handoffkit.clinical.constants import OFFICIAL_CASE_COUNT
from handoffkit.clinical.errors import ClinicalError
from handoffkit.clinical.scoring import require_official_complete

STATUSES = ("pending", "inflight", "complete", "failed")


class BenchmarkScheduler:
    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(self.path)
        self._conn.execute(
            "CREATE TABLE IF NOT EXISTS cases ("
            "blind_id TEXT PRIMARY KEY, "
            "idx INTEGER NOT NULL, "
            "track TEXT NOT NULL, "
            "status TEXT NOT NULL, "
            "attempts INTEGER NOT NULL DEFAULT 0, "
            "lease_until REAL, "
            "payload TEXT NOT NULL)"
        )
        self._conn.execute(
            "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
        )
        self._conn.commit()

    def seed(self, cases: list[dict[str, Any]], *, track: str, corpus_revision: str = "") -> None:
        if len(cases) != OFFICIAL_CASE_COUNT:
            raise ClinicalError(
                f"scheduler requires exactly {OFFICIAL_CASE_COUNT} cases",
                code="run_incomplete",
                details={"count": len(cases)},
            )
        existing = self._conn.execute("SELECT COUNT(*) FROM cases").fetchone()[0]
        if existing:
            stored_track = self._meta("track")
            stored_revision = self._meta("corpus_revision")
            if stored_track and stored_track != track:
                raise ClinicalError(
                    "scheduler track is incompatible with the stored corpus",
                    code="invalid_request",
                    details={"stored_track": stored_track, "track": track},
                )
            if stored_revision and corpus_revision and stored_revision != corpus_revision:
                raise ClinicalError(
                    "scheduler corpus revision is incompatible",
                    code="invalid_request",
                )
            return
        for index, case in enumerate(cases, start=1):
            self._conn.execute(
                "INSERT INTO cases(blind_id, idx, track, status, attempts, payload) "
                "VALUES (?,?,?,?,?,?)",
                (
                    case["blind_id"],
                    index,
                    track,
                    "pending",
                    0,
                    json.dumps(case, ensure_ascii=False),
                ),
            )
        self._set_meta("track", track)
        if corpus_revision:
            self._set_meta("corpus_revision", corpus_revision)
        self._conn.commit()

    def _meta(self, key: str) -> str:
        row = self._conn.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
        return str(row[0]) if row else ""

    def _set_meta(self, key: str, value: str) -> None:
        self._conn.execute("INSERT OR REPLACE INTO meta(key, value) VALUES (?,?)", (key, value))

    def pending(self) -> list[dict[str, Any]]:
        rows = self._conn.execute(
            "SELECT payload FROM cases WHERE status IN ('pending', 'failed') ORDER BY idx"
        ).fetchall()
        return [json.loads(row[0]) for row in rows]

    def claim(self, blind_id: str, *, lease_seconds: float = 30.0) -> dict[str, Any]:
        row = self._conn.execute(
            "SELECT payload, status, attempts FROM cases WHERE blind_id=?",
            (blind_id,),
        ).fetchone()
        if not row:
            raise ClinicalError("checkpoint does not exist", code="checkpoint_missing")
        self._conn.execute(
            "UPDATE cases SET status=?, attempts=attempts+1, lease_until=? WHERE blind_id=?",
            ("inflight", time.time() + lease_seconds, blind_id),
        )
        self._conn.commit()
        payload = json.loads(row[0])
        payload["status"] = "inflight"
        return payload

    def checkpoint(self, blind_id: str, result: dict[str, Any]) -> None:
        row = self._conn.execute("SELECT 1 FROM cases WHERE blind_id=?", (blind_id,)).fetchone()
        if not row:
            raise ClinicalError("checkpoint does not exist", code="checkpoint_missing")
        status = str(result.get("status") or "incomplete")
        if status not in STATUSES:
            status = "failed" if status != "complete" else status
            if status not in STATUSES:
                status = "failed"
        self._conn.execute(
            "UPDATE cases SET status=?, payload=?, lease_until=NULL WHERE blind_id=?",
            (status, json.dumps(result, ensure_ascii=False), blind_id),
        )
        self._conn.commit()

    def results(self) -> list[dict[str, Any]]:
        rows = self._conn.execute("SELECT payload FROM cases ORDER BY idx").fetchall()
        return [json.loads(row[0]) for row in rows]

    def complete_or_raise(self) -> list[dict[str, Any]]:
        results = self.results()
        require_official_complete(results, expected=OFFICIAL_CASE_COUNT)
        return results
