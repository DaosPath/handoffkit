"""Consolidated clinical cases database for doctor validation/benchmarks."""

from typing import Any

from handoffkit.benchmarks.doctor_cases_30 import DOCTOR_CASES_30

__all__ = [
    "DOCTOR_CASES_30",
    "DOCTOR_CASES_100",  # noqa: F822 - resolved lazily by __getattr__
    "DOCTOR_CASES_400",  # noqa: F822 - resolved lazily by __getattr__
]


def __getattr__(name: str) -> Any:
    # The 100/400 sets are not bundled in the wheel; resolve them lazily.
    if name == "DOCTOR_CASES_100":
        from handoffkit.benchmarks.doctor_cases_100 import load_doctor_cases_100

        return load_doctor_cases_100()
    if name == "DOCTOR_CASES_400":
        from handoffkit.benchmarks.doctor_cases_400 import load_doctor_cases_400

        return load_doctor_cases_400()
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
