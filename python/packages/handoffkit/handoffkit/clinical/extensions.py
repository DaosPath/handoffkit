"""Registrable clinical lab extensions. No silent substitution."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from handoffkit.clinical.errors import ClinicalError

KINDS = (
    "provider_adapter",
    "clinical_role",
    "gatekeeper",
    "cost_profile",
    "retriever",
    "judge",
    "run_store",
)

_REGISTRY: dict[str, dict[str, Callable[..., Any]]] = {kind: {} for kind in KINDS}


def register(kind: str, name: str, impl: Callable[..., Any]) -> None:
    if kind not in KINDS:
        raise ClinicalError("unknown extension kind", code="invalid_request")
    _REGISTRY[kind][name] = impl


def get_extension(kind: str, name: str) -> Callable[..., Any]:
    bucket = _REGISTRY.get(kind) or {}
    if name not in bucket:
        raise ClinicalError(
            f"extension {name} is not registered",
            code="provider_unavailable",
            details={"kind": kind, "name": name},
        )
    return bucket[name]


def list_extensions(kind: str | None = None) -> dict[str, list[str]]:
    if kind:
        return {kind: sorted(_REGISTRY.get(kind) or {})}
    return {key: sorted(value) for key, value in _REGISTRY.items()}
