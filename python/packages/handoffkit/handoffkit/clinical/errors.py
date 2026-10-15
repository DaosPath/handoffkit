"""Structured clinical errors."""

from __future__ import annotations

from typing import Any

from handoffkit.clinical.constants import ERROR_CODES


class ClinicalError(Exception):
    def __init__(
        self,
        message: str,
        *,
        code: str = "invalid_request",
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        if code not in ERROR_CODES:
            code = "invalid_request"
        self.code = code
        self.details = dict(details or {})

    def to_wire(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "message": str(self),
            "details": dict(self.details),
        }

    to_dict = to_wire
