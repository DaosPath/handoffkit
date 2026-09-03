"""Reject personal identifiers and free-text personal clinical input.

This is a predefined-case sandbox guard, not a perfect PHI detector.
Rejected text is never returned in errors, logs, or events.
"""

from __future__ import annotations

import re
from typing import Any

from handoffkit.clinical.constants import (
    ALLOWED_ACT_KEYS,
    ALLOWED_CREATE_KEYS,
    MAX_USER_TEXT,
)
from handoffkit.clinical.errors import ClinicalError

EMAIL_RE = re.compile(r"[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}", re.I)
PHONE_RE = re.compile(r"(?:\+?\d{1,3}[\s.\-]*)?(?:\(?\d{3}\)?[\s.\-]*)\d{3}[\s.\-]*\d{4}")
SSN_RE = re.compile(r"\b\d{3}-\d{2}-\d{4}\b")
MRN_RE = re.compile(r"\b(mrn|niss|curp|dni|ssn)[:#\s]+\w+", re.I)
ADDRESS_RE = re.compile(
    r"\b\d{1,5}\s+[A-Za-z0-9.'\-]+\s+(street|st|avenue|ave|road|rd|"
    r"boulevard|blvd|lane|ln|drive|dr|calle|avenida)\b",
    re.I,
)
NAME_RE = re.compile(
    r"\b(my name is|i am named|mi nombre es|i am)\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+"
    r"(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)?\b",
    re.I,
)
SYMPTOM_RE = re.compile(
    r"("
    r"\bi have\b.{0,60}\b(pain|fever|cough|symptoms?|chest|headache|nausea|chills)\b"
    r"|i['’]m having\b.{0,40}\b(pain|fever|cough|symptoms?)"
    r"|i am experiencing\b"
    r"|me duele\b"
    r"|tengo (dolor|fiebre|tos|sintomas|síntomas)\b"
    r"|my (chest|head|stomach|throat|back) hurts\b"
    r"|my symptoms\b"
    r"|personal (symptom|history|information)\b"
    r")",
    re.I,
)
BLOCKED_FIELDS = {
    "symptoms",
    "personal_input",
    "phi",
    "patient_name",
    "full_name",
    "email",
    "phone",
    "address",
    "ssn",
    "dob",
    "mrn",
    "passport",
    "date_of_birth",
}


def _reject() -> None:
    raise ClinicalError(
        "personal or free-text clinical input is not accepted",
        code="personal_input_rejected",
    )


def looks_personal(text: str) -> bool:
    value = str(text or "")
    if not value.strip():
        return False
    if len(value) > MAX_USER_TEXT:
        return True
    if EMAIL_RE.search(value):
        return True
    if PHONE_RE.search(value):
        return True
    if SSN_RE.search(value) or MRN_RE.search(value):
        return True
    if ADDRESS_RE.search(value):
        return True
    if NAME_RE.search(value):
        return True
    if SYMPTOM_RE.search(value):
        return True
    return False


def _walk(value: Any) -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            if str(key).lower() in BLOCKED_FIELDS and item not in (None, False, "", 0):
                _reject()
            _walk(item)
        return
    if isinstance(value, list):
        for item in value:
            _walk(item)
        return
    if isinstance(value, str) and looks_personal(value):
        _reject()


def reject_personal_payload(body: dict[str, Any], *, allowed: frozenset[str]) -> dict[str, Any]:
    if not isinstance(body, dict):
        _reject()
    extra = set(body) - set(allowed)
    if extra:
        lowered = {str(key).lower() for key in extra}
        if lowered & BLOCKED_FIELDS:
            _reject()
        raise ClinicalError("unsupported request field", code="invalid_request")
    for key, value in body.items():
        if str(key).lower() in BLOCKED_FIELDS and value not in (None, False, "", 0):
            _reject()
        if isinstance(value, str) and len(value) > MAX_USER_TEXT:
            _reject()
        _walk(value)
    return body


def reject_create_payload(body: dict[str, Any]) -> dict[str, Any]:
    return reject_personal_payload(body, allowed=ALLOWED_CREATE_KEYS)


def reject_act_payload(body: dict[str, Any]) -> dict[str, Any]:
    return reject_personal_payload(body, allowed=ALLOWED_ACT_KEYS)
