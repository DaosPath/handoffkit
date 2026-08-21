"""Retrieval-assisted track. Live fetch stays unavailable until Browser Real connects.

URL validation here is a fail-closed allowlist. It is not an integrated
retrieval runtime and must not be advertised as live navigation.
"""

from __future__ import annotations

from urllib.parse import urlparse

from handoffkit.clinical.errors import ClinicalError
from handoffkit.clinical.models import ClinicalRun

MEDICAL_HOST_ALLOW = (
    "nih.gov",
    "nlm.nih.gov",
    "cdc.gov",
    "who.int",
    "nejm.org",
    "jamanetwork.com",
    "thelancet.com",
    "bmj.com",
    "nature.com",
    "sciencedirect.com",
    "pubmed.ncbi.nlm.nih.gov",
)

PRIVATE_HOSTS = ("localhost", "127.0.0.1", "0.0.0.0", "::1")

RETRIEVAL_TRACK_STATUS = {
    "declared": True,
    "adapter": "scaffold",
    "integrated": False,
    "live_tested": False,
    "available": False,
    "browser_real": "disconnected",
}


def _host(url: str) -> str:
    return (urlparse(url).hostname or "").lower()


def _gold_doc(run: ClinicalRun, gold: dict | None) -> dict:
    if gold:
        return dict(gold)
    try:
        from handoffkit.clinical.machine import DEFAULT_VAULT

        return DEFAULT_VAULT.get(run.run_id)
    except Exception:
        return {}


def assert_retrieval_url(url: str, run: ClinicalRun, gold: dict | None = None) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise ClinicalError("retrieval_blocked", code="retrieval_blocked")
    host = _host(url)
    if not host or host in PRIVATE_HOSTS or host.endswith(".local"):
        raise ClinicalError("localhost/private retrieval blocked", code="retrieval_blocked")
    if host.startswith("10.") or host.startswith("192.168.") or host.startswith("172."):
        raise ClinicalError("private network retrieval blocked", code="retrieval_blocked")
    if not any(host == allowed or host.endswith("." + allowed) for allowed in MEDICAL_HOST_ALLOW):
        raise ClinicalError("host not on medical allowlist", code="retrieval_blocked")
    hay = f"{url} {host}".lower()
    doc = _gold_doc(run, gold)
    for key in ("pmcid", "article_link", "title", "final_diagnosis"):
        value = str(doc.get(key) or "").strip().lower()
        if value and len(value) >= 6 and value in hay:
            raise ClinicalError(
                "source article blocked from retrieval",
                code="retrieval_blocked",
                details={"field": key},
            )


def block_query(query: str, run: ClinicalRun, gold: dict | None = None) -> None:
    hay = query.lower()
    doc = _gold_doc(run, gold)
    for key in ("pmcid", "title", "final_diagnosis", "article_link"):
        value = str(doc.get(key) or "").strip().lower()
        if value and len(value) >= 8 and value in hay:
            raise ClinicalError(
                "gold metadata in retrieval query",
                code="gold_leak_detected",
                details={"field": key},
            )
