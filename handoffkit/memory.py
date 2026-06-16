"""Simple in-memory agent memory."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any


@dataclass
class MemoryEntry:
    """One memory entry created by an agent run."""

    role: str
    content: str
    metadata: dict[str, Any] = field(default_factory=dict)
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


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
