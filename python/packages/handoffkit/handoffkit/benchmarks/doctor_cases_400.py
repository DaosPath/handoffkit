"""Loader for doctor_cases_400 benchmark fixtures.

Not bundled in the wheel: loaded from a source checkout, the local cache, or
downloaded once from a pinned, SHA-256-verified URL (see ``_remote_cases``).
"""

from __future__ import annotations

from functools import lru_cache
from typing import Any

from handoffkit.benchmarks._remote_cases import load_case_set


@lru_cache(maxsize=1)
def load_doctor_cases_400() -> list[dict[str, Any]]:
    """Load the 400-case doctor benchmark set (may download on first use)."""
    return load_case_set("doctor_cases_400.json")


def __getattr__(name: str) -> Any:
    # Back-compat: DOCTOR_CASES_400 is resolved lazily so importing never downloads.
    if name == "DOCTOR_CASES_400":
        return load_doctor_cases_400()
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
