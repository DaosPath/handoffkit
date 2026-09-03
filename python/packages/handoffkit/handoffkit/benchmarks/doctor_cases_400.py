"""Loader for doctor_cases_400 benchmark fixtures (data in JSON, not embedded in .py)."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

_DATA = Path(__file__).resolve().parent / "data" / "doctor_cases_400.json"


@lru_cache(maxsize=1)
def load_doctor_cases_400() -> list[dict[str, Any]]:
    """Load offline doctor-benchmark cases from packaged JSON."""
    return json.loads(_DATA.read_text(encoding="utf-8"))


# Back-compat alias used by doctor.py / cases.py
DOCTOR_CASES_400 = load_doctor_cases_400()
