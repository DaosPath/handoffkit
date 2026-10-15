"""Host ranking for search/research candidates."""

from __future__ import annotations

from handoffkit.browser.types import host_matches, normalize_host, parse_url

TRUSTED = [
    ("wikipedia.org", 100),
    ("nih.gov", 95),
    ("nlm.nih.gov", 95),
    ("pubmed.ncbi.nlm.nih.gov", 95),
    ("ncbi.nlm.nih.gov", 94),
    ("fda.gov", 93),
    ("ema.europa.eu", 92),
    ("who.int", 90),
    ("drugs.com", 85),
    ("medlineplus.gov", 85),
    ("mayoclinic.org", 80),
    ("github.com", 75),
    ("pypi.org", 75),
    ("npmjs.com", 75),
    ("readthedocs.io", 70),
    ("arxiv.org", 70),
    ("nature.com", 70),
    ("frontiersin.org", 60),
]
LOW_TRUST = ("pinterest.", "facebook.com", "twitter.com", "x.com", "tiktok.com", "instagram.com")


def host_score(url: str) -> int:
    host = normalize_host(parse_url(url)["host"])
    if not host:
        return 0
    if any(bad.rstrip(".") in host for bad in LOW_TRUST):
        return 5
    best = 40
    for pattern, score in TRUSTED:
        if pattern in host:
            best = max(best, score)
    if host.endswith((".edu", ".gov")):
        best = max(best, 88)
    return best


def rank_search_hits(
    hits: list[dict[str, str]] | None = None,
    *,
    allow_hosts: list[str] | None = None,
    deny_hosts: list[str] | None = None,
) -> list[dict[str, object]]:
    allow = [normalize_host(h) for h in (allow_hosts or []) if h]
    deny = [normalize_host(h) for h in (deny_hosts or []) if h]
    out: list[dict[str, object]] = []
    for hit in hits or []:
        url = hit.get("url", "")
        title = hit.get("title", "")
        host = normalize_host(parse_url(url)["host"])
        if not host:
            continue
        if any(host_matches(host, d) for d in deny):
            continue
        if allow and not any(host_matches(host, a) for a in allow):
            continue
        try:
            weight = float(hit.get("weight", 1))
        except (TypeError, ValueError):
            weight = 1.0
        if weight != weight:  # NaN
            weight = 0.0
        out.append(
            {
                "title": title,
                "url": url,
                "score": host_score(url) + (5 if title else 0),
                "weight": weight,
            }
        )
    out.sort(key=lambda h: (-float(h["weight"]), -int(h["score"]), str(h["url"])))  # type: ignore[arg-type]
    return [{"title": h["title"], "url": h["url"], "score": h["score"]} for h in out]
