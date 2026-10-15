"""Generic text/json/csv scrape."""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

from handoffkit_localize.engines.base import AnalyzeReport, StringRow

SKIP_DIRS = {
    ".git",
    "node_modules",
    "__pycache__",
    ".venv",
    "venv",
    "bin",
    "obj",
    "Library",
    "Temp",
}


def _sid(s: str) -> str:
    return hashlib.sha1(s.encode("utf-8")).hexdigest()[:12]


class GenericEngine:
    name = "generic"

    def detect(self, root: Path) -> AnalyzeReport | None:
        # Always available as fallback — low confidence
        samples = []
        for pat in ("*.json", "*.txt", "*.csv", "*.md"):
            for p in list(root.rglob(pat))[:5]:
                if not any(x in p.parts for x in SKIP_DIRS):
                    samples.append(str(p.relative_to(root)))
        return AnalyzeReport(
            engine="generic-text",
            confidence=0.3 if samples else 0.1,
            game_root=str(root.resolve()),
            extractable_globs=["**/*.{json,txt,csv,md}"],
            skip_globs=[f"**/{d}/**" for d in sorted(SKIP_DIRS)],
            notes=[
                "Unknown engine — best-effort text scrape.",
                "Point at a clearer game package when possible.",
            ],
            sample_files=samples[:15],
            recommended_pipeline=["extract", "translate", "apply sidecar JSON"],
            supports_apply=True,
        )

    def extract(self, root: Path) -> list[StringRow]:
        seen: dict[str, StringRow] = {}

        def add(s: str, rel: str) -> None:
            s = s.strip()
            if len(s) < 2:
                return
            if not re.search(r"[A-Za-z\u00C0-\u024F\u3400-\u9fff]", s):
                return
            sid = _sid(s)
            if sid not in seen:
                seen[sid] = StringRow(id=sid, text=s, files=[rel], chars=len(s))

        for fp in root.rglob("*"):
            if not fp.is_file():
                continue
            if any(x in fp.parts for x in SKIP_DIRS):
                continue
            if fp.suffix.lower() not in {".json", ".txt", ".csv", ".md"}:
                continue
            if fp.stat().st_size > 2_000_000:
                continue
            try:
                rel = str(fp.relative_to(root))
                text = fp.read_text(encoding="utf-8", errors="replace")
            except Exception:
                continue
            if fp.suffix.lower() == ".json":
                try:
                    data = json.loads(text)

                    def walk(o: Any) -> None:
                        if isinstance(o, str):
                            add(o, rel)
                        elif isinstance(o, list):
                            for x in o:
                                walk(x)
                        elif isinstance(o, dict):
                            for v in o.values():
                                walk(v)

                    walk(data)
                    continue
                except Exception:
                    pass
            for line in text.splitlines():
                add(line, rel)
        return sorted(seen.values(), key=lambda r: (-r.chars, r.id))

    def apply(
        self,
        root: Path,
        lang: str,
        mapping: dict[str, str],
        *,
        source_lang: str = "en",
    ) -> dict[str, Any]:
        out = root / "handoffkit_i18n"
        out.mkdir(parents=True, exist_ok=True)
        path = out / f"{lang}.json"
        path.write_text(
            json.dumps(mapping, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        return {"files_written": 1, "pack": str(path)}
