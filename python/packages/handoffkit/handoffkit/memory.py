"""Agent memory plus structured memory stores."""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _now() -> str:
    """Return current UTC timestamp."""
    return datetime.now(timezone.utc).isoformat()


@dataclass
class MemoryEntry:
    """One memory entry created by an agent run."""

    role: str
    content: str
    metadata: dict[str, Any] = field(default_factory=dict)
    created_at: str = field(default_factory=_now)


@dataclass
class AgentMemory:
    """Small append-only memory used by agents."""

    entries: list[MemoryEntry] = field(default_factory=list)

    def add(self, role: str, content: str, **metadata: Any) -> MemoryEntry:
        """Add an entry and return it."""
        entry = MemoryEntry(role=role, content=content, metadata=metadata)
        self.entries.append(entry)
        return entry

    def last(self, count: int = 5) -> list[MemoryEntry]:
        """Return the most recent entries."""
        if count <= 0:
            return []
        return self.entries[-count:]

    def to_text(self, count: int = 5) -> str:
        """Render recent memory entries as compact text."""
        return "\n".join(f"{entry.role}: {entry.content}" for entry in self.last(count))

    def clear(self) -> None:
        """Remove all entries."""
        self.entries.clear()


@dataclass
class MemoryItem:
    """Structured memory item stored across agent runs."""

    content: str
    kind: str = "note"
    tags: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)
    id: str = field(default_factory=lambda: uuid.uuid4().hex)
    created_at: str = field(default_factory=_now)
    updated_at: str | None = None

    def to_dict(self) -> dict[str, Any]:
        """Serialize this memory item."""
        return {
            "id": self.id,
            "content": self.content,
            "kind": self.kind,
            "tags": self.tags,
            "metadata": self.metadata,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }

    def to_json(self, *, indent: int | None = 2) -> str:
        """Serialize this memory item as JSON."""
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=indent)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> MemoryItem:
        """Create a memory item from a dictionary."""
        return cls(
            id=str(data.get("id") or uuid.uuid4().hex),
            content=str(data.get("content", "")),
            kind=str(data.get("kind", "note")),
            tags=list(data.get("tags") or []),
            metadata=dict(data.get("metadata") or {}),
            created_at=str(data.get("created_at") or _now()),
            updated_at=data.get("updated_at"),
        )

    @classmethod
    def from_json(cls, value: str) -> MemoryItem:
        """Create a memory item from JSON."""
        data = json.loads(value)
        if not isinstance(data, dict):
            raise ValueError("MemoryItem JSON must decode to an object.")
        return cls.from_dict(data)


class MemoryStore:
    """Deterministic in-memory store for structured memories."""

    def __init__(self, items: list[MemoryItem] | None = None) -> None:
        self._items: dict[str, MemoryItem] = {}
        for item in items or []:
            self._items[item.id] = item

    def add(
        self,
        content: str,
        *,
        kind: str = "note",
        tags: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> MemoryItem:
        """Add one memory item."""
        item = MemoryItem(
            content=content,
            kind=kind,
            tags=tags or [],
            metadata=metadata or {},
        )
        self._items[item.id] = item
        self._save()
        return item

    def list(self) -> list[MemoryItem]:
        """Return all memory items in insertion order."""
        return list(self._items.values())

    def get(self, memory_id: str) -> MemoryItem | None:
        """Return one memory item by id."""
        return self._items.get(memory_id)

    def search(self, query: str, *, limit: int | None = None) -> list[MemoryItem]:
        """Search memories with deterministic keyword scoring."""
        terms = [term.lower() for term in query.split() if term.strip()]
        scored: list[tuple[int, MemoryItem]] = []
        for item in self._items.values():
            haystack = " ".join(
                [
                    item.content,
                    item.kind,
                    " ".join(item.tags),
                    json.dumps(item.metadata, default=str),
                ]
            ).lower()
            score = sum(haystack.count(term) for term in terms)
            if score > 0:
                scored.append((score, item))
        scored.sort(key=lambda entry: (-entry[0], entry[1].created_at, entry[1].id))
        results = [item for _, item in scored]
        return results[:limit] if limit is not None else results

    def delete(self, memory_id: str) -> bool:
        """Delete one memory item."""
        existed = self._items.pop(memory_id, None) is not None
        if existed:
            self._save()
        return existed

    def clear(self) -> None:
        """Delete all memory items."""
        self._items.clear()
        self._save()

    def _save(self) -> None:
        """Persist memory items. In-memory store is a no-op."""


class JsonMemoryStore(MemoryStore):
    """JSON-backed memory store."""

    def __init__(self, path: str) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            self.path.write_text("[]", encoding="utf-8")
        items = self._load_items()
        super().__init__(items)

    def _load_items(self) -> list[MemoryItem]:
        raw = self.path.read_text(encoding="utf-8").strip()
        if not raw:
            return []
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ValueError(f"Invalid JSON memory store: {self.path}") from exc
        if not isinstance(data, list):
            raise ValueError(f"JSON memory store must contain a list: {self.path}")
        return [MemoryItem.from_dict(item) for item in data if isinstance(item, dict)]

    def _save(self) -> None:
        self.path.write_text(
            json.dumps([item.to_dict() for item in self.list()], ensure_ascii=False, indent=2),
            encoding="utf-8",
        )


@dataclass
class MemoryReport:
    """Report describing memory/context usage."""

    memories_stored: list[MemoryItem] = field(default_factory=list)
    searches_executed: list[str] = field(default_factory=list)
    context_documents_used: list[str] = field(default_factory=list)
    final_result: str = ""

    def to_dict(self) -> dict[str, Any]:
        """Serialize report."""
        return {
            "memories_stored": [item.to_dict() for item in self.memories_stored],
            "searches_executed": self.searches_executed,
            "context_documents_used": self.context_documents_used,
            "final_result": self.final_result,
        }

    def to_json(self, *, indent: int | None = 2) -> str:
        """Serialize report as JSON."""
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=indent)

    def to_markdown(self) -> str:
        """Serialize report as Markdown."""
        memories = "\n".join(f"- {item.kind}: {item.content}" for item in self.memories_stored)
        searches = "\n".join(f"- {item}" for item in self.searches_executed)
        docs = "\n".join(f"- {item}" for item in self.context_documents_used)
        return (
            "# Memory Report\n\n"
            f"## Memories Stored\n\n{memories or '- none'}\n\n"
            f"## Searches Executed\n\n{searches or '- none'}\n\n"
            f"## Context Documents Used\n\n{docs or '- none'}\n\n"
            f"## Final Result\n\n{self.final_result}\n"
        )
