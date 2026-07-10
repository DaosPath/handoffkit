"""RPG Maker MV / MZ engine."""

from __future__ import annotations

import hashlib
import json
import re
import shutil
from pathlib import Path
from typing import Any

from handoffkit_localize.engines.base import AnalyzeReport, StringRow

SKIP_FILES = {"Animations.json", "Tilesets.json", "Tilesets1.json"}
ASSET_KEYS = frozenset(
    {
        "characterName",
        "faceName",
        "battlerName",
        "title1Name",
        "title2Name",
        "battleback1Name",
        "battleback2Name",
        "parallaxName",
        "note",
    }
)


def _sid(s: str) -> str:
    return hashlib.sha1(s.encode("utf-8")).hexdigest()[:12]


def _is_translatable(s: str) -> bool:
    if not isinstance(s, str):
        return False
    t = s.strip()
    if len(t) < 2:
        return False
    if re.fullmatch(r"[\d\s\W_]+", t):
        return False
    if t.startswith("img/") or t.endswith((".png", ".ogg", ".rpgmvp")):
        return False
    if not re.search(r"[A-Za-z\u00C0-\u024F\u3040-\u30ff\u3400-\u9fff]", t):
        return False
    return True


def _is_audio(d: Any) -> bool:
    return (
        isinstance(d, dict)
        and "name" in d
        and ("volume" in d or "pitch" in d or "pan" in d)
    )


def _collect(obj: Any, out: list[str], parent: str | None = None) -> None:
    if isinstance(obj, str):
        if parent in ASSET_KEYS:
            return
        if _is_translatable(obj):
            out.append(obj)
        return
    if isinstance(obj, list):
        for x in obj:
            _collect(x, out, parent)
        return
    if isinstance(obj, dict):
        if _is_audio(obj):
            return
        for k, v in obj.items():
            _collect(v, out, k if isinstance(k, str) else parent)


def _replace(obj: Any, mapping: dict[str, str], parent: str | None = None) -> Any:
    if isinstance(obj, str):
        if parent in ASSET_KEYS:
            return obj
        return mapping.get(obj, obj)
    if isinstance(obj, list):
        return [_replace(x, mapping, parent) for x in obj]
    if isinstance(obj, dict):
        if _is_audio(obj):
            return dict(obj)
        return {
            k: _replace(v, mapping, k if isinstance(k, str) else parent)
            for k, v in obj.items()
        }
    return obj


def _www(root: Path) -> Path:
    if (root / "www" / "data").is_dir():
        return root / "www"
    return root


class RpgMakerEngine:
    name = "rpgmaker"

    def detect(self, root: Path) -> AnalyzeReport | None:
        www = _www(root)
        data = www / "data"
        if not data.is_dir():
            return None
        is_mz = (www / "js" / "rmmz_core.js").exists()
        is_mv = (www / "js" / "rpg_core.js").exists() or (
            www / "package.json"
        ).exists()
        if not (is_mz or is_mv or list(data.glob("System.json"))):
            return None
        engine = "rpgmaker-mz" if is_mz else "rpgmaker-mv"
        samples = [str(p.relative_to(root)) for p in sorted(data.glob("*.json"))[:12]]
        return AnalyzeReport(
            engine=engine,
            confidence=0.95,
            game_root=str(root.resolve()),
            data_dirs=[str((www / "data").relative_to(root))],
            extractable_globs=["**/data/*.json"],
            skip_globs=["**/img/**", "**/audio/**", "**/data/Animations.json"],
            notes=[
                "Dialogue and terms live in data/*.json.",
                "Never translate asset filenames (faces, SE, title graphics).",
                "Apply creates data_<lang> packs alongside data_en.",
            ],
            sample_files=samples,
            recommended_pipeline=[
                "extract",
                "translate (SuperOrchestrator)",
                "apply language packs",
                "optional chat-fix",
            ],
            supports_apply=True,
        )

    def extract(self, root: Path) -> list[StringRow]:
        www = _www(root)
        data = www / "data"
        seen: dict[str, StringRow] = {}
        for fp in sorted(data.glob("*.json")):
            if fp.name in SKIP_FILES:
                continue
            try:
                payload = json.loads(fp.read_text(encoding="utf-8"))
            except Exception:
                continue
            bucket: list[str] = []
            _collect(payload, bucket)
            rel = str(fp.relative_to(root))
            for s in bucket:
                sid = _sid(s)
                if sid not in seen:
                    seen[sid] = StringRow(id=sid, text=s, files=[rel], chars=len(s))
                elif rel not in seen[sid].files:
                    seen[sid].files.append(rel)
        return sorted(seen.values(), key=lambda r: (-r.chars, r.id))

    def apply(
        self,
        root: Path,
        lang: str,
        mapping: dict[str, str],
        *,
        source_lang: str = "en",
    ) -> dict[str, Any]:
        www = _www(root)
        data = www / "data"
        data_en = www / f"data_{source_lang}"
        if not data_en.exists():
            shutil.copytree(data, data_en)
        data_xx = www / f"data_{lang}"
        if data_xx.exists():
            shutil.rmtree(data_xx)
        shutil.copytree(data_en, data_xx)
        n = 0
        for fp in data_xx.glob("*.json"):
            if fp.name in SKIP_FILES:
                continue
            try:
                payload = json.loads(fp.read_text(encoding="utf-8"))
            except Exception:
                continue
            new_p = _replace(payload, mapping)
            if fp.name == "System.json" and isinstance(new_p, dict):
                # keep title image stable if Title.rpgmvp exists
                titles = www / "img" / "titles1"
                if (titles / "Title.rpgmvp").exists() or (titles / "Title.png").exists():
                    new_p["title1Name"] = "Title"
            fp.write_text(
                json.dumps(new_p, ensure_ascii=False), encoding="utf-8"
            )
            n += 1
        return {"files_written": n, "pack": str(data_xx)}
