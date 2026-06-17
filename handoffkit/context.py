"""Project context indexing and retrieval."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from handoffkit.memory import MemoryItem

IGNORED_DIRS = {
    ".git",
    "node_modules",
    "dist",
    "build",
    "target",
    "__pycache__",
    ".venv",
    "venv",
    ".ruff_cache",
}
DEFAULT_EXTENSIONS = {".py", ".md", ".toml", ".json", ".txt", ".yaml", ".yml"}


@dataclass
class ContextDocument:
    """One indexed project document."""

    path: str
    content: str
    summary: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Serialize document."""
        return {
            "path": self.path,
            "content": self.content,
            "summary": self.summary,
            "metadata": self.metadata,
        }

    def to_json(self, *, indent: int | None = 2) -> str:
        """Serialize document as JSON."""
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=indent)


class ProjectIndexer:
    """Index text files from a local project folder."""

    def __init__(
        self,
        root: str = ".",
        *,
        allowed_extensions: set[str] | None = None,
        max_file_size: int = 64_000,
    ) -> None:
        self.root = Path(root)
        self.allowed_extensions = allowed_extensions or DEFAULT_EXTENSIONS
        self.max_file_size = max_file_size

    def index(self) -> list[ContextDocument]:
        """Index project files into context documents."""
        docs: list[ContextDocument] = []
        for path in sorted(self.root.rglob("*")):
            if not path.is_file() or not self._is_allowed(path):
                continue
            try:
                content = path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                continue
            relative = str(path.relative_to(self.root))
            lines = content.splitlines()
            docs.append(
                ContextDocument(
                    path=relative,
                    content=content,
                    summary=self._summarize(path, content),
                    metadata={
                        "extension": path.suffix,
                        "size": path.stat().st_size,
                        "line_count": len(lines),
                    },
                )
            )
        return docs

    def _is_allowed(self, path: Path) -> bool:
        if any(part in IGNORED_DIRS or part.endswith(".egg-info") for part in path.parts):
            return False
        if path.suffix not in self.allowed_extensions:
            return False
        try:
            return path.stat().st_size <= self.max_file_size
        except OSError:
            return False

    def _summarize(self, path: Path, content: str) -> str:
        lines = content.splitlines()
        preview = " ".join(line.strip() for line in lines[:3] if line.strip())
        return (
            f"{path.name}: {len(lines)} lines, {len(content.encode('utf-8'))} bytes, "
            f"extension {path.suffix}. {preview}"
        ).strip()


class ContextRetriever:
    """Keyword-based context retriever."""

    def __init__(self, documents: list[ContextDocument]) -> None:
        self.documents = documents

    def search(self, query: str, *, limit: int = 5) -> list[ContextDocument]:
        """Return relevant documents ranked by simple keyword matches."""
        terms = [term.lower() for term in query.split() if term.strip()]
        scored: list[tuple[int, ContextDocument]] = []
        for doc in self.documents:
            haystack = f"{doc.path}\n{doc.summary}\n{doc.content}".lower()
            score = sum(haystack.count(term) for term in terms)
            if score > 0:
                scored.append((score, doc))
        scored.sort(key=lambda item: (-item[0], item[1].path))
        return [doc for _, doc in scored[:limit]]


@dataclass
class ContextPack:
    """Context bundle passed to agents."""

    query: str
    documents: list[ContextDocument] = field(default_factory=list)
    memories: list[MemoryItem] = field(default_factory=list)
    summary: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Serialize context pack."""
        return {
            "query": self.query,
            "documents": [doc.to_dict() for doc in self.documents],
            "memories": [memory.to_dict() for memory in self.memories],
            "summary": self.summary,
            "metadata": self.metadata,
        }

    def to_json(self, *, indent: int | None = 2) -> str:
        """Serialize context pack as JSON."""
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=indent)

    def to_markdown(self) -> str:
        """Serialize context pack as Markdown."""
        docs = "\n".join(f"- `{doc.path}`: {doc.summary}" for doc in self.documents)
        memories = "\n".join(
            f"- `{memory.kind}` {memory.content}" for memory in self.memories
        )
        return (
            "# Context Pack\n\n"
            f"## Query\n\n{self.query}\n\n"
            f"## Summary\n\n{self.summary or 'No summary.'}\n\n"
            f"## Documents\n\n{docs or '- none'}\n\n"
            f"## Memories\n\n{memories or '- none'}\n"
        )


@dataclass
class ContextRunResult:
    """Result returned by Agent.run_with_context."""

    final_output: str
    context_used: ContextPack | None = None
    memories_used: list[MemoryItem] = field(default_factory=list)
    success: bool = True

    def to_dict(self) -> dict[str, Any]:
        """Serialize context run result."""
        return {
            "final_output": self.final_output,
            "context_used": self.context_used.to_dict() if self.context_used else None,
            "memories_used": [item.to_dict() for item in self.memories_used],
            "success": self.success,
        }
