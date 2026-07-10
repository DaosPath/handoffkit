"""Engine registry — first match by confidence."""

from __future__ import annotations

from pathlib import Path

from handoffkit_localize.engines.base import AnalyzeReport
from handoffkit_localize.engines.generic import GenericEngine
from handoffkit_localize.engines.godot import GodotEngine
from handoffkit_localize.engines.renpy import RenpyEngine
from handoffkit_localize.engines.rpgmaker import RpgMakerEngine
from handoffkit_localize.engines.unity import UnityEngine

ENGINES = [
    RpgMakerEngine(),
    RenpyEngine(),
    GodotEngine(),
    UnityEngine(),
    GenericEngine(),
]


def analyze(root: Path) -> AnalyzeReport:
    root = root.resolve()
    best: AnalyzeReport | None = None
    for eng in ENGINES:
        rep = eng.detect(root)
        if rep is None:
            continue
        if best is None or rep.confidence > best.confidence:
            best = rep
            # keep engine instance name in notes
            best.notes = list(best.notes) + [f"detector={eng.name}"]
    if best is None:
        return AnalyzeReport(
            engine="unknown",
            confidence=0.0,
            game_root=str(root),
            notes=["No engine matched."],
        )
    return best


def get_engine(engine_name: str):
    key = engine_name.lower()
    for eng in ENGINES:
        if eng.name in key or key.startswith(eng.name):
            return eng
    # map rpgmaker-mv -> RpgMakerEngine
    if "rpgmaker" in key:
        return RpgMakerEngine()
    if "renpy" in key:
        return RenpyEngine()
    if "godot" in key:
        return GodotEngine()
    if "unity" in key:
        return UnityEngine()
    return GenericEngine()
