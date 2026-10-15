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


def _tokens(text: Any) -> list[str]:
    return [t for t in re.sub(r"[^a-z0-9\s]", " ", _norm(text)).split(" ") if t]


def _token_overlap(quote: Any, markdown: Any) -> float:
    quote_tokens = set(_tokens(quote))
    if not quote_tokens:
        return 0.0
    page_tokens = set(_tokens(markdown))
    return sum(1 for token in quote_tokens if token in page_tokens) / len(quote_tokens)


def _strip_trailing(url: str) -> str:
    return str(url).rstrip(_TRAILING_PUNCT)


def _answer_urls(answer: Any) -> set[str]:
    return {_strip_trailing(m) for m in _URL_RE.findall(str(answer or ""))}


def _as_list(value: Any) -> list[Any]:
    return list(value) if isinstance(value, list) else []


def judge_model_answer(transcript: Any, opts: dict[str, Any] | None = None) -> dict[str, Any]:
    """Judge one model-answer transcript. Fail-closed on any unverifiable part.

    opts: {"mode": "literal"|"fuzzy", "min_overlap": float}. Fuzzy mode passes
    quotes whose token overlap with the page reaches min_overlap (default 0.6).
    """
    doc = transcript if isinstance(transcript, dict) else {}
    options = opts if isinstance(opts, dict) else {}
    mode = "fuzzy" if options.get("mode") == "fuzzy" else "literal"
    try:
        min_overlap = float(options.get("min_overlap", 0.6))
    except (TypeError, ValueError):
        min_overlap = 0.6
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
        literal_ok = resolves and _norm(quote) != "" and _norm(quote) in _norm(pages[url])
        overlap = 1.0 if literal_ok else 0.0
        quote_ok = literal_ok
        if not quote_ok and resolves and mode == "fuzzy" and _norm(quote) != "":
            overlap = _token_overlap(quote, pages[url])
            quote_ok = overlap >= min_overlap
        verdicts.append(
            {
                "index": index,
                "url": url,
                "resolves": resolves,
                "quote_ok": quote_ok,
                "overlap": overlap,
            }
        )
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
    worst_overlap = max([v["overlap"] for v in bad_quotes] + [1.0])
    gate_name = (
        "every citation quote overlaps its page"
        if mode == "fuzzy"
        else "every citation quote matches its page literally"
    )
    if bad_quotes:
        bad_detail = (
            f"mismatch at citation index {', '.join(str(v['index']) for v in bad_quotes)}"
            f" (mode={mode}, overlap={worst_overlap:.2f})"
        )
    else:
        bad_detail = ""
    push(
        "quotes_literal",
        gate_name,
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
        "mode": mode,
        "gates": gates,
        "score": (passed / len(gates)) if gates else 0,
        "verdict": "pass" if passed == len(gates) else "fail",
        "notice": "Deterministic judgment only; no claim beyond the fetched pages.",
    }
