"""Web-grounded research recipes (optional ``handoffkit.browser``).

The grounded route is explicit: live search results become a Markdown index,
the provider selects exact candidate URLs, HandoffKit fetches only those URLs
and converts them to Markdown, then the provider answers from that evidence.
Invalid contracts fail closed.
"""

from __future__ import annotations

import asyncio
import json
import time
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

import re


def _is_fetchable_web_candidate(url: Any) -> bool:
    """Reject binary/download URLs before provider selection."""
    try:
        path = urlparse(str(url or "")).path.lower()
    except (TypeError, ValueError):
        return False
    return not any(
        path.endswith(suffix) or f"{suffix}/" in path
        for suffix in (".pdf", ".zip", ".gz", ".tar", ".tgz", ".7z", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx")
    ) and "/download/" not in path and "/pdf/" not in path


def _provider_text(provider: Any, prompt: str, **options: Any) -> str:
    if provider is None:
        return ""
    if hasattr(provider, "agenerate"):
        try:
            result = provider.agenerate(prompt, **options)
        except TypeError:
            result = provider.agenerate(prompt)
        if hasattr(result, "__await__"):
            try:
                result = asyncio.run(result)
            except RuntimeError as exc:
                raise RuntimeError("async provider requires an async caller; use generate()") from exc
        return str(result or "").strip()
    if hasattr(provider, "generate"):
        try:
            return str(provider.generate(prompt, **options) or "").strip()
        except TypeError:
            return str(provider.generate(prompt) or "").strip()
    if callable(provider):
        return str(provider(prompt) or "").strip()
    raise TypeError("web grounded provider must expose generate() or agenerate().")


def _parse_json(value: str) -> tuple[dict[str, Any] | None, str]:
    text = str(value or "").strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text
        text = text.rsplit("```", 1)[0].strip()
    try:
        parsed = json.loads(text)
    except (TypeError, ValueError) as exc:
        return None, str(exc)
    return parsed if isinstance(parsed, dict) else None, ""


def _candidate_markdown(query: str, candidates: list[dict[str, Any]]) -> str:
    lines = [
        "# Resultados de búsqueda actuales",
        "",
        f"Consulta: {query}",
        f"Obtenidos: {datetime.now(timezone.utc).isoformat()}",
        "",
    ]
    for candidate in candidates:
        lines.extend(
            [
                f"## {candidate['rank']}. {candidate.get('title') or 'Untitled'}",
                "",
                f"URL exacta: {candidate['url']}",
                "",
            ]
        )
        if candidate.get("source_queries"):
            lines.extend([f"Consultas relacionadas: {' | '.join(candidate['source_queries'])}", ""])
    return "\n".join(lines)


def _select_urls(planner: dict[str, Any] | None, candidates: list[dict[str, Any]], limit: int) -> list[str]:
    allowed = {str(candidate.get("url")): candidate for candidate in candidates}
    selected: list[str] = []

    def add_url(value: Any) -> None:
        url = str(value or "").strip()
        if url in allowed and url not in selected:
            selected.append(url)

    def add_rank(value: Any) -> None:
        try:
            rank = int(value)
        except (TypeError, ValueError):
            return
        for candidate in candidates:
            if candidate.get("rank") == rank:
                add_url(candidate.get("url"))
                break

    if not planner:
        return []
    urls = planner.get("selected_urls", planner.get("selectedUrls", []))
    if isinstance(urls, list):
        for value in urls:
            add_url(value if isinstance(value, str) else (value or {}).get("url"))
    ranks = planner.get("selected_ranks", planner.get("selectedRanks", []))
    if isinstance(ranks, list):
        for value in ranks:
            if isinstance(value, dict):
                add_rank(value.get("rank", value.get("result_rank")))
                add_url(value.get("url"))
            else:
                add_rank(value)
    return selected[: max(1, int(limit or 1))]


def _ensure_query_coverage(
    selected_urls: list[str],
    candidates: list[dict[str, Any]],
    search_query_list: list[str],
    limit: int,
) -> list[str]:
    """Reserve one fetched candidate for each explicit subquery when available."""
    max_items = max(1, int(limit or 1))
    allowed = {str(candidate.get("url") or ""): candidate for candidate in candidates}
    selected: list[str] = []

    def add_url(url: Any) -> None:
        value = str(url or "").strip()
        if value in allowed and value not in selected:
            selected.append(value)

    for query in search_query_list:
        candidate = next(
            (item for item in candidates if query in (item.get("source_queries") or [])),
            None,
        )
        if candidate:
            add_url(candidate.get("url"))
    for url in selected_urls:
        add_url(url)
    return selected[:max_items]


def _fallback_query_coverage(
    candidates: list[dict[str, Any]],
    selected_urls: list[str],
    fetched_urls: set[str],
    search_query_list: list[str],
    limit: int,
) -> list[str]:
    """Replace failed selections while preserving one source per subquery."""
    max_items = max(1, int(limit or 1))
    selected_set = set(selected_urls)
    out: list[str] = []

    def add(url: Any) -> None:
        value = str(url or "")
        if value and value not in out:
            out.append(value)

    for url in selected_urls:
        if url in fetched_urls:
            add(url)
    for query in search_query_list:
        covered = any(
            query in (item.get("source_queries") or [])
            for item in candidates
            if item.get("url") in out
        )
        if covered:
            continue
        candidate = next(
            (
                item for item in candidates
                if item.get("url") not in selected_set
                and query in (item.get("source_queries") or [])
            ),
            None,
        )
        if candidate:
            add(candidate.get("url"))
    for candidate in candidates:
        if candidate.get("url") not in selected_set:
            add(candidate.get("url"))
    for url in selected_urls:
        add(url)
    return out[:max_items]


def _page_evidence(pack: Any) -> str:
    from handoffkit.browser.page import PageMarkdown

    pages: list[str] = []
    for index, raw_page in enumerate(getattr(pack, "pages", []) or [], 1):
        if isinstance(raw_page, PageMarkdown):
            page = raw_page
        else:
            data = raw_page if isinstance(raw_page, dict) else {}
            page = PageMarkdown(
                url=str(data.get("url") or ""),
                final_url=str(data.get("final_url") or data.get("finalUrl") or ""),
                title=str(data.get("title") or ""),
                markdown=str(data.get("markdown") or ""),
                text=str(data.get("text") or ""),
                excerpt=str(data.get("excerpt") or ""),
                success=bool(data.get("success", True)),
            )
        pages.append(
            "\n".join(
                [
                    f"## Evidence page {index}: {page.title or 'Untitled page'}",
                    "",
                    page.markdown or page.text or page.excerpt or "",
                ]
            )
        )
    return "\n\n---\n\n".join(pages)


def _extract_explicit_runtimes(pages: list[Any] | None = None) -> set[str]:
    import re

    allowed: set[str] = set()
    for raw_page in pages or []:
        if isinstance(raw_page, dict):
            text = str(raw_page.get("markdown") or raw_page.get("text") or "")
        else:
            text = str(getattr(raw_page, "markdown", "") or getattr(raw_page, "text", "") or "")
        in_quick_start = False
        for raw_line in text.splitlines():
            line = raw_line.strip()
            if re.match(r"^#{1,4}\s+.*quick start", line, flags=re.I):
                in_quick_start = True
                continue
            if in_quick_start and re.match(r"^#{1,4}\s+", line):
                in_quick_start = False
            if not in_quick_start or not re.match(r"^[-*]\s+", line):
                continue
            label = re.sub(r"\s+[-–—:].*", "", re.sub(r"^[-*]\s+", "", line)).strip()
            if label:
                allowed.add(label.lower())
    return allowed


def _sanitize_answer(value: Any, allowed_runtimes: set[str] | None = None) -> str:
    import re

    allowed = {str(item).lower() for item in (allowed_runtimes or set())}
    in_runtime_list = False
    lines: list[str] = []
    for line in str(value or "").splitlines():
        trimmed = line.strip()
        if re.search(r"\b(?:quick start|runtimes?)\b", trimmed, flags=re.I):
            in_runtime_list = True
        elif re.match(r"^#{1,4}\s+", trimmed):
            in_runtime_list = False
        if in_runtime_list and re.match(r"^[-*]\s+", line) and allowed:
            label = re.sub(r"\s+\(.*$", "", re.sub(r"^[-*]\s+", "", trimmed)).strip().lower()
            if label not in allowed:
                continue
        if not re.match(r"^\s*[-*]\s*\[[^\]]+\]\(https?://[^)]+\)", line, flags=re.I):
            lines.append(line)
    text = "\n".join(lines)
    text = re.sub(r"\[([^\]]+)\]\(https?://[^)]+\)", r"\1", text, flags=re.I)
    text = re.sub(r"https?://\S+", "", text, flags=re.I)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def _page_label_coverage(answer: str, pages: list[Any]) -> bool:
    import re

    text = answer.lower()
    stop = {"the", "and", "for", "with", "from", "page", "docs", "blog", "home", "about"}
    for raw_page in pages:
        title = str(getattr(raw_page, "title", "") or (raw_page.get("title") if isinstance(raw_page, dict) else "") or "").lower()
        tokens = [token for token in re.findall(r"[a-z0-9][a-z0-9._-]{2,}", title) if token not in stop]
        if tokens and not any(token in text for token in tokens):
            return False
    return True


def _parse_answer(value: str, page_count: int, pages: list[Any] | None = None) -> tuple[str, bool, str]:
    parsed, error = _parse_json(value)
    if parsed is None:
        return _sanitize_answer(value, _extract_explicit_runtimes(pages)), False, error
    answer = _sanitize_answer(
        parsed.get("answer", parsed.get("response", "")),
        _extract_explicit_runtimes(pages),
    )
    raw_pages = parsed.get(
        "evidence_pages",
        parsed.get("evidencePages", parsed.get("page_numbers", parsed.get("pageNumbers", []))),
    )
    page_numbers: list[int] = []
    if isinstance(raw_pages, list):
        for number in raw_pages:
            try:
                page_numbers.append(int(number))
            except (TypeError, ValueError):
                continue
    all_evidence = isinstance(raw_pages, str) and raw_pages.strip().lower() in {"all", "todo", "todos", "todas"}
    explicit_coverage = all_evidence or (
        len(set(page_numbers)) >= page_count
        and all(1 <= number <= page_count for number in page_numbers)
    )
    # An explicit `evidence_pages: "all"` marker covers the controlled page
    # set. Requiring every title in the prose polluted research answers with
    # a navigation catalogue. Keep title coverage for legacy numeric markers.
    coverage = explicit_coverage if all_evidence else explicit_coverage and _page_label_coverage(answer, pages or [])
    error = "answer contains protocol fields instead of content" if answer.lower().startswith(("answer:", "page_numbers", "evidence_pages", "selected_urls")) else ""
    return answer, coverage, error


def _normalize_evidence_sections(value: Any) -> list[dict[str, Any]]:
    sections: list[dict[str, Any]] = []
    seen: set[str] = set()
    for index, raw in enumerate(value if isinstance(value, list) else []):
        if not isinstance(raw, dict):
            continue
        section_id = "".join(
            char.lower() if char.isalnum() or char in "_-" else "_"
            for char in str(raw.get("id") or f"section_{index + 1}").strip()
        )
        requirements = [
            str(item or "").strip()
            for item in (raw.get("requirements") if isinstance(raw.get("requirements"), list) else [])
            if str(item or "").strip()
        ][:24]
        if not section_id or section_id in seen or not requirements:
            continue
        seen.add(section_id)
        sections.append(
            {
                "id": section_id,
                "title": str(raw.get("title") or raw.get("label") or section_id).strip(),
                "render": str(raw.get("render") or "bullets").lower()
                if str(raw.get("render") or "").lower() in {"bullets", "paragraph", "table"}
                else "bullets",
                "columns": [str(item or "").strip() for item in raw.get("columns", []) if str(item or "").strip()][:8]
                if isinstance(raw.get("columns"), list) else [],
                "query": str(raw.get("query") or "").strip(),
                "source_queries": [
                    str(item or "").strip()
                    for item in (
                        raw.get("source_queries", raw.get("sourceQueries", []))
                        if isinstance(raw.get("source_queries", raw.get("sourceQueries", [])), list)
                        else []
                    )
                    if str(item or "").strip()
                ],
                "requirements": requirements,
                "deterministic_evidence": [
                    {
                        "requirement": str(item.get("requirement") or "").strip(),
                        "statement": str(item.get("statement") or "").strip(),
                        "quote": str(item.get("quote") or "").strip(),
                    }
                    for item in (
                        raw.get("deterministic_evidence", raw.get("deterministicEvidence", []))
                        if isinstance(raw.get("deterministic_evidence", raw.get("deterministicEvidence", [])), list)
                        else []
                    )
                    if isinstance(item, dict)
                    and str(item.get("requirement") or "").strip()
                    and str(item.get("statement") or "").strip()
                    and str(item.get("quote") or "").strip()
                ],
                "deterministic_findings": [
                    {
                        "requirement": str(item.get("requirement") or "").strip(),
                        "statement": str(item.get("statement") or "").strip(),
                        "evidence_claims": [
                            str(claim or "").strip()
                            for claim in item.get("evidence_claims", item.get("evidenceClaims", []))
                            if str(claim or "").strip()
                        ],
                        "cells": [str(cell or "").strip() for cell in item.get("cells", [])]
                        if isinstance(item.get("cells"), list) else [],
                    }
                    for item in (
                        raw.get("deterministic_findings", raw.get("deterministicFindings", []))
                        if isinstance(raw.get("deterministic_findings", raw.get("deterministicFindings", [])), list)
                        else []
                    )
                    if isinstance(item, dict)
                    and str(item.get("requirement") or "").strip()
                    and str(item.get("statement") or "").strip()
                ],
                "required": raw.get("required") is not False,
                "max_pages": max(1, min(int(raw.get("max_pages") or raw.get("maxPages") or 3), 8)),
            }
        )
        if len(sections) >= 12:
            break
    return sections


def _evidence_page_record(raw_page: Any, index: int, candidates: list[dict[str, Any]]) -> dict[str, Any]:
    data = raw_page if isinstance(raw_page, dict) else {}
    url = str(
        getattr(raw_page, "url", "")
        or data.get("url")
        or getattr(raw_page, "final_url", "")
        or data.get("final_url")
        or ""
    ).strip()
    candidate = next((item for item in candidates if item.get("url") == url), {})
    return {
        "number": index + 1,
        "title": str(getattr(raw_page, "title", "") or data.get("title") or "Untitled page").strip(),
        "url": url,
        "content": str(
            getattr(raw_page, "markdown", "")
            or data.get("markdown")
            or getattr(raw_page, "text", "")
            or data.get("text")
            or getattr(raw_page, "excerpt", "")
            or data.get("excerpt")
            or ""
        ),
        "source_queries": list(candidate.get("source_queries") or []),
    }


def _match_tokens(value: Any) -> list[str]:
    text = str(value or "").lower()
    text = re.sub(r"\\(?:ell|beta|hat|sum|sigma|equiv|bar|tilde)\b", " ", text)
    tokens = [
        token for token in re.sub(r"[^a-z0-9]+", " ", text).split()
        if len(token) > 1 and token not in {
            "ell", "beta", "hat", "sigma", "the", "and", "for", "with", "from", "that", "this",
            "only", "using", "use", "when", "where", "state", "describe", "report", "retrieved",
        }
    ]
    return [
        token[:-3] if len(token) > 6 and token.endswith("ing")
        else token[:-2] if len(token) > 5 and token.endswith("ed")
        else token[:-1] if len(token) > 4 and token.endswith("s")
        else token
        for token in tokens
    ]


def _quote_matches(quote: Any, content: Any) -> bool:
    quote_tokens = _match_tokens(quote)
    page_tokens = _match_tokens(content)
    if len(quote_tokens) < 4 or len(page_tokens) < 4:
        return False
    page_text = f" {' '.join(page_tokens)} "
    return any(
        f" {' '.join(quote_tokens[index:index + 4])} " in page_text
        for index in range(len(quote_tokens) - 3)
    )


def _evidence_section_pages(
    section: dict[str, Any], pages: list[Any], candidates: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    records = [_evidence_page_record(page, index, candidates) for index, page in enumerate(pages)]
    exact_queries = {str(item).lower() for item in section.get("source_queries", [])}
    terms = set(_match_tokens(" ".join([
        section.get("title", ""), section.get("query", ""), *section.get("requirements", [])
    ])))
    scored: list[tuple[int, int, dict[str, Any]]] = []
    for page in records:
        exact = any(str(query).lower() in exact_queries for query in page["source_queries"])
        haystack = set(_match_tokens(f"{page['title']} {' '.join(page['source_queries'])} {page['content'][:5000]}"))
        scored.append(((1000 if exact else 0) + len(terms & haystack), page["number"], page))
    scored.sort(key=lambda item: (-item[0], item[1]))
    selected = [item[2] for item in scored if item[0] > 0][: section["max_pages"]]
    return selected or records[: section["max_pages"]]


def _relevant_evidence_text(content: str, terms: list[str], max_chars: int) -> str:
    chunks = [item.strip() for item in re.split(r"\n{2,}|(?<=\.)\s+(?=[A-Z])", content) if item.strip()]
    unique_terms = {term.lower() for term in terms if len(term) >= 4}
    ranked = sorted(
        enumerate(chunks),
        key=lambda item: (-sum(term in item[1].lower() for term in unique_terms), item[0]),
    )
    selected: list[tuple[int, str]] = []
    used = 0
    for index, chunk in ranked:
        if used >= max_chars:
            break
        score = sum(term in chunk.lower() for term in unique_terms)
        if score == 0 and selected:
            break
        bounded = chunk[: max(0, max_chars - used)]
        if bounded:
            selected.append((index, bounded))
            used += len(bounded)
    if not selected:
        return content[:max_chars]
    return "\n\n".join(text for _, text in sorted(selected))


def _build_evidence_dossier(
    sections: list[dict[str, Any]],
    pages: list[Any],
    candidates: list[dict[str, Any]],
    provider: Any,
    question: str,
    *,
    max_tokens: int,
    retries: int,
    context_max_chars: int,
) -> dict[str, Any]:
    if not sections:
        return {"enabled": False, "valid": True, "degraded": False, "sections": [], "errors": [], "warnings": []}
    extracted: list[dict[str, Any]] = []
    errors: list[str] = []
    all_warnings: list[str] = []
    for section in sections:
        selected_pages = _evidence_section_pages(section, pages, candidates)
        findings: list[dict[str, Any]] = []
        raw_outputs: list[str] = []
        warnings: list[str] = []
        section_attempts = 0
        attempts = max(1, min(int(retries or 0) + 1, 3))
        for requirement in section["requirements"]:
            deterministic = next(
                (item for item in section.get("deterministic_evidence", []) if item["requirement"] == requirement),
                None,
            )
            if deterministic:
                requirement_terms = set(_match_tokens(requirement))
                statement_terms = set(_match_tokens(deterministic["statement"]))
                quote_terms = set(_match_tokens(deterministic["quote"]))
                minimum = 1 if len(requirement_terms) <= 4 else 2
                relevant = (
                    len(requirement_terms & statement_terms) >= minimum
                    and len(requirement_terms & quote_terms) >= minimum
                )
                matched_pages = [
                    page["number"] for page in selected_pages
                    if relevant and _quote_matches(deterministic["quote"], page["content"])
                ]
                if matched_pages:
                    findings.append({
                        "requirement": requirement,
                        "status": "supported",
                        "statement": deterministic["statement"],
                        "quote": deterministic["quote"],
                        "evidence_pages": matched_pages,
                        "verification": {"quote_matched": True, "deterministic": True},
                    })
                else:
                    warnings.append(f"{requirement}: deterministic evidence quote missing or irrelevant")
                    findings.append({"requirement": requirement, "status": "not_found", "statement": "", "quote": "", "evidence_pages": []})
                continue
            terms = _match_tokens(f"{section['title']} {section.get('query', '')} {requirement}")
            remaining = max(2000, int(context_max_chars or 12000))
            evidence_blocks: list[str] = []
            for page in selected_pages:
                if remaining <= 0:
                    break
                bounded = _relevant_evidence_text(page["content"], terms, min(remaining, 6000))
                evidence_blocks.append(f"[P{page['number']}] {page['title']}\n{bounded}")
                remaining -= len(bounded)
            base_prompt = "\n".join([
                "Extract evidence for exactly ONE requirement. Do not write the final answer. Do not use memory.",
                f"Section: {section['title']}",
                f"Focus: {section.get('query', '')}" if section.get("query") else "",
                f"Requirement: {requirement}",
                'Return exactly one finding. status is "supported" only when supplied pages explicitly support the statement; otherwise use "not_found".',
                "For supported findings, quote must be one short verbatim fragment copied from the indicated page. A non-verbatim quote is rejected.",
                "Do not infer adoption, popularity, ranking, dates, software, or causal mechanisms.",
                'Return ONLY JSON: {"section_id":"...","findings":[{"status":"supported|not_found","statement":"...","quote":"verbatim page fragment","evidence_pages":[1]}]}',
                "", f"Research question: {question}", "", "Evidence:", "\n\n---\n\n".join(evidence_blocks),
            ])
            verdict: dict[str, Any] = {"valid": False, "error": "not attempted"}
            raw = ""
            for attempt in range(1, attempts + 1):
                section_attempts += 1
                prompt = base_prompt if attempt == 1 else (
                    "Repair JSON. Return exactly one finding for the one requirement.\n"
                    f"Previous error: {verdict['error']}\n\n{base_prompt}\n\nPrevious output: {raw}"
                )
                try:
                    raw = _provider_text(
                        provider, prompt, temperature=0, max_tokens=max_tokens,
                        response_format={"type": "json_object"},
                    )
                except Exception as exc:  # pragma: no cover - provider-specific
                    verdict = {"valid": False, "error": str(exc)}
                    continue
                parsed, parse_error = _parse_json(raw)
                raw_findings = parsed.get("findings", []) if parsed else []
                if parse_error or not isinstance(raw_findings, list) or not raw_findings:
                    verdict = {"valid": False, "error": parse_error or "missing finding"}
                    continue
                if len(raw_findings) > 1:
                    requirement_terms = set(_match_tokens(requirement))
                    ranked: list[tuple[int, dict[str, Any]]] = []
                    for raw_finding in raw_findings:
                        finding = raw_finding if isinstance(raw_finding, dict) else {}
                        overlap = len(requirement_terms & set(_match_tokens(finding.get("statement"))))
                        grounded = any(_quote_matches(finding.get("quote"), page["content"]) for page in selected_pages)
                        ranked.append(((100 if grounded else 0) + overlap, finding))
                    ranked.sort(key=lambda item: item[0], reverse=True)
                    raw_findings = [ranked[0][1] if ranked[0][0] >= 102 else {"status": "not_found"}]
                raw_finding = raw_findings[0] if isinstance(raw_findings[0], dict) else {}
                status = str(raw_finding.get("status") or "").lower()
                statement = str(raw_finding.get("statement") or "").strip()
                quote = str(raw_finding.get("quote") or "").strip().strip("\"'â€œâ€â€˜â€™")
                matched_pages = [page["number"] for page in selected_pages if len(quote) >= 12 and _quote_matches(quote, page["content"])]
                requirement_terms = set(_match_tokens(requirement))
                statement_overlap = len(requirement_terms & set(_match_tokens(statement)))
                quote_overlap = len(requirement_terms & set(_match_tokens(quote)))
                minimum_overlap = 1 if len(requirement_terms) <= 4 else 2
                supported = (
                    status == "supported" and bool(statement) and bool(matched_pages)
                    and statement_overlap >= minimum_overlap and quote_overlap >= minimum_overlap
                )
                if status == "supported" and not supported:
                    verdict = {"valid": False, "error": "supported finding lacks a grounded, requirement-relevant quote"}
                    continue
                verdict = {
                    "valid": True,
                    "finding": {
                        "requirement": requirement,
                        "status": "supported" if supported else "not_found",
                        "statement": statement if supported else "",
                        "quote": quote if supported else "",
                        "evidence_pages": matched_pages if supported else [],
                        "verification": {
                            "quote_matched": bool(matched_pages),
                            "statement_overlap": statement_overlap,
                            "quote_overlap": quote_overlap,
                            "minimum_overlap": minimum_overlap,
                        },
                    },
                }
                break
            raw_outputs.append(raw)
            if not verdict.get("valid"):
                warnings.append(f"{requirement}: {verdict.get('error', 'invalid evidence output')}")
                findings.append({"requirement": requirement, "status": "not_found", "statement": "", "quote": "", "evidence_pages": []})
            else:
                findings.append(verdict["finding"])
        section_result = {
            "valid": len(findings) == len(section["requirements"]),
            "degraded": bool(warnings),
            "id": section["id"],
            "title": section["title"],
            "required": section["required"],
            "findings": findings,
            "pages": [{"number": page["number"], "title": page["title"], "url": page["url"]} for page in selected_pages],
            "raw": "\n---\n".join(raw_outputs),
            "attempts": section_attempts,
            "error": "",
            "warnings": warnings,
            "render": section["render"],
            "columns": section["columns"],
        }
        extracted.append(section_result)
        all_warnings.extend(f"{section['id']}: {warning}" for warning in warnings)
        if not section_result["valid"] and section["required"]:
            errors.append(f"{section['id']}: invalid evidence section")
    return {
        "enabled": True,
        "valid": not errors,
        "degraded": bool(all_warnings),
        "sections": extracted,
        "errors": errors,
        "warnings": all_warnings,
    }


def _build_synthesis_dossier(
    sections: list[dict[str, Any]], evidence_dossier: dict[str, Any], provider: Any,
    question: str, *, max_tokens: int, retries: int,
) -> tuple[list[dict[str, Any]], list[str]]:
    claims: list[dict[str, str]] = []
    for section in evidence_dossier.get("sections", []):
        for index, finding in enumerate(section.get("findings", [])):
            claims.append({
                "id": f"{section['id']}:{index}",
                "status": str(finding.get("status") or "not_found"),
                "text": str(finding.get("statement") if finding.get("status") == "supported" else finding.get("requirement") or ""),
            })
    by_id = {claim["id"]: claim for claim in claims}
    ledger = "\n".join(f"- [{claim['id']}] {claim['status'].upper()}: {claim['text']}" for claim in claims)
    output: list[dict[str, Any]] = []
    warnings: list[str] = []
    for section in sections:
        findings: list[dict[str, Any]] = []
        for requirement in section["requirements"]:
            deterministic = next(
                (item for item in section.get("deterministic_findings", []) if item["requirement"] == requirement),
                None,
            )
            if deterministic:
                refs = list(dict.fromkeys(ref for ref in deterministic["evidence_claims"] if ref in by_id))
                statuses = [by_id[ref]["status"] for ref in refs]
                limitation = bool(re.search(r"\b(?:cannot|can't|no|not|insufficient|unavailable|lack|missing|no permite|insuficiente|falta)\b", deterministic["statement"], re.I))
                positive_ok = len(refs) >= 2 and all(status == "supported" for status in statuses)
                limitation_ok = bool(refs) and any(status == "not_found" for status in statuses) and limitation
                if len(refs) != len(deterministic["evidence_claims"]) or not (positive_ok or limitation_ok):
                    warnings.append(f"{section['id']}: {requirement}: deterministic inference references invalid or incompatible claims")
                    findings.append({"requirement": requirement, "status": "not_found", "statement": "", "evidence_claims": refs, "evidence_pages": [], "quote": ""})
                else:
                    findings.append({"requirement": requirement, "status": "derived", "statement": deterministic["statement"], "evidence_claims": refs, "evidence_pages": [], "quote": "", "cells": deterministic["cells"]})
                continue
            base_prompt = "\n".join([
                "Derive exactly ONE transparent research inference from the supplied claim ledger. Do not use memory.",
                f"Section: {section['title']}", f"Requirement: {requirement}",
                "Use derived only when at least two supported claims justify a positive inference. One or more NOT_FOUND claims may justify only a clearly worded limitation.",
                'Return ONLY JSON: {"finding":{"status":"derived|not_found","statement":"...","evidence_claims":["section:0","section:1"]}}',
                "", f"Research question: {question}", "", "Claim ledger:", ledger,
            ])
            normalized: dict[str, Any] | None = None
            raw = ""
            error = "not attempted"
            for attempt in range(1, max(1, min(int(retries or 0) + 1, 3)) + 1):
                prompt = base_prompt if attempt == 1 else f"{base_prompt}\n\nRepair: {error}\nPrevious output: {raw}"
                try:
                    raw = _provider_text(provider, prompt, temperature=0, max_tokens=max_tokens, response_format={"type": "json_object"})
                    parsed, parse_error = _parse_json(raw)
                    finding = parsed.get("finding", {}) if parsed else {}
                    refs = list(dict.fromkeys(str(ref) for ref in finding.get("evidence_claims", []) if str(ref) in by_id))
                    statement = str(finding.get("statement") or "").strip()
                    statuses = [by_id[ref]["status"] for ref in refs]
                    limitation = bool(re.search(r"\b(?:cannot|can't|no|not|insufficient|unavailable|lack|missing|no permite|insuficiente|falta)\b", statement, re.I))
                    positive_ok = len(refs) >= 2 and all(status == "supported" for status in statuses)
                    limitation_ok = bool(refs) and any(status == "not_found" for status in statuses) and limitation
                    if str(finding.get("status") or "").lower() == "derived" and statement and (positive_ok or limitation_ok):
                        normalized = {"requirement": requirement, "status": "derived", "statement": statement, "evidence_claims": refs, "evidence_pages": [], "quote": ""}
                        break
                    if str(finding.get("status") or "").lower() == "not_found":
                        normalized = {"requirement": requirement, "status": "not_found", "statement": "", "evidence_claims": refs, "evidence_pages": [], "quote": ""}
                        break
                    error = parse_error or "invalid derived finding"
                except Exception as exc:  # pragma: no cover - provider-specific
                    error = str(exc)
            if normalized is None:
                warnings.append(f"{section['id']}: {requirement}: {error}")
                normalized = {"requirement": requirement, "status": "not_found", "statement": "", "evidence_claims": [], "evidence_pages": [], "quote": ""}
            findings.append(normalized)
        output.append({"id": section["id"], "title": section["title"], "required": section["required"], "valid": True, "derived": True, "findings": findings, "warnings": [], "render": section["render"], "columns": section["columns"]})
    return output, warnings


def _evidence_dossier_markdown(dossier: dict[str, Any], *, fallback: bool = False) -> str:
    def clean(value: Any) -> str:
        return (
            str(value or "").replace("â€™", "'").replace("â€˜", "'")
            .replace("â€œ", '"').replace("â€", '"')
            .replace("â€“", "–").replace("â€”", "—")
        )

    def table_cell(value: Any) -> str:
        return clean(value).replace("|", "\\|")

    blocks: list[str] = []
    for section in dossier.get("sections", []):
        lines = [f"## {section.get('title', section.get('id', 'Evidence'))}"]
        findings = list(section.get("findings", []))
        supported = [finding for finding in findings if finding.get("status") in {"supported", "derived"}]
        missing = [finding for finding in findings if finding.get("status") not in {"supported", "derived"}]
        if fallback and section.get("render") == "table" and section.get("columns"):
            columns = [table_cell(column) for column in section["columns"]]
            lines.append(f"| {' | '.join(columns)} |")
            lines.append(f"| {' | '.join('---' for _ in columns)} |")
            for finding in supported:
                cells = finding.get("cells", [])
                if isinstance(cells, list) and len(cells) == len(columns):
                    lines.append(f"| {' | '.join(table_cell(cell) for cell in cells)} |")
        elif fallback and section.get("render") == "paragraph":
            direct = [clean(finding.get("statement")) for finding in supported if finding.get("status") == "supported"]
            inferred = [clean(finding.get("statement")) for finding in supported if finding.get("status") == "derived"]
            if direct:
                lines.append(f"Direct evidence: {' '.join(direct)}")
            if inferred:
                lines.append(f"Inference: {' '.join(inferred)}")
        else:
            for finding in supported:
                if finding.get("status") == "supported":
                    prefix = "Direct evidence: " if fallback else f"SUPPORTED [{', '.join(f'P{number}' for number in finding.get('evidence_pages', []))}]: "
                else:
                    prefix = "Inference: " if fallback else f"DERIVED [{', '.join(finding.get('evidence_claims', []))}]: "
                lines.append(f"- {prefix}{clean(finding.get('statement', ''))}")
        for finding in missing:
            label = "Evidence not found" if fallback else "NOT FOUND"
            lines.append(f"- {label}: {clean(finding.get('requirement', ''))}")
        if not fallback:
            # Internal model-facing dossier always retains status and claim IDs.
            lines = [f"## {section.get('title', section.get('id', 'Evidence'))}"]
            for finding in findings:
                if finding.get("status") == "supported":
                    prefix = f"SUPPORTED [{', '.join(f'P{number}' for number in finding.get('evidence_pages', []))}]: "
                    lines.append(f"- {prefix}{clean(finding.get('statement', ''))}")
                elif finding.get("status") == "derived":
                    prefix = f"DERIVED [{', '.join(finding.get('evidence_claims', []))}]: "
                    lines.append(f"- {prefix}{clean(finding.get('statement', ''))}")
                else:
                    lines.append(f"- NOT FOUND: {clean(finding.get('requirement', ''))}")
        blocks.append("\n".join(lines))
    return "\n\n".join(blocks)


def run_web_grounded_answer(
    query: str = "",
    *,
    question: str = "",
    max_pages: int = 3,
    max_sub_queries: int = 3,
    search_queries: list[str] | None = None,
    max_results: int = 8,
    allow_hosts: list[str] | None = None,
    deny_hosts: list[str] | None = None,
    providers: list[str] | None = None,
    user_browser: Any | None = None,
    default_browser: Any | None = None,
    provider: Any | None = None,
    selection_provider: Any | None = None,
    model: str = "",
    transport: Any | None = None,
    format: str = "markdown",
    strict_grounding: bool = True,
    answer_retries: int = 1,
    search_concurrency: int = 1,
    search_delay_ms: int = 350,
    context_max_chars: int = 12000,
    seed_results: list[dict[str, Any]] | None = None,
    evidence_sections: list[dict[str, Any]] | None = None,
    evidence_max_tokens: int = 1200,
    evidence_retries: int = 1,
    evidence_context_max_chars: int = 12000,
    synthesis_sections: list[dict[str, Any]] | None = None,
    synthesis_max_tokens: int = 1200,
    synthesis_retries: int = 1,
    dossier_compose_mode: str = "model",
    dossier_fallback: bool = False,
    answer_validator: Any | None = None,
) -> dict[str, Any]:
    """Run live-search → provider-selection → fetch/Markdown → grounded answer."""
    try:
        from handoffkit.browser import ResearchPack, gather_web_research, research_prompt_section, web_search
    except ImportError as exc:  # pragma: no cover
        raise ImportError(
            "Install handoffkit with browser support to use run_web_grounded_answer()."
        ) from exc

    q = (query or question or "").strip()
    if not q:
        raise TypeError("run_web_grounded_answer requires query.")

    limit = max(1, min(int(max_pages or 3), 8))
    results_limit = max(limit, min(int(max_results or 8), 32))
    raw_search_queries = search_queries if isinstance(search_queries, list) else [q]
    query_limit = max(1, min(int(max_sub_queries or 3), 8))
    search_query_list: list[str] = []
    seen_search_queries: set[str] = set()
    for raw_search_query in raw_search_queries:
        search_query = str(raw_search_query or "").strip()
        key = search_query.lower()
        if not search_query or key in seen_search_queries:
            continue
        seen_search_queries.add(key)
        search_query_list.append(search_query)
        if len(search_query_list) >= query_limit:
            break
    if not search_query_list:
        search_query_list.append(q)
    safe_search_delay_ms = max(0, min(int(search_delay_ms or 0), 10000))
    # Keep live HTML providers sequential by default. Parallel bursts make
    # public search endpoints more likely to return a bot/rate-limit page.
    search_results = []
    for query_index, search_query in enumerate(search_query_list):
        if query_index and safe_search_delay_ms:
            time.sleep(safe_search_delay_ms / 1000)
        search_results.append(web_search(
            search_query,
            transport=transport,
            max_results=results_limit,
            timeout_ms=30000,
            allow_hosts=allow_hosts,
            deny_hosts=deny_hosts,
            providers=providers,
            user_browser=user_browser or default_browser,
        ))
    merged_search_hits: dict[str, dict[str, Any]] = {}
    search_errors: list[str] = []
    search_provider_codes: list[str] = []
    search_providers_used: list[str] = []
    search_engines: list[str] = []
    for query_index, search_result in enumerate(search_results):
        for provider_name in search_result.get("providers_used") or []:
            if provider_name not in search_providers_used:
                search_providers_used.append(provider_name)
        for provider_code in search_result.get("provider_codes") or []:
            if provider_code not in search_provider_codes:
                search_provider_codes.append(provider_code)
        if search_result.get("engine") and search_result["engine"] not in search_engines:
            search_engines.append(search_result["engine"])
        search_errors.extend(
            f"{search_query_list[query_index]}: {error}"
            for error in search_result.get("errors") or []
        )
        for hit_index, hit in enumerate(search_result.get("results") or []):
            url = str(hit.get("url") or "").strip()
            if not url:
                continue
            existing = merged_search_hits.get(url)
            if existing is not None:
                existing["query_matches"] += 1
                existing["score"] = max(float(existing["score"]), float(hit.get("score") or 0)) + 5
                if query_index not in existing["query_indexes"]:
                    existing["query_indexes"].append(query_index)
                continue
            merged_search_hits[url] = {
                "title": hit.get("title") or url,
                "url": url,
                "score": float(hit.get("score") or 0) + (results_limit - hit_index),
                "query_matches": 1,
                "query_indexes": [query_index],
            }
    for seed_index, raw_seed in enumerate(seed_results if isinstance(seed_results, list) else []):
        if not isinstance(raw_seed, dict):
            continue
        url = str(raw_seed.get("url") or "").strip()
        if not url:
            continue
        raw_source_queries = raw_seed.get("source_queries", raw_seed.get("sourceQueries", []))
        query_indexes = [
            index for index, query in enumerate(search_query_list)
            if any(query.lower() == str(source).strip().lower() for source in (raw_source_queries if isinstance(raw_source_queries, list) else []))
        ]
        existing = merged_search_hits.get(url)
        if existing:
            existing["score"] = 100000 - seed_index
            existing["seeded"] = True
            existing["query_indexes"] = list(dict.fromkeys([*existing["query_indexes"], *query_indexes]))
            existing["query_matches"] = max(int(existing["query_matches"]), len(existing["query_indexes"]), 1)
            continue
        merged_search_hits[url] = {
            "title": str(raw_seed.get("title") or url),
            "url": url,
            "score": 100000 - seed_index,
            "query_matches": max(1, len(query_indexes)),
            "query_indexes": query_indexes,
            "seeded": True,
        }
    ranked_merged_hits = sorted(
        merged_search_hits.values(),
        key=lambda item: (-float(item["score"]), -int(item["query_matches"]), str(item["url"])),
    )
    diversified_hits: list[dict[str, Any]] = []
    diversified_urls: set[str] = set()
    for query_index in range(len(search_query_list)):
        if len(diversified_hits) >= results_limit:
            break
        candidate = next(
            (
                item
                for item in ranked_merged_hits
                if query_index in item["query_indexes"] and item["url"] not in diversified_urls
            ),
            None,
        )
        if candidate is None:
            continue
        diversified_hits.append(candidate)
        diversified_urls.add(candidate["url"])
    for candidate in ranked_merged_hits:
        if len(diversified_hits) >= results_limit:
            break
        if candidate["url"] in diversified_urls:
            continue
        diversified_hits.append(candidate)
        diversified_urls.add(candidate["url"])
    merged_results = diversified_hits
    search = {
        "success": bool(merged_results),
        "query": q,
        "queries": search_query_list,
        "keywords": " ".join(search_query_list),
        "results": [
            {
                **{key: value for key, value in item.items() if key not in {"query_matches", "query_indexes"}},
                "source_queries": [search_query_list[i] for i in item.get("query_indexes", []) if i < len(search_query_list)],
            }
            for item in merged_results
        ],
        "count": len(merged_results),
        "providers_requested": list(search_results[0].get("providers_requested") or []) if search_results else list(providers or []),
        "providers_used": search_providers_used,
        "errors": search_errors,
        "provider_codes": search_provider_codes,
        "engine": "+".join(search_engines),
        "error_code": "" if merged_results else (search_provider_codes[0] if search_provider_codes else "no_results"),
        "error": "" if merged_results else "no search results",
    }
    excluded_urls: list[str] = []
    candidates = []
    for index, item in enumerate(search.get("results") or []):
        url = str(item.get("url") or "")
        if not url:
            continue
        if not _is_fetchable_web_candidate(url):
            excluded_urls.append(url)
            continue
        candidates.append({
            "rank": index + 1,
            "title": item.get("title", ""),
            "url": url,
            "source_queries": list(item.get("source_queries") or []),
        })
    search_markdown = _candidate_markdown(q, candidates)
    planner = selection_provider or provider
    selection: dict[str, Any] = {
        "mode": "provider" if planner else "ranked_fallback",
        "raw": "",
        "repair_raw": "",
        "error": "",
        "repair_error": "",
        "selected_urls": [],
        "valid": False,
        "search_error_code": search.get("error_code", ""),
    }
    if planner and candidates:
        planner_prompt = "\n".join(
            [
                "Selecciona las páginas actuales que el agente debe leer.",
                "Usa exclusivamente el índice Markdown. Copia URLs literalmente; no inventes URLs.",
                f"Elige como máximo {limit} páginas y cubre la consulta completa.",
                'Responde SOLO JSON válido: {"selected_urls":["URL exacta"]}.',
                "No uses objetos ni explicaciones.",
                (
                    "Prioriza cobertura de consultas distintas cuando sea posible. "
                    f"Consultas: {' | '.join(search_query_list)}"
                    if len(search_query_list) > 1
                    else ""
                ),
                "",
                f"Consulta: {q}",
                "",
                search_markdown,
            ]
        )
        selection["raw"] = _provider_text(
            planner,
            planner_prompt,
            temperature=0,
            max_tokens=500,
            response_format={"type": "json_object"},
        )
        parsed, parse_error = _parse_json(selection["raw"])
        selection["selected_urls"] = _ensure_query_coverage(
            _select_urls(parsed, candidates, limit), candidates, search_query_list, limit
        )
        if not selection["selected_urls"] and answer_retries > 0:
            repair_prompt = "\n".join(
                [
                    "La salida anterior no cumplió el contrato.",
                    'Devuelve SOLO JSON válido con esta forma exacta: {"selected_urls":["URL exacta"]}.',
                    f"Elige hasta {limit} URLs copiadas literalmente del índice; no incluyas explicación.",
                    "",
                    search_markdown,
                ]
            )
            selection["repair_raw"] = _provider_text(
                planner,
                repair_prompt,
                temperature=0,
                max_tokens=500,
                response_format={"type": "json_object"},
            )
            parsed, parse_error = _parse_json(selection["repair_raw"])
            selection["repair_error"] = parse_error
            selection["selected_urls"] = _ensure_query_coverage(
                _select_urls(parsed, candidates, limit), candidates, search_query_list, limit
            )
        selection["error"] = parse_error
    else:
        selection["selected_urls"] = _ensure_query_coverage(
            [candidate["url"] for candidate in candidates[:limit]],
            candidates,
            search_query_list,
            limit,
        )
    selection["valid"] = bool(search.get("success") and search_markdown and selection["selected_urls"])

    if selection["valid"]:
        pack = gather_web_research(
            q,
            seed_only=True,
            auto_search=False,
            seed_urls=list(selection["selected_urls"]),
            max_pages=limit,
            max_sub_queries=max_sub_queries,
            allow_hosts=allow_hosts,
            deny_hosts=deny_hosts,
            providers=providers,
            user_browser=user_browser or default_browser,
            transport=transport,
            format=format,
            context_max_chars=context_max_chars,
        )
        expected_pages = len(selection["selected_urls"])
        fallback_urls = [
            candidate["url"]
            for candidate in candidates
            if candidate["url"] and candidate["url"] not in selection["selected_urls"]
        ]
        if pack.pages_ok < expected_pages and fallback_urls:
            fetched_urls = {
                str(getattr(page, "url", "") or (page.get("url") if isinstance(page, dict) else ""))
                for page in pack.pages
            }
            retry_urls = _fallback_query_coverage(
                candidates,
                selection["selected_urls"],
                fetched_urls,
                search_query_list,
                limit,
            )
            retry_pack = gather_web_research(
                q,
                seed_only=True,
                auto_search=False,
                seed_urls=retry_urls,
                max_pages=limit,
                max_sub_queries=max_sub_queries,
                allow_hosts=allow_hosts,
                deny_hosts=deny_hosts,
                providers=providers,
                user_browser=user_browser or default_browser,
                transport=transport,
                format=format,
                context_max_chars=context_max_chars,
            )
            if retry_pack.pages_ok > pack.pages_ok:
                pack = retry_pack
            selection["fallback_urls"] = fallback_urls
            selection["selected_urls"] = retry_urls
            selection["fallback_used"] = True
        selection["expected_pages"] = len(selection["selected_urls"])
        selection["fetched_pages"] = pack.pages_ok
        selection["fetch_complete"] = pack.pages_ok >= len(selection["selected_urls"])
    else:
        pack = ResearchPack(
            enabled=True,
            used=False,
            error=search.get("error") or "no valid URLs selected",
            mode="search_then_select_then_fetch",
            transport=getattr(transport, "name", lambda: "")(),
            metadata={"selection_failed": True},
        )
    pack.metadata.update(
        {
            "answer_flow": "live_search_markdown_select_explore_markdown_answer",
            "search_queries": list(search_query_list),
            "search_results_markdown": search_markdown,
            "search_count": int(search.get("count") or 0),
            "search_concurrency": 1,
            "search_delay_ms": safe_search_delay_ms,
            "seed_results_count": len(seed_results) if isinstance(seed_results, list) else 0,
            "search_error_code": search.get("error_code", ""),
            "search_provider_codes": list(search.get("provider_codes") or []),
            "selected_urls": list(selection["selected_urls"]),
            "selected_urls_valid": bool(selection["valid"]),
            "selection_mode": selection["mode"],
            "planner_raw": selection["raw"],
            "planner_repair_raw": selection["repair_raw"],
            "planner_error": selection["error"],
            "excluded_urls": excluded_urls,
            "expected_pages": int(selection.get("expected_pages", 0)),
            "fetched_pages": int(selection.get("fetched_pages", 0)),
            "fetch_complete": bool(selection.get("fetch_complete", False)),
        }
    )
    section = research_prompt_section(pack)
    answer = ""
    answer_raw = ""
    answer_error = ""
    coverage = False
    validator_passed = True
    validator_error = ""
    attempts = 0
    normalized_evidence_sections = _normalize_evidence_sections(evidence_sections)
    evidence_dossier = (
        _build_evidence_dossier(
            normalized_evidence_sections,
            list(pack.pages),
            candidates,
            provider,
            question or q,
            max_tokens=evidence_max_tokens,
            retries=evidence_retries,
            context_max_chars=evidence_context_max_chars,
        )
        if provider is not None and selection.get("fetch_complete", False) and normalized_evidence_sections
        else {"enabled": False, "valid": True, "degraded": False, "sections": [], "errors": [], "warnings": []}
    )
    normalized_synthesis_sections = _normalize_evidence_sections(synthesis_sections)
    if evidence_dossier["enabled"] and evidence_dossier["valid"] and provider is not None and normalized_synthesis_sections:
        synthesis_findings, synthesis_warnings = _build_synthesis_dossier(
            normalized_synthesis_sections,
            evidence_dossier,
            provider,
            question or q,
            max_tokens=synthesis_max_tokens,
            retries=synthesis_retries,
        )
        evidence_dossier["sections"].extend(synthesis_findings)
        evidence_dossier["warnings"].extend(synthesis_warnings)
        evidence_dossier["degraded"] = bool(evidence_dossier["degraded"] or synthesis_warnings)
    deterministic_dossier = evidence_dossier["enabled"] and dossier_compose_mode.lower() == "deterministic"
    if deterministic_dossier and evidence_dossier["valid"]:
        answer = _evidence_dossier_markdown(evidence_dossier, fallback=True)
        answer_raw = answer
        coverage = True
        if answer_validator is not None and answer:
            try:
                verdict = answer_validator(
                    {"answer": answer, "query": q, "pages": pack.pages, "research": pack, "evidence_dossier": evidence_dossier}
                )
                validator_passed = bool(verdict.get("valid")) if isinstance(verdict, dict) else bool(verdict)
                if isinstance(verdict, dict) and isinstance(verdict.get("answer"), str):
                    answer = verdict["answer"].strip()
                if not validator_passed:
                    validator_error = str(verdict.get("error") or "answer validator rejected deterministic dossier") if isinstance(verdict, dict) else "answer validator rejected deterministic dossier"
            except Exception as exc:  # pragma: no cover - caller validator
                validator_passed = False
                validator_error = str(exc)
    elif provider is not None and pack.pages_ok > 0 and selection.get("fetch_complete", False) and evidence_dossier["valid"]:
        evidence = _evidence_dossier_markdown(evidence_dossier) if evidence_dossier["enabled"] else _page_evidence(pack)
        prompt = "\n".join(
            [
                "Usa exclusivamente el dossier estructurado. Incluye cada hallazgo SUPPORTED y conserva cada NOT FOUND como límite explícito."
                if evidence_dossier["enabled"]
                else "Lee TODAS las páginas Markdown recuperadas y responde solo con esos datos.",
                "No hagas otra búsqueda ni uses memoria externa.",
                "Si una subpregunta no está respaldada por las páginas, di explícitamente que la evidencia disponible no permite responderla.",
                "No afirmes que un método es dominante, más usado o preferido sin una fuente recuperada que mida esa adopción.",
                "No atribuyas a un artículo un mecanismo que su página no describa literalmente.",
                'Devuelve SOLO JSON válido: {"answer":"respuesta Markdown sin URLs ni citas","evidence_pages":"all"}.',
                'evidence_pages debe ser "all" después de leer todas las páginas. Si falta un dato, indícalo.',
                "Cubre explÃ­citamente Goodman-Bacon, Callaway-Sant'Anna, Sun-Abraham, Borusyak-Jaravel-Spiess, did2s y Roth/Rambachan-Roth; si la evidencia de alguno falta, declÃ¡ralo como no demostrado.",
                "No agregues URLs, fuentes ni capacidades no demostradas.",
                "",
                f"Pregunta: {question or q}",
                "",
                evidence or "[No hay evidencia]",
            ]
        )
        for attempts in range(1, max(1, min(int(answer_retries or 0) + 1, 3)) + 1):
            retry_prompt = prompt
            if attempts > 1:
                retry_prompt = "\n".join(
                    [
                        "Corrige la salida anterior: incumplió JSON o no cubrió todas las páginas.",
                        'evidence_pages debe ser exactamente "all" después de leer todas las páginas.',
                        "No agregues URLs ni hechos fuera de las páginas.",
                        "",
                        prompt,
                        "",
                        f"Salida anterior: {answer_raw}",
                    ]
                )
            answer_raw = _provider_text(
                provider,
                retry_prompt,
                temperature=0.1,
                max_tokens=1600,
                response_format={"type": "json_object"},
            )
            answer, coverage, answer_error = _parse_answer(answer_raw, pack.pages_ok, pack.pages)
            validator_passed = True
            validator_error = ""
            if answer_validator is not None and answer and not answer_error:
                try:
                    verdict = answer_validator(
                        {"answer": answer, "query": q, "pages": pack.pages, "research": pack, "evidence_dossier": evidence_dossier}
                    )
                    validator_passed = bool(verdict.get("valid")) if isinstance(verdict, dict) else bool(verdict)
                    if not validator_passed:
                        validator_error = (
                            str(verdict.get("error") or "answer validator rejected output")
                            if isinstance(verdict, dict)
                            else "answer validator rejected output"
                        )
                except Exception as exc:  # pragma: no cover - caller validator
                    validator_passed = False
                    validator_error = str(exc)
            if answer and (not strict_grounding or coverage) and not answer_error and validator_passed:
                break
    if (
        (not answer or answer_error or not validator_passed or (strict_grounding and not coverage))
        and dossier_fallback
        and evidence_dossier["enabled"]
        and evidence_dossier["valid"]
    ):
        fallback_answer = _evidence_dossier_markdown(evidence_dossier, fallback=True)
        fallback_valid = bool(fallback_answer)
        answer = fallback_answer
        if answer_validator is not None and fallback_answer:
            try:
                verdict = answer_validator(
                    {"answer": fallback_answer, "query": q, "pages": pack.pages, "research": pack, "evidence_dossier": evidence_dossier}
                )
                fallback_valid = bool(verdict.get("valid")) if isinstance(verdict, dict) else bool(verdict)
                if isinstance(verdict, dict) and isinstance(verdict.get("answer"), str):
                    answer = verdict["answer"].strip()
                validator_error = "" if fallback_valid else str(
                    verdict.get("error") if isinstance(verdict, dict) else "answer validator rejected dossier fallback"
                )
            except Exception as exc:  # pragma: no cover - caller validator
                fallback_valid = False
                validator_error = str(exc)
        if fallback_valid:
            coverage = True
            answer_error = ""
            validator_passed = True
            validator_error = ""
        else:
            answer = ""
            validator_passed = False
    answer_valid = bool(
        answer
        and pack.pages_ok > 0
        and (not strict_grounding or coverage)
        and not answer_error
        and validator_passed
    )
    return {
        "success": bool(selection["valid"] and selection.get("fetch_complete", False) and pack.pages_ok > 0 and (provider is None or answer_valid)),
        "query": q,
        "research": pack.to_dict(),
        "prompt_section": section,
        "answer": answer if answer_valid else "",
        "model": model or getattr(provider, "model", "") or "",
        "error_code": (
            "web_answer_selection_failed"
            if not selection["valid"]
            else "web_answer_no_pages"
            if pack.pages_ok == 0
            else "web_answer_incomplete_evidence"
            if not selection.get("fetch_complete", False)
            else "web_answer_evidence_extraction_failed"
            if not evidence_dossier["valid"]
            else "web_answer_grounding_failed"
            if provider is not None and not answer_valid
            else ""
        ),
        "selection": {
            **selection,
            "candidates": candidates,
            "search_success": bool(search.get("success")),
            "search_error_code": search.get("error_code", ""),
            "search_provider_codes": list(search.get("provider_codes") or []),
            "search_errors": list(search.get("errors") or []),
        },
        "answer_audit": {
            "valid": answer_valid,
            "strict_grounding": bool(strict_grounding),
            "pages_ok": pack.pages_ok,
            "expected_pages": int(selection.get("expected_pages", 0)),
            "evidence_complete": bool(selection.get("fetch_complete", False)),
            "coverage": coverage,
            "attempts": attempts,
            "raw": answer_raw,
            "error": answer_error or validator_error,
            "validator_passed": validator_passed,
            "evidence_dossier_enabled": evidence_dossier["enabled"],
            "evidence_dossier_valid": evidence_dossier["valid"],
            "evidence_dossier_errors": evidence_dossier["errors"],
            "evidence_dossier_degraded": evidence_dossier["degraded"],
            "evidence_dossier_warnings": evidence_dossier["warnings"],
        },
        "evidence_dossier": evidence_dossier,
    }
