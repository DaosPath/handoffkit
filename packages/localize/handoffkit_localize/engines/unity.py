"""Unity player builds — loose localization assets only."""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

from handoffkit_localize.engines.base import AnalyzeReport, StringRow


def _sid(s: str) -> str:
    return hashlib.sha1(s.encode("utf-8")).hexdigest()[:12]


class UnityEngine:
    name = "unity"

    def detect(self, root: Path) -> AnalyzeReport | None:
        has_player = (root / "UnityPlayer.dll").exists() or any(
            root.glob("*_Data")
        )
        has_exe = any(root.glob("*.exe"))
        if not (has_player or (has_exe and any(root.rglob("StreamingAssets")))):
            return None
        samples = [
            str(p.relative_to(root))
            for p in list(root.rglob("StreamingAssets/**/*"))[:12]
            if p.is_file()
        ]
        return AnalyzeReport(
            engine="unity-build",
            confidence=0.6,
            game_root=str(root.resolve()),
            data_dirs=["StreamingAssets"] if any(root.rglob("StreamingAssets")) else [],
            extractable_globs=[
                "**/StreamingAssets/**/*.json",
                "**/StreamingAssets/**/*.csv",
                "**/StreamingAssets/**/*.txt",
                "**/Localization/**/*.json",
            ],
            skip_globs=["**/*_Data/Managed/**", "**/*.dll", "**/*.so"],
            notes=[
                "Unity builds are limited without project source.",
                "Scrapes StreamingAssets / Localization loose files only.",
                "Apply writes handoffkit_i18n/<lang>.json sidecar.",
            ],
            sample_files=samples,
            recommended_pipeline=[
                "extract loose assets",
                "translate",
                "apply sidecar (manual hook into game may be needed)",
            ],
            supports_apply=True,
        )

    def extract(self, root: Path) -> list[StringRow]:
        seen: dict[str, StringRow] = {}
        patterns = ("*.json", "*.csv", "*.txt")
        roots = [
            *root.rglob("StreamingAssets"),
            *root.rglob("Localization"),
            root,
        ]
        files: list[Path] = []
        for base in roots:
            if not base.exists():
                continue
            if base.is_file():
                continue
            for pat in patterns:
                files.extend(base.rglob(pat))
        # de-dupe
        uniq = []
        seen_p = set()
        for f in files:
            if "Managed" in f.parts or f.suffix in {".dll"}:
                continue
            rp = str(f.resolve())
            if rp in seen_p:
                continue
            seen_p.add(rp)
            uniq.append(f)

        def add(s: str, rel: str) -> None:
            s = s.strip()
            if len(s) < 2:
                return
            if not re.search(r"[A-Za-z\u00C0-\u024F\u3400-\u9fff]", s):
                return
            sid = _sid(s)
            if sid not in seen:
                seen[sid] = StringRow(id=sid, text=s, files=[rel], chars=len(s))

        for fp in uniq[:400]:
            try:
                rel = str(fp.relative_to(root))
            except ValueError:
                continue
            try:
                text = fp.read_text(encoding="utf-8", errors="replace")
            except Exception:
                continue
            if fp.suffix == ".json":
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
        out = root / "handoffkit_i18n"
        out.mkdir(parents=True, exist_ok=True)
        path = out / f"{lang}.json"
        path.write_text(
            json.dumps(mapping, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        return {"files_written": 1, "pack": str(path)}
