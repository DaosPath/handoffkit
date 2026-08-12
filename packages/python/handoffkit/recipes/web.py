"""Web-grounded research recipes (optional ``handoffkit.browser``)."""

from __future__ import annotations

from typing import Any


def run_web_grounded_answer(
    query: str = "",
    *,
    question: str = "",
    max_pages: int = 3,
    max_sub_queries: int = 3,
    allow_hosts: list[str] | None = None,
    deny_hosts: list[str] | None = None,
    providers: list[str] | None = None,
    user_browser: Any | None = None,
    provider: Any | None = None,
    model: str = "",
    transport: Any | None = None,
    format: str = "markdown",
) -> dict[str, Any]:
    """Grounded Q&A: browser research + optional LLM answer.

    Mirrors ``runWebGroundedAnswer`` in ``@handoffkit/recipes``.
    """
    try:
        from handoffkit.browser import gather_web_research, research_prompt_section
    except ImportError as exc:  # pragma: no cover
        raise ImportError(
            "Install handoffkit with browser support to use run_web_grounded_answer()."
        ) from exc

    q = (query or question or "").strip()
    if not q:
        raise TypeError("run_web_grounded_answer requires query.")

    pack = gather_web_research(
        q,
        max_pages=max_pages,
        max_sub_queries=max_sub_queries,
        allow_hosts=allow_hosts,
        deny_hosts=deny_hosts,
        providers=providers,
        user_browser=user_browser,
        transport=transport,
        format=format,
    )
    section = research_prompt_section(pack)
    answer = ""
    if provider is not None:
        prompt = (
            "Answer using ONLY the web research below. Cite URLs. Be concise.\n\n"
            f"Question: {question or q}\n\n"
            f"{section or '(no sources)'}"
        )
        if hasattr(provider, "generate"):
            answer = str(provider.generate(prompt) or "").strip()
        elif hasattr(provider, "agenerate"):
            import asyncio

            answer = str(asyncio.run(provider.agenerate(prompt)) or "").strip()
        elif callable(provider):
            answer = str(provider(prompt) or "").strip()

    return {
        "success": pack.pages_ok > 0,
        "query": q,
        "research": pack.to_dict(),
        "prompt_section": section,
        "answer": answer,
        "model": model or getattr(provider, "model", "") or "",
    }
