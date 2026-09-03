"""Public package smoke tests (no network)."""

from __future__ import annotations

from pathlib import Path

from handoffkit_localize.engines import analyze, get_engine
from handoffkit_localize.quality import compute_heuristic_quality
from handoffkit_localize.sample import write_sample_game


def test_sample_is_rpgmaker(tmp_path: Path) -> None:
    root = write_sample_game(tmp_path / "ballot")
    rep = analyze(root)
    assert "rpgmaker" in rep.engine
    assert rep.confidence >= 0.9
    assert rep.supports_apply
    eng = get_engine(rep.engine)
    rows = eng.extract(root)
    assert len(rows) >= 100
    texts = " ".join(r.text for r in rows).lower()
    assert "marenth" in texts or "mira" in texts or "ballot" in texts or "bridge" in texts
    assert "parliament" in texts or "election" in texts
    assert (root / "www" / "index.html").is_file()
    assert (root / "www" / "data" / "Map012.json").is_file()
    # sample should stay the PG ballot demo world
    assert "marenth" in texts or "ballot" in texts


def test_heuristic_quality_shape() -> None:
    catalog = [
        {"id": "a", "text": "Hello world"},
        {"id": "b", "text": "Aria: Hi there"},
    ]
    mem = {"a": "Hola mundo", "b": "Aria: Hi there"}
    rep = compute_heuristic_quality(catalog, mem, lang="es")
    assert rep["method"] == "heuristic_v2"
    assert 0 <= rep["score_0_100"] <= 100
    assert "coverage" in rep["components"]
    assert "weights" in rep


def test_renpy_and_godot_detect(tmp_path: Path) -> None:
    # renpy
    g = tmp_path / "ren"
    (g / "game").mkdir(parents=True)
    (g / "game" / "script.rpy").write_text(
        'label start:\n    e "Hello friend!"\n', encoding="utf-8"
    )
    from handoffkit_localize.engines.renpy import RenpyEngine

    r = RenpyEngine().detect(g)
    assert r and r.engine == "renpy"
    rows = RenpyEngine().extract(g)
    assert any("Hello" in x.text for x in rows)

    # godot
    gd = tmp_path / "gd"
    gd.mkdir()
    (gd / "project.godot").write_text("; godot\n", encoding="utf-8")
    (gd / "strings.csv").write_text("keys,en\nhello,Hello\n", encoding="utf-8")
    from handoffkit_localize.engines.godot import GodotEngine

    gdr = GodotEngine().detect(gd)
    assert gdr and gdr.engine == "godot"
