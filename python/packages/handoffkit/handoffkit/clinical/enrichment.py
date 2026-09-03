"""Article enrichment: literal quotes only. Never invent tests or results."""

from __future__ import annotations

from hashlib import sha256
from typing import Any

from handoffkit.clinical.errors import ClinicalError


def quote_fragment(document: str, claim: str, *, section: str = "") -> dict[str, Any]:
    source = str(document or "")
    needle = str(claim or "").strip()
    if not needle or needle not in source:
        raise ClinicalError(
            "requested fact is not in the retrieved article",
            code="evidence_not_available",
            details={"section": section},
        )
    start = source.index(needle)
    fragment = source[max(0, start - 40) : start + len(needle) + 40]
    return {
        "section": section,
        "source_fragment": fragment,
        "source_hash": sha256(source.encode("utf-8")).hexdigest(),
        "quote": needle,
        "enrichment_status": "automatically sourced, not clinically validated",
    }
