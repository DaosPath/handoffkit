"""Extract / translate / apply pipeline (public, multi-engine)."""

from __future__ import annotations

import json
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

from handoffkit_localize.engines import analyze, get_engine
from handoffkit_localize.engines.base import AnalyzeReport, StringRow
from handoffkit_localize.providers_factory import make_provider
from handoffkit_localize.quality import compute_heuristic_quality, write_quality_report
from handoffkit_localize.settings import game_root, load_settings, workspace


def save_catalog(rows: list[StringRow]) -> Path:
    path = workspace() / "catalog" / "strings_en.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for r in rows:
            f.write(
                json.dumps(
                    {
                        "id": r.id,
                        "text": r.text,
                        "files": r.files,
                        "chars": r.chars,
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )
    return path


def load_catalog() -> list[dict[str, Any]]:
    path = workspace() / "catalog" / "strings_en.jsonl"
    if not path.exists():
        return []
    return [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def load_memory(lang: str) -> dict[str, str]:
    path = workspace() / "memory" / f"{lang}.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def save_memory(lang: str, mem: dict[str, str]) -> None:
    path = workspace() / "memory" / f"{lang}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(mem, ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8",
    )


def run_analyze(*, use_llm: bool = True) -> AnalyzeReport:
    root = game_root()
    if not root or not root.exists():
        raise SystemExit("Set game path first: hk-localize set-game PATH")
    report = analyze(root)
    if use_llm:
        try:
            prov = make_provider(role="analyzer")
            samples = "\n".join(report.sample_files[:20])
            prompt = (
                "You are a game localization analyzer (PG content only).\n"
                f"Engine: {report.engine}\nSamples:\n{samples}\n"
                "Give 5 short plain bullets: what to translate, what to skip, risks."
            )
            report.llm_summary = (
                prov.generate(prompt, max_tokens=600, temperature=0.2) or ""
            ).strip()
        except Exception as exc:
            report.llm_summary = f"(llm skipped: {exc})"
    out = workspace() / "logs" / "analyze_report.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps(report.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return report


def run_extract() -> list[StringRow]:
    root = game_root()
    report = analyze(root)
    eng = get_engine(report.engine)
    rows = eng.extract(root)
    save_catalog(rows)
    return rows


def _batch_prompt(items: list[dict[str, str]], lang: str) -> str:
    names = {
        "es": "Spanish",
        "zh": "Simplified Chinese",
        "pt": "Brazilian Portuguese",
        "hi": "Hindi (Devanagari)",
        "fr": "French",
        "de": "German",
    }
    return "\n".join(
        [
            "You are a professional game localizer. PG-friendly tone unless source is not.",
            f"Translate to {names.get(lang, lang)}.",
            "Keep placeholders. Output ONLY JSON array:",
            '[{"id":"...","text":"..."}]',
            "ITEMS:",
            json.dumps(items, ensure_ascii=False),
        ]
    )


def _parse_json_array(raw: str) -> dict[str, str]:
    text = (raw or "").strip()
    if "```" in text:
        m = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
        if m:
            text = m.group(1).strip()
    start, end = text.find("["), text.rfind("]")
    if start < 0 or end <= start:
        raise ValueError("no json array")
    arr = json.loads(text[start : end + 1])
    out: dict[str, str] = {}
    for row in arr:
        if isinstance(row, dict) and row.get("id") and row.get("text"):
            out[str(row["id"])] = str(row["text"])
    return out


def run_translate(
    langs: list[str] | None = None,
    *,
    force: bool = False,
    limit: int = 0,
    workers: int = 10,
) -> None:
    s = load_settings()
    langs = langs or list(s["languages"]["targets"])
    catalog = load_catalog()
    if not catalog:
        raise SystemExit("No catalog — run extract first")
    orch = s.get("orchestration") or {}
    max_items = int(orch.get("max_items", 60))
    max_tokens = int(orch.get("max_tokens", 64000))

    def translate_lang(lang: str) -> None:
        mem = {} if force else load_memory(lang)
        pending = [r for r in catalog if force or r["id"] not in mem]
        if limit:
            pending = pending[:limit]
        if not pending:
            return
        prov = make_provider(role="translator")
        i = 0
        while i < len(pending):
            batch = pending[i : i + max_items]
            i += max_items
            items = [{"id": r["id"], "text": r["text"]} for r in batch]
            try:
                raw = prov.generate(
                    _batch_prompt(items, lang),
                    max_tokens=max_tokens,
                    temperature=0.15,
                )
                got = _parse_json_array(raw)
                mem.update(got)
                save_memory(lang, mem)
            except Exception:
                # leave missing for retry tools
                continue
        # EN fallback
        for r in pending:
            mem.setdefault(r["id"], r["text"])
        save_memory(lang, mem)

    with ThreadPoolExecutor(max_workers=min(workers, max(1, len(langs)))) as pool:
        futs = [pool.submit(translate_lang, lang) for lang in langs]
        for fut in as_completed(futs):
            fut.result()


def run_apply(langs: list[str] | None = None) -> list[dict[str, Any]]:
    s = load_settings()
    langs = langs or list(s["languages"]["targets"])
    root = game_root(s)
    report = analyze(root)
    eng = get_engine(report.engine)
    catalog = {r["id"]: r["text"] for r in load_catalog()}
    results = []
    for lang in langs:
        mem = load_memory(lang)
        mapping = {
            catalog[sid]: tr
            for sid, tr in mem.items()
            if sid in catalog and catalog[sid] != tr
        }
        # also identity for missing handled by leave EN
        info = eng.apply(root, lang, mapping)
        results.append({"lang": lang, **info})
    return results


def run_quality(langs: list[str] | None = None) -> list[dict[str, Any]]:
    s = load_settings()
    langs = langs or list(s["languages"]["targets"])
    catalog = load_catalog()
    out_dir = workspace() / "logs" / "quality"
    reports = []
    for lang in langs:
        mem = load_memory(lang)
        rep = compute_heuristic_quality(catalog, mem, lang=lang)
        write_quality_report(rep, out_dir)
        reports.append(rep)
    return reports
