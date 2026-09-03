"""Deterministic grounding scorer for the fixture corpus."""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlsplit, urlunsplit


def _norm(text: Any) -> str:
    return " ".join(str(text or "").lower().split())


def _pages(corpus: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {str(page["snapshot_id"]): page for page in corpus.get("pages") or []}


def markdown_for_question(corpus: dict[str, Any], question: dict[str, Any]) -> str:
    pages = _pages(corpus)
    chunks = []
    for snapshot_id in question.get("snapshot_ids") or []:
        page = pages.get(str(snapshot_id))
        if page:
            chunks.append(f"# {page.get('url', '')}\n\n{page.get('markdown', '')}")
    return "\n\n".join(chunks)


def fixture_answerer(corpus: dict[str, Any]):
    pages = _pages(corpus)

    def answer(question_text: str, markdown: str) -> dict[str, Any]:
        question = next(
            (
                item
                for item in corpus.get("questions") or []
                if item.get("question") == question_text
            ),
            None,
        )
        if question is None:
            return {"answer": "", "claims": [], "citations": [], "snapshot_ids": []}
        if question.get("expect") == "not_found":
            return {
                "answer": "not found",
                "claims": [
                    {
                        "claim_id": f"{question['id']}-nf",
                        "statement": question["question"],
                        "status": "not_found",
                    }
                ],
                "citations": [],
                "snapshot_ids": question.get("snapshot_ids") or [],
            }
        haystack = _norm(markdown)
        claims: list[dict[str, Any]] = []
        citations: list[dict[str, Any]] = []
        for fact in question.get("required_facts") or []:
            if _norm(fact) not in haystack:
                continue
            citation = (question.get("golden_citations") or [{}])[0]
            page = pages.get((question.get("snapshot_ids") or [None])[0])
            claims.append(
                {
                    "claim_id": f"{question['id']}-{len(claims) + 1}",
                    "statement": fact,
                    "status": "supported",
                    "source_url": citation.get("url") or (page or {}).get("url") or "",
                    "quote": citation.get("quote") or fact,
                    "snapshot_id": (page or {}).get("snapshot_id") or "",
                }
            )
            if citation.get("url"):
                citations.append({"url": citation["url"], "quote": citation.get("quote") or fact})
        return {
            "answer": ". ".join(question.get("required_facts") or []),
            "claims": claims,
            "citations": citations,
            "snapshot_ids": question.get("snapshot_ids") or [],
        }

    return answer


def score_grounding_run(corpus: dict[str, Any], answers: dict[str, Any]) -> dict[str, Any]:
    pages = _pages(corpus)
    allowed = {page.get("url") for page in corpus.get("pages") or []}
    questions = corpus.get("questions") or []
    factual_hits = factual_total = 0
    complete_hits = complete_total = 0
    entailment_hits = entailment_total = 0
    evidenced = direct_total = 0
    invented = 0
    failures: list[dict[str, Any]] = []
    for question in questions:
        answer = answers.get(question["id"])
        if not answer:
            failures.append({"id": question["id"], "reason": "missing_answer"})
            continue
        if question.get("expect") == "not_found":
            factual_total += 1
            complete_total += 1
            ok = any(claim.get("status") == "not_found" for claim in answer.get("claims") or [])
            if ok:
                factual_hits += 1
                complete_hits += 1
            else:
                failures.append({"id": question["id"], "reason": "expected_not_found"})
            continue
        blob = _norm(
            " ".join(
                [str(answer.get("answer") or "")]
                + [str(claim.get("statement") or "") for claim in answer.get("claims") or []]
            )
        )
        for fact in question.get("required_facts") or []:
            factual_total += 1
            complete_total += 1
            if _norm(fact) in blob:
                factual_hits += 1
                complete_hits += 1
        for claim in answer.get("claims") or []:
            if claim.get("status") != "supported":
                continue
            direct_total += 1
            page = pages.get(str(claim.get("snapshot_id") or ""))
            quote = str(claim.get("quote") or "")
            if (
                claim.get("source_url")
                and quote
                and page
                and _norm(quote) in _norm(page.get("markdown") or "")
            ):
                evidenced += 1
                entailment_total += 1
                entailment_hits += 1
            else:
                entailment_total += 1
                failures.append({"id": question["id"], "reason": "missing_evidence"})
            if claim.get("source_url") and claim.get("source_url") not in allowed:
                invented += 1
                failures.append({"id": question["id"], "reason": "invented_url"})
        for citation in answer.get("citations") or []:
            if citation.get("url") and citation.get("url") not in allowed:
                invented += 1
                failures.append({"id": question["id"], "reason": "invented_citation"})
    gates = corpus.get("gates") or {}
    metrics = {
        "scoreable": len(questions),
        "factual_accuracy": (factual_hits / factual_total) if factual_total else 0,
        "completeness": (complete_hits / complete_total) if complete_total else 0,
        "citation_entailment": (entailment_hits / entailment_total) if entailment_total else 1,
        "direct_claims_with_evidence": (evidenced / direct_total) if direct_total else 1,
        "invented_citations": invented,
        "failures": failures,
    }
    metrics["passed"] = (
        len(questions) >= 30
        and metrics["factual_accuracy"] >= float(gates.get("factual_accuracy", 0.9))
        and metrics["completeness"] >= float(gates.get("completeness", 0.9))
        and metrics["citation_entailment"] >= float(gates.get("citation_entailment", 0.95))
        and metrics["direct_claims_with_evidence"]
        >= float(gates.get("direct_claims_with_evidence", 1))
        and metrics["invented_citations"] == int(gates.get("invented_citations", 0))
    )
    return metrics


def run_fixture_grounding(corpus: dict[str, Any]) -> dict[str, Any]:
    answerer = fixture_answerer(corpus)
    answers = {
        question["id"]: answerer(question["question"], markdown_for_question(corpus, question))
        for question in corpus.get("questions") or []
    }
    return score_grounding_run(corpus, answers)


def _live_page_entries(pages: Any) -> list[dict[str, Any]]:
    if isinstance(pages, list):
        return [page for page in pages if isinstance(page, dict)]
    if isinstance(pages, dict):
        return [
            dict(page, page_id=page.get("page_id", key))
            for key, page in pages.items()
            if isinstance(page, dict)
        ]
    return []


def _live_page_map(pages: Any) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for page in _live_page_entries(pages):
        for key in (page.get("page_id"), page.get("id"), page.get("url"), page.get("final_url")):
            if key:
                result[str(key)] = page
    return result


def _canonical_live_url(value: Any) -> str:
    try:
        parsed = urlsplit(str(value or ""))
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            return ""
        path = parsed.path.rstrip("/") or "/"
        return urlunsplit((parsed.scheme.lower(), parsed.netloc.lower(), path, parsed.query, ""))
    except ValueError:
        return ""


def _live_source_allowed(
    question: dict[str, Any], page: dict[str, Any], corpus: dict[str, Any]
) -> bool:
    expected = _canonical_live_url(question.get("source_url"))
    actual = _canonical_live_url(page.get("final_url") or page.get("url"))
    if not expected or expected != actual:
        return False
    policy = corpus.get("source_policy") or {}
    if policy.get("require_https") and not actual.startswith("https://"):
        return False
    host = urlsplit(actual).hostname or ""
    host = host.lower()
    rejected = [str(item).lower() for item in policy.get("reject_fixture_hosts") or []]
    if any(host == item or host.endswith(f".{item}") for item in rejected):
        return False
    allowed = [str(item).lower() for item in policy.get("allow_hosts") or []]
    return not allowed or any(host == item or host.endswith(f".{item}") for item in allowed)


def _live_quote(markdown: str, fact: str, evidence_terms: list[Any] | None = None) -> str:
    source = str(markdown or "")
    needle = str(fact or "").strip()
    if not source or not needle:
        return ""
    terms = list(
        dict.fromkeys(
            [needle, *(str(item).strip() for item in evidence_terms or [] if str(item).strip())]
        )
    )
    candidates: list[tuple[int, str, int]] = []
    for raw_line in source.splitlines():
        line = raw_line.strip()
        lower = line.lower()
        if not line or needle.lower() not in lower:
            continue
        present = sum(term.lower() in lower for term in terms)
        score = 0
        if 24 <= len(line) <= 900:
            score += 8
        if any(
            token in lower
            for token in (
                " is ",
                " are ",
                " was ",
                " were ",
                "stands for",
                "original",
                "author",
                "capital",
                "largest",
                "country",
                "continent",
                "unit",
                "term",
                "museum",
                "keys",
                "language",
                "charge",
                "planets",
                "package manager",
            )
        ):
            score += 12
        if lower.startswith(("#", "source:")):
            score -= 20
        if any(
            token in lower
            for token in ("redirected from", "{{", "}}", "cite web", "data-mw", '"wt"')
        ):
            score -= 60
        if line.startswith("|"):
            score += 3
        score += present * 18
        if present == len(terms):
            score += 100
        candidates.append((score, line, present))
    candidates.sort(key=lambda item: (-item[0], len(item[1])))
    best = next((item for item in candidates if item[2] == len(terms)), None)
    if best:
        line = " ".join(best[1].split())
        lower = line.lower()
        indexes = [lower.find(term.lower()) for term in terms]
        indexes = [index for index in indexes if index >= 0]
        start = max(0, min(indexes) - 160)
        end = min(
            len(line),
            max(index + len(term) for index, term in zip(indexes, terms, strict=True)) + 220,
        )
        return line[start:end].strip()[:800]
    if len(terms) > 1:
        return ""
    at = source.lower().find(needle.lower())
    return (
        " ".join(source[max(0, at - 120) : at + len(needle) + 180].split())[:600] if at >= 0 else ""
    )


def live_grounding_oracle(corpus: dict[str, Any], pages: Any) -> dict[str, dict[str, Any]]:
    """Evidence oracle over real fetched pages; never an LLM accuracy claim."""
    by_key = _live_page_map(pages)
    answers: dict[str, dict[str, Any]] = {}
    for question in corpus.get("questions") or []:
        page = by_key.get(str(question.get("page_id") or question.get("id"))) or by_key.get(
            str(question.get("source_url") or "")
        )
        markdown = str((page or {}).get("markdown") or (page or {}).get("text") or "")
        normalized = _norm(markdown)
        if not page or not page.get("success") or not markdown:
            answers[question["id"]] = {
                "answer": "",
                "claims": [],
                "citations": [],
                "unavailable": True,
            }
            continue
        if question.get("expect") == "not_found":
            negative = all(
                _norm(fact) in normalized for fact in question.get("negative_evidence") or []
            )
            answers[question["id"]] = (
                {
                    "answer": "not found: fetched evidence has no real-world value",
                    "claims": [
                        {
                            "claim_id": f"{question['id']}-nf",
                            "statement": question.get("question", ""),
                            "status": "not_found",
                        }
                    ],
                    "citations": [],
                }
                if negative
                else {"answer": "", "claims": [], "citations": [], "unavailable": True}
            )
            continue
        claims: list[dict[str, Any]] = []
        citations: list[dict[str, Any]] = []
        for fact in question.get("required_facts") or []:
            quote = _live_quote(markdown, str(fact), question.get("evidence_terms"))
            if not quote:
                continue
            url = str(page.get("final_url") or page.get("url") or question.get("source_url") or "")
            claims.append(
                {
                    "claim_id": f"{question['id']}-{len(claims) + 1}",
                    "statement": fact,
                    "status": "supported",
                    "source_url": url,
                    "quote": quote,
                    "page_id": question.get("page_id") or question["id"],
                }
            )
            citations.append({"url": url, "quote": quote})
        answers[question["id"]] = {
            "answer": ". ".join(str(claim["statement"]) for claim in claims),
            "claims": claims,
            "citations": citations,
            "page_id": question.get("page_id") or question["id"],
        }
    return answers


def score_live_grounding_run(
    corpus: dict[str, Any],
    answers: dict[str, Any],
    pages: Any,
    options: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Fail-closed score for verified live pages and per-fact evidence claims."""
    questions = corpus.get("questions") or []
    page_map = _live_page_map(pages)
    entries = _live_page_entries(pages)
    failures: list[dict[str, Any]] = []
    valid_pages: set[str] = set()
    for page in entries:
        page_id = str(page.get("page_id") or page.get("id") or "")
        url = _canonical_live_url(page.get("final_url") or page.get("url"))
        digest = str(page.get("sha256") or "")
        if (
            page.get("success")
            and page.get("markdown")
            and re.fullmatch(r"[0-9a-f]{64}", digest, flags=re.IGNORECASE)
            and page.get("hash_verified") is True
            and url
        ):
            valid_pages.add(page_id or url)
        else:
            failures.append({"id": page_id or url, "reason": "invalid_live_page"})
    factual_hits = factual_total = complete_hits = complete_total = 0
    entailment_hits = entailment_total = evidenced = direct_total = invented = unavailable = 0
    for question in questions:
        answer = answers.get(question["id"]) if isinstance(answers, dict) else None
        page_key = str(question.get("page_id") or question["id"])
        page = page_map.get(page_key) or page_map.get(str(question.get("source_url") or ""))
        if not answer or answer.get("unavailable") or not page or page_key not in valid_pages:
            unavailable += 1
            failures.append({"id": question["id"], "reason": "live_evidence_unavailable"})
            continue
        if not _live_source_allowed(question, page, corpus):
            unavailable += 1
            failures.append({"id": question["id"], "reason": "live_source_not_allowed"})
            continue
        if question.get("expect") == "not_found":
            factual_total += 1
            complete_total += 1
            if any(claim.get("status") == "not_found" for claim in answer.get("claims") or []):
                factual_hits += 1
                complete_hits += 1
            else:
                failures.append({"id": question["id"], "reason": "expected_not_found"})
            continue
        blob = _norm(
            " ".join(
                [str(answer.get("answer") or "")]
                + [str(claim.get("statement") or "") for claim in answer.get("claims") or []]
            )
        )
        question_complete = True
        for fact in question.get("required_facts") or []:
            factual_total += 1
            complete_total += 1
            if _norm(fact) in blob:
                factual_hits += 1
            else:
                question_complete = False
                failures.append({"id": question["id"], "reason": "missing_fact", "fact": fact})
        if question_complete:
            complete_hits += len(question.get("required_facts") or [])
        supported_claims = [
            claim for claim in answer.get("claims") or [] if claim.get("status") == "supported"
        ]
        used_claims: set[int] = set()
        page_url = _canonical_live_url(page.get("final_url") or page.get("url"))

        def validate_claim(
            claim: dict[str, Any],
            *,
            current_page: dict[str, Any] = page,
            current_page_url: str = page_url,
            current_question: dict[str, Any] = question,
        ) -> None:
            nonlocal direct_total, evidenced, entailment_hits, entailment_total, invented
            direct_total += 1
            claim_url = _canonical_live_url(claim.get("source_url"))
            quote = str(claim.get("quote") or "")
            source_ok = claim_url == current_page_url
            quote_ok = bool(
                quote
                and _norm(quote)
                in _norm(current_page.get("markdown") or current_page.get("text") or "")
            )
            entailment_total += 1
            if source_ok and quote_ok:
                evidenced += 1
                entailment_hits += 1
            else:
                failures.append(
                    {
                        "id": current_question["id"],
                        "reason": "missing_or_unrelated_live_evidence",
                        "claim": claim.get("claim_id", ""),
                    }
                )
            if claim_url and not source_ok:
                invented += 1
                failures.append(
                    {
                        "id": current_question["id"],
                        "reason": "invented_or_allowlist_url",
                        "url": claim.get("source_url", ""),
                    }
                )

        for fact in question.get("required_facts") or []:
            fact_needle = _norm(fact)
            claim_index = next(
                (
                    index
                    for index, claim in enumerate(supported_claims)
                    if index not in used_claims and fact_needle in _norm(claim.get("statement"))
                ),
                None,
            )
            if claim_index is None:
                direct_total += 1
                entailment_total += 1
                failures.append(
                    {"id": question["id"], "reason": "missing_claim_for_fact", "fact": fact}
                )
                continue
            used_claims.add(claim_index)
            validate_claim(supported_claims[claim_index])
        for index, claim in enumerate(supported_claims):
            if index not in used_claims:
                validate_claim(claim)
        for citation in answer.get("citations") or []:
            if citation.get("url") and _canonical_live_url(citation["url"]) != page_url:
                invented += 1
                failures.append(
                    {"id": question["id"], "reason": "invented_citation", "url": citation["url"]}
                )
    gates = corpus.get("gates") or {}
    metrics = {
        "scoreable": len(questions),
        "fetched_pages": len(entries),
        "unavailable_questions": unavailable,
        "factual_accuracy": factual_hits / factual_total if factual_total else 0,
        "completeness": complete_hits / complete_total if complete_total else 0,
        "citation_entailment": entailment_hits / entailment_total if entailment_total else 1,
        "direct_claims_with_evidence": evidenced / direct_total if direct_total else 0,
        "invented_citations": invented,
        "failures": failures,
        "oracle": (options or {}).get("oracle", "live_fetch_evidence"),
        "model_accuracy_measured": False,
    }
    metrics["passed"] = (
        len(questions) >= int(gates.get("min_scoreable", 30))
        and unavailable == 0
        and metrics["factual_accuracy"] >= float(gates.get("factual_accuracy", 0.9))
        and metrics["completeness"] >= float(gates.get("completeness", 0.9))
        and metrics["citation_entailment"] >= float(gates.get("citation_entailment", 0.95))
        and metrics["direct_claims_with_evidence"]
        >= float(gates.get("direct_claims_with_evidence", 1))
        and invented == int(gates.get("invented_citations", 0))
    )
    return metrics
