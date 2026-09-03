"""Deterministic model-answer judge for Browser 1.20.

Scores a live provider answer transcript against the pages that were
actually fetched. No model, no network, no fallback: every gate is a
string/URL/set check and anything unverifiable fails closed.

Snake_case wire format mirrors the JavaScript implementation exactly.
"""

from __future__ import annotations

import re
from typing import Any

_URL_RE = re.compile(r"https?://[^\s)\"'\]]+")
_TRAILING_PUNCT = ".,;:!?)]"


def _norm(text: Any) -> str:
    return " ".join(str(text or "").lower().split())


def _strip_trailing(url: str) -> str:
    return str(url).rstrip(_TRAILING_PUNCT)


def _answer_urls(answer: Any) -> set[str]:
    return {_strip_trailing(m) for m in _URL_RE.findall(str(answer or ""))}


def _as_list(value: Any) -> list[Any]:
    return list(value) if isinstance(value, list) else []


def judge_model_answer(transcript: Any) -> dict[str, Any]:
    """Judge one model-answer transcript. Fail-closed on any unverifiable part."""
    doc = transcript if isinstance(transcript, dict) else {}
    pages: dict[str, str] = {}
    for page in _as_list(doc.get("pages")):
        if isinstance(page, dict) and isinstance(page.get("url"), str):
            pages[page["url"]] = str(page.get("markdown") or "")
    citations = _as_list(doc.get("citations"))
    claims = _as_list(doc.get("claims"))
    gates: list[dict[str, Any]] = []

    def push(gate_id: str, name: str, result: str, detail: str = "") -> None:
        gates.append({"id": gate_id, "name": name, "result": result, "detail": detail})

    answer = str(doc.get("answer") or "")
    push(
        "answer_present",
        "answer is non-empty",
        "pass" if answer.strip() else "fail",
        "" if answer.strip() else "empty answer text",
    )

    verdicts = []
    for index, citation in enumerate(citations):
        url = citation.get("url") if isinstance(citation, dict) else None
        url = url if isinstance(url, str) else ""
        resolves = url in pages
        quote = citation.get("quote") if isinstance(citation, dict) else ""
        quote_ok = (
            resolves
            and _norm(quote) != ""
            and _norm(quote) in _norm(pages[url])
        )
        verdicts.append({"index": index, "url": url, "resolves": resolves, "quote_ok": quote_ok})
    unresolved = [v for v in verdicts if not v["resolves"]]
    if not citations:
        citations_result = "pass" if not claims else "fail"
    else:
        citations_result = "pass" if not unresolved else "fail"
    push(
        "citations_resolve",
        "every citation url was fetched",
        citations_result,
        "" if not unresolved else f"unfetched: {', '.join(v['url'] for v in unresolved)}",
    )

    bad_quotes = [v for v in verdicts if not v["quote_ok"]]
    bad_detail = "" if not bad_quotes else "mismatch at citation index " + ", ".join(
        str(v["index"]) for v in bad_quotes
    )
    push(
        "quotes_literal",
        "every citation quote matches its page literally",
        "pass" if not bad_quotes else "fail",
        bad_detail,
    )

    uncovered = []
    for claim in claims:
        raw_urls = claim.get("citation_urls") if isinstance(claim, dict) else []
        urls = [u for u in _as_list(raw_urls) if isinstance(u, str) and u]
        claim_id = claim.get("claim_id") if isinstance(claim, dict) else None
        if not urls or any(u not in pages for u in urls):
            uncovered.append(str(claim_id or "?"))
    push(
        "claims_covered",
        "every claim points at fetched evidence",
        "pass" if not uncovered else "fail",
        "" if not uncovered else f"uncovered: {', '.join(uncovered)}",
    )

    invented = sorted(u for u in _answer_urls(answer) if u not in pages)
    push(
        "no_invented_urls",
        "answer links only fetched pages",
        "pass" if not invented else "fail",
        "" if not invented else f"invented: {', '.join(invented)}",
    )

    passed = sum(1 for gate in gates if gate["result"] == "pass")
    return {
        "format": "handoffkit.browser.model_answer_judgment",
        "format_version": 1,
        "question_id": doc.get("question_id") or "",
        "model": doc.get("model") or "",
        "gates": gates,
        "score": (passed / len(gates)) if gates else 0,
        "verdict": "pass" if passed == len(gates) else "fail",
        "notice": "Deterministic judgment only; no claim beyond the fetched pages.",
    }
