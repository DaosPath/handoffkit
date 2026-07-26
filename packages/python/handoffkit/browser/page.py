"""README-oriented page markdown helpers."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from handoffkit.browser.html_extract import extract_page, html_to_markdown
from handoffkit.browser.types import ExploreResult
from handoffkit.browser.util import smart_truncate


@dataclass
class PageMarkdown:
    url: str = ""
    final_url: str = ""
    title: str = ""
    markdown: str = ""
    text: str = ""
    excerpt: str = ""
    status: int = 0
    success: bool = False
    error: str = ""
    links: list[dict[str, str]] = field(default_factory=list)
    fetched_at: str = ""
    format: str = "markdown"
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "url": self.url,
            "final_url": self.final_url,
            "title": self.title,
            "markdown": self.markdown,
            "text": self.text,
            "excerpt": self.excerpt,
            "status": self.status,
            "success": self.success,
            "error": self.error,
            "links": list(self.links),
            "fetched_at": self.fetched_at,
            "format": self.format,
            "markdown_chars": len(self.markdown),
            "metadata": dict(self.metadata),
        }

    def to_readme(self, *, max_chars: int = 60000) -> str:
        lines = [
            f"# {self.title or 'Page'}",
            "",
            f"Source: {self.final_url or self.url}",
            "",
            smart_truncate(self.markdown or self.text or "", max_chars),
        ]
        return "\n".join(lines).strip() + "\n"

    @classmethod
    def from_explore_result(
        cls,
        result: ExploreResult,
        *,
        max_chars: int = 60000,
        format: str = "markdown",
    ) -> PageMarkdown:
        md = smart_truncate(result.markdown or result.text or "", max_chars)
        excerpt = (result.text or md)[:400]
        page = cls(
            url=result.start_url,
            final_url=result.final_url or result.start_url,
            title=result.title,
            markdown=md,
            text=result.text,
            excerpt=excerpt,
            status=result.steps[0].status if result.steps else 0,
            success=result.success,
            error=result.error,
            links=[l.to_dict() for l in result.links],
            fetched_at=datetime.now(timezone.utc).isoformat(),
            format=format if format in {"markdown", "readme"} else "markdown",
            metadata={"pages_fetched": result.pages_fetched},
        )
        if page.format == "readme" and page.success:
            page.markdown = page.to_readme(max_chars=max_chars)
        return page


def page_from_html(
    html_src: str,
    *,
    url: str = "",
    status: int = 200,
    max_markdown_chars: int = 60000,
) -> PageMarkdown:
    extracted = extract_page(
        html_src,
        base_url=url,
        max_markdown_chars=max_markdown_chars,
        emit_markdown=True,
    )
    md = extracted["markdown"]
    return PageMarkdown(
        url=url,
        final_url=url,
        title=extracted["title"],
        markdown=md,
        text=extracted["text"],
        excerpt=(extracted["text"] or md)[:400],
        status=status,
        success=True,
        links=[l.to_dict() for l in extracted["links"]],
        fetched_at=datetime.now(timezone.utc).isoformat(),
    )


def format_readme_bundle(pages: list[PageMarkdown], *, title: str = "Research Bundle") -> str:
    parts = [f"# {title}", ""]
    for i, page in enumerate(pages, 1):
        parts.append(f"## {i}. {page.title or page.url}")
        parts.append("")
        parts.append(f"Source: {page.final_url or page.url}")
        parts.append("")
        parts.append(smart_truncate(page.markdown or page.text or "", 20000))
        parts.append("")
    return "\n".join(parts).strip() + "\n"


def to_readme_markdown(*, title: str, url: str, markdown: str) -> str:
    return f"# {title or 'Page'}\n\nSource: {url}\n\n{markdown or ''}\n".strip() + "\n"


def html_as_markdown(html_src: str, *, base_url: str = "", max_chars: int = 60000) -> str:
    return html_to_markdown(html_src, base_url=base_url, max_chars=max_chars)
