"""Versioned resource units. USD is opt-in and labeled simulated."""

from __future__ import annotations

from typing import Any

from handoffkit.clinical.constants import RESOURCE_UNITS_V1, VAGUE_MARKERS
from handoffkit.clinical.models import ClinicalAction


def is_vague(query: str) -> bool:
    text = query.lower()
    return any(marker in text for marker in VAGUE_MARKERS)


def units_for(action: ClinicalAction, section: str = "") -> int:
    if is_vague(f"{action.name} {action.query}"):
        return 0
    if section in RESOURCE_UNITS_V1:
        return int(RESOURCE_UNITS_V1[section])
    return int(RESOURCE_UNITS_V1.get(action.name, 1))


def usd_profile(units: int, *, enabled: bool = False) -> dict[str, Any] | None:
    if not enabled:
        return None
    return {
        "simulated": True,
        "disclaimer": "Simulated USD profile only. Not a clinical charge.",
        "units": units,
        "usd_per_unit": 12.5,
        "usd": round(units * 12.5, 2),
    }
