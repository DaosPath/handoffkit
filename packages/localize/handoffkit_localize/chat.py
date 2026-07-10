"""Post-translate fix chat (CLI)."""

from __future__ import annotations

import json
import re

from handoffkit_localize.pipeline import load_catalog, load_memory, save_memory
from handoffkit_localize.providers_factory import make_provider, provider_label


def run_chat(lang: str) -> None:
    mem = load_memory(lang)
    catalog = {r["id"]: r["text"] for r in load_catalog()}
    if not mem:
        print(f"No memory for {lang}. Translate first.")
        return
    print(f"Fix chat · {lang} · {provider_label('chat')}")
    print("Commands: /search q | /set id|||text | /quit | or natural language")
    prov = make_provider(role="chat")
    while True:
        try:
            user = input(f"[{lang}]> ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if not user or user in ("/quit", "quit", "exit"):
            break
        if user.startswith("/search "):
            q = user[8:].lower()
            n = 0
            for sid, tr in mem.items():
                en = catalog.get(sid, "")
                if q in tr.lower() or q in en.lower():
                    print(f"  {sid}\n    EN {en[:70]}\n    TR {tr[:70]}")
                    n += 1
                    if n >= 8:
                        break
            continue
        if user.startswith("/set "):
            body = user[5:]
            if "|||" not in body:
                print("Usage: /set id|||new text")
                continue
            sid, new = body.split("|||", 1)
            mem[sid.strip()] = new.strip()
            save_memory(lang, mem)
            print("saved")
            continue
        # NL
        keys = re.findall(r"\w{3,}", user)
        ctx = []
        for k in keys[:5]:
            for sid, tr in mem.items():
                en = catalog.get(sid, "")
                if k.lower() in tr.lower() or k.lower() in en.lower():
                    ctx.append({"id": sid, "en": en, "tr": tr})
                if len(ctx) >= 10:
                    break
        prompt = (
            f"Localization fix assistant. Language={lang}.\n"
            "Return JSON array of fixes only: "
            '[{"id":"...","text":"..."}] or [].\n'
            f"User: {user}\nCandidates: {json.dumps(ctx, ensure_ascii=False)}"
        )
        try:
            raw = prov.generate(prompt, max_tokens=3000, temperature=0.15)
            start, end = raw.find("["), raw.rfind("]")
            arr = json.loads(raw[start : end + 1]) if start >= 0 else []
            fixes = {
                str(r["id"]): str(r["text"])
                for r in arr
                if isinstance(r, dict) and r.get("id") and r.get("text")
            }
        except Exception as exc:
            print(f"parse/model error: {exc}")
            continue
        if not fixes:
            print("No fixes proposed.")
            continue
        for sid, text in list(fixes.items())[:10]:
            print(f"  {sid} → {text[:80]}")
        if input("Apply? [Y/n] ").strip().lower() in ("", "y", "yes"):
            mem.update(fixes)
            save_memory(lang, mem)
            print(f"Applied {len(fixes)}")
