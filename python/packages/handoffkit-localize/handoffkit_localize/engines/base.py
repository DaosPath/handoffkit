"""Engine plugin interface."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Protocol


@dataclass
class AnalyzeReport:
    engine: str
    confidence: float
    game_root: str
    data_dirs: list[str] = field(default_factory=list)
    extractable_globs: list[str] = field(default_factory=list)
    skip_globs: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    sample_files: list[str] = field(default_factory=list)
    recommended_pipeline: list[str] = field(default_factory=list)
    supports_apply: bool = False
    llm_summary: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class StringRow:
    id: str
    text: str
    files: list[str]
    chars: int


class GameEngine(Protocol):
    name: str

    def detect(self, root: Path) -> AnalyzeReport | None: ...

    def extract(self, root: Path) -> list[StringRow]: ...

    def apply(
        self,
        root: Path,
        lang: str,
        mapping: dict[str, str],
        *,
        source_lang: str = "en",
    ) -> dict[str, Any]: ...
