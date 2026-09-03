"""Role adapters. Declared as scaffold; live providers are unavailable."""

from __future__ import annotations

from handoffkit.clinical.constants import PROVIDER_STATUS, ROLES
from handoffkit.clinical.errors import ClinicalError
from handoffkit.clinical.providers import get_provider

ROLE_STATUS = {
    "hypothesis": {
        "declared": True,
        "adapter": "scaffold",
        "integrated": False,
        "live_tested": False,
        "available": False,
    },
    "test_selector": {
        "declared": True,
        "adapter": "scaffold",
        "integrated": False,
        "live_tested": False,
        "available": False,
    },
    "challenger": {
        "declared": True,
        "adapter": "scaffold",
        "integrated": False,
        "live_tested": False,
        "available": False,
    },
    "finalizer": {
        "declared": True,
        "adapter": "scaffold",
        "integrated": False,
        "live_tested": False,
        "available": False,
    },
    "judge": {
        "declared": True,
        "adapter": "scaffold",
        "integrated": False,
        "live_tested": False,
        "available": False,
    },
}


def execute_role(role: str, prompt: str, *, provider: str = "ollama") -> str:
    key = (role or "").strip().lower()
    if key == "judge" or key in ROLES:
        status = ROLE_STATUS.get("judge" if key == "judge" else key, ROLE_STATUS["hypothesis"])
        if not status.get("available"):
            raise ClinicalError(
                "live role provider is unavailable",
                code="provider_unavailable",
                details={
                    "role": key,
                    "provider": provider,
                    "provider_status": PROVIDER_STATUS.get(provider, {}),
                    **status,
                },
            )
        return get_provider(provider).generate(prompt)
    raise ClinicalError("unknown role", code="invalid_request", details={"role": role})
