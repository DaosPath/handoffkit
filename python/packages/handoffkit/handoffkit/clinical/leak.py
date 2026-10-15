"""Gold-leak auditor against the scorer vault, never against participant gold."""

from __future__ import annotations

from typing import Any


def collect_preclose_text(run: Any) -> str:
    chunks = [getattr(run, "opening", "")]
    for action in getattr(run, "actions", []):
        if getattr(action, "name", "") == "submit_diagnosis":
            continue
        chunks.append(getattr(action, "query", ""))
    for obs in getattr(run, "observations", []):
        chunks.append(getattr(obs, "content", ""))
        chunks.append(getattr(obs, "source_fragment", ""))
    return "\n".join(str(item) for item in chunks).lower()
