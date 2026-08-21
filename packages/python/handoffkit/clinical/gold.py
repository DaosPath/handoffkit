"""Physical gold vault. Deliberation never receives sealed diagnosis metadata."""

from __future__ import annotations

import json
import re
import threading
from typing import Any

from handoffkit.clinical.constants import GOLD_FIELDS
from handoffkit.clinical.errors import ClinicalError


def split_sealed(
    sealed: dict[str, Any] | None,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    source = dict(sealed or {})
    gold: dict[str, Any] = {}
    for key in GOLD_FIELDS:
        if key in source:
            gold[key] = source.pop(key)
    evidence = {"sections": dict(source.pop("sections", {}) or {})}
    return evidence, gold, source


def gold_leak_fields(hay: str, gold: dict[str, Any]) -> list[str]:
    found: list[str] = []
    text = (hay or "").lower()
    for key in GOLD_FIELDS:
        value = gold.get(key)
        if isinstance(value, list):
            for alias in value:
                token = str(alias or "").strip().lower()
                if len(token) >= 3 and re.search(rf"\b{re.escape(token)}\b", text):
                    found.append("aliases")
            continue
        token = str(value or "").strip().lower()
        if len(token) >= 8 and token in text:
            found.append(key)
    pmc = str(gold.get("pmcid") or "")
    if pmc:
        compact = "".join(ch for ch in pmc.lower() if ch.isalnum())
        hay_compact = "".join(ch for ch in text if ch.isalnum())
        if len(compact) >= 8 and compact in hay_compact:
            found.append("pmcid")
    return sorted(set(found))


def assert_no_gold_keys(payload: Any, *, where: str) -> None:
    if isinstance(payload, dict):
        leaked = [key for key in GOLD_FIELDS if key in payload]
        if leaked:
            raise ClinicalError(
                "gold metadata leaked into participant view",
                code="gold_leak_detected",
                details={"fields": leaked, "where": where},
            )


def participant_blob(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False).lower()


class GoldVault:
    """Scorer-only store. Keys never travel with the participant run."""

    def __init__(self) -> None:
        self._items: dict[str, dict[str, Any]] = {}
        self._lock = threading.Lock()

    def seal(self, run_id: str, gold: dict[str, Any]) -> None:
        with self._lock:
            self._items[run_id] = {key: gold[key] for key in GOLD_FIELDS if key in gold}

    def get(self, run_id: str) -> dict[str, Any]:
        with self._lock:
            return dict(self._items.get(run_id) or {})

    def drop(self, run_id: str) -> None:
        with self._lock:
            self._items.pop(run_id, None)
