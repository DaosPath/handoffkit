"""Godot engine — CSV / translation-friendly text."""

from __future__ import annotations

import csv
import hashlib
import re
from pathlib import Path
from typing import Any

from handoffkit_localize.engines.base import AnalyzeReport, StringRow


def _sid(s: str) -> str:
    return hashlib.sha1(s.encode("utf-8")).hexdigest()[:12]


class GodotEngine:
    name = "godot"

    def detect(self, root: Path) -> AnalyzeReport | None:
        project = list(root.glob("project.godot")) + list(root.rglob("project.godot"))
        if not project:
            return None
        samples = [str(p.relative_to(root)) for p in list(root.rglob("*.csv"))[:10]]
        samples += [str(p.relative_to(root)) for p in list(root.rglob("*.tscn"))[:5]]
        return AnalyzeReport(
            engine="godot",
            confidence=0.85,
            game_root=str(root.resolve()),
            data_dirs=[],
            extractable_globs=["**/*.csv", "**/*.json", "**/*.txt"],
            skip_globs=["**/.import/**", "**/addons/**"],
            notes=[
                "Prefers CSV translation tables and loose JSON/TXT.",
                "Apply writes localized CSV under localization/handoffkit_<lang>.csv.",
            ],
            sample_files=samples[:15],
            recommended_pipeline=["extract csv/json/txt", "translate", "apply csv sidecar"],
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
            elif rel not in seen[sid].files:
                seen[sid].files.append(rel)

        for fp in root.rglob("*.csv"):
            if ".import" in fp.parts:
                continue
            rel = str(fp.relative_to(root))
            try:
                with fp.open(encoding="utf-8", errors="replace", newline="") as f:
                    reader = csv.reader(f)
                    for row in reader:
                        for cell in row:
                            add(cell, rel)
            except Exception:
                continue

        for fp in list(root.rglob("*.json")) + list(root.rglob("*.txt")):
            if any(x in fp.parts for x in (".import", "addons", ".git")):
                continue
            rel = str(fp.relative_to(root))
            try:
                text = fp.read_text(encoding="utf-8", errors="replace")
            except Exception:
                continue
            if fp.suffix == ".json":
                import json

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
                except Exception:
                    for line in text.splitlines():
                        add(line, rel)
            else:
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
        out = root / "localization"
        out.mkdir(parents=True, exist_ok=True)
        path = out / f"handoffkit_{lang}.csv"
        with path.open("w", encoding="utf-8", newline="") as f:
            w = csv.writer(f)
            w.writerow(["source", "translation"])
            for src, tr in sorted(mapping.items(), key=lambda x: x[0]):
                w.writerow([src, tr])
        return {"files_written": 1, "pack": str(path)}
