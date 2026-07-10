"""CLI entry: hk-localize / handoffkit-localize."""

from __future__ import annotations

import argparse
import json
import sys

from handoffkit_localize import __version__
from handoffkit_localize.chat import run_chat
from handoffkit_localize.pipeline import (
    load_catalog,
    load_memory,
    run_analyze,
    run_apply,
    run_extract,
    run_quality,
    run_translate,
)
from handoffkit_localize.providers_factory import list_providers_info, provider_label
from handoffkit_localize.sample import write_sample_game
from handoffkit_localize.settings import (
    SETTINGS_PATH,
    game_root,
    load_settings,
    set_agent,
    set_game_root,
    set_targets,
    workspace,
)


def _cmd_play(port: int = 8765) -> None:
    """Serve sample/game www/ over HTTP and open the story reader (avoids file:// CORS)."""
    import threading
    import time
    import webbrowser
    from functools import partial
    from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
    from pathlib import Path

    root = game_root()
    if not root or not root.exists():
        # fall back to sample
        sample = workspace() / "sample_quest"
        if not (sample / "www" / "index.html").exists():
            write_sample_game(sample)
            set_game_root(sample)
            root = sample
        else:
            root = sample
            set_game_root(sample)

    www = root / "www" if (root / "www" / "index.html").exists() else root
    if not (www / "index.html").exists():
        raise SystemExit(f"No www/index.html under {root}. Run: hk-localize sample-init")

    # rewrite player if still has old www/data paths
    idx = www / "index.html"
    html = idx.read_text(encoding="utf-8")
    if 'return "www/data/"' in html or "www/data/" in html and "dataFolder" in html:
        # regenerate from package template when using sample
        if (root / "PLAY.txt").exists() or "Ballot" in html or "ballot" in html.lower():
            write_sample_game(root)
            html = (www / "index.html").read_text(encoding="utf-8")

    handler = partial(SimpleHTTPRequestHandler, directory=str(www.resolve()))
    server = ThreadingHTTPServer(("127.0.0.1", port), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    url = f"http://127.0.0.1:{port}/"
    print(f"Serving {www}")
    print(f"Open:  {url}")
    print("Stop with Ctrl+C")
    try:
        webbrowser.open(url)
    except Exception:
        pass
    try:
        while True:
            time.sleep(0.5)
    except KeyboardInterrupt:
        print("\nStopping…")
        server.shutdown()



def _cmd_status() -> None:
    s = load_settings()
    root = game_root(s)
    print(f"handoffkit-localize v{__version__}  [public / PG policy]")
    print(f"  settings   {SETTINGS_PATH}")
    print(f"  workspace  {workspace()}")
    print(f"  game_root  {root or '(not set)'}")
    print(f"  exists     {bool(root and root.exists())}")
    print(f"  targets    {', '.join(s['languages']['targets'])}")
    for role in s["agents"]:
        print(f"  agent.{role:10} {provider_label(role)}")
    cat = load_catalog()
    print(f"  catalog    {len(cat)}")
    for lang in s["languages"]["targets"]:
        print(f"  memory/{lang:4} {len(load_memory(lang))}")


def main(argv: list[str] | None = None) -> None:
    argv = list(sys.argv[1:] if argv is None else argv)
    # default: TUI when no args
    if not argv:
        from handoffkit_localize.tui_app import run_tui

        run_tui()
        return

    ap = argparse.ArgumentParser(
        prog="hk-localize",
        description="Public multi-agent game localization (HandoffKit)",
    )
    ap.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("tui", help="Open rich Textual TUI")
    sub.add_parser("status")
    sub.add_parser("providers")
    sub.add_parser("doctor")

    p = sub.add_parser("set-game")
    p.add_argument("path")

    p = sub.add_parser("set-model")
    p.add_argument("--all", action="store_true")
    p.add_argument("--role", default="translator")
    p.add_argument("--provider", required=True)
    p.add_argument("--model", required=True)

    p = sub.add_parser("set-agent")
    p.add_argument("role")
    p.add_argument("--provider")
    p.add_argument("--model")

    p = sub.add_parser("set-targets")
    p.add_argument("langs")

    p = sub.add_parser("analyze")
    p.add_argument("--no-llm", action="store_true")

    sub.add_parser("extract")

    p = sub.add_parser("translate")
    p.add_argument("--force", action="store_true")
    p.add_argument("--limit", type=int, default=0)
    p.add_argument("--langs", default="")

    sub.add_parser("apply")
    sub.add_parser("quality", help="Heuristic quality scores")

    p = sub.add_parser("run")
    p.add_argument("--no-review", action="store_true", help="(reserved) skip LQA")
    p.add_argument("--limit", type=int, default=0)
    p.add_argument("--force", action="store_true")

    p = sub.add_parser("chat")
    p.add_argument("--lang", default="es")

    p = sub.add_parser("sample-init", help="Write PG sample game tree")
    p.add_argument("path", nargs="?", default="")

    p = sub.add_parser(
        "play",
        help="Serve sample/game over http://127.0.0.1 (fixes browser CORS on file://)",
    )
    p.add_argument("--port", type=int, default=8765)

    args = ap.parse_args(argv)
    cmd = args.cmd

    if cmd == "tui":
        from handoffkit_localize.tui_app import run_tui

        run_tui()
    elif cmd == "status":
        _cmd_status()
    elif cmd == "providers":
        for pinfo in list_providers_info():
            mark = "OK " if pinfo["key_set"] else " · "
            print(
                f"{mark}{pinfo['id']:16} {str(pinfo['default_model'])[:40]:40} {pinfo['env']}"
            )
    elif cmd == "doctor":
        s = load_settings()
        root = game_root(s)
        bad = 0
        if not root or not root.exists():
            print("✗ game_root missing — set-game PATH or sample-init")
            bad += 1
        else:
            print(f"✓ game_root {root}")
        for role, cfg in s["agents"].items():
            from handoffkit_localize.settings import env_status

            st = env_status(cfg["provider"])
            ok = "MISSING" not in st
            print(f"{'✓' if ok else '✗'} {role}: {cfg['provider']}/{cfg['model']} ({st})")
            if not ok and cfg["provider"] != "ollama":
                bad += 1
        print("✓ heuristic quality module ready")
        print("✓ play via: hk-localize play  (not file://)")
        if bad:
            raise SystemExit(1)
        print("doctor clean")
    elif cmd == "set-game":
        print("game_root →", set_game_root(args.path))
    elif cmd == "set-model":
        role = "all" if args.all else args.role
        set_agent(role, provider=args.provider, model=args.model)
        print("updated", role, args.provider, args.model)
    elif cmd == "set-agent":
        set_agent(args.role, provider=args.provider, model=args.model)
        print("updated", args.role)
    elif cmd == "set-targets":
        set_targets([x.strip() for x in args.langs.split(",") if x.strip()])
        print("targets ok")
    elif cmd == "analyze":
        rep = run_analyze(use_llm=not args.no_llm)
        print(json.dumps(rep.to_dict(), ensure_ascii=False, indent=2)[:2000])
    elif cmd == "extract":
        rows = run_extract()
        print(f"extracted {len(rows)} → {workspace() / 'catalog' / 'strings_en.jsonl'}")
    elif cmd == "translate":
        langs = (
            [x.strip() for x in args.langs.split(",") if x.strip()]
            if args.langs
            else None
        )
        run_translate(langs, force=args.force, limit=args.limit)
        print("translate done")
    elif cmd == "apply":
        for r in run_apply():
            print(r)
    elif cmd == "quality":
        for r in run_quality():
            print(
                f"{r['lang']}: {r['score_0_100']}/100  "
                f"[{r['method']}]  components={r['components']}"
            )
    elif cmd == "run":
        print("1 analyze")
        print(run_analyze(use_llm=False).engine)
        print("2 extract", len(run_extract()))
        print("3 translate")
        run_translate(force=args.force, limit=args.limit)
        print("4 apply")
        for r in run_apply():
            print(" ", r)
        print("5 heuristic quality")
        for r in run_quality():
            print(f"  {r['lang']}: {r['score_0_100']}")
    elif cmd == "chat":
        run_chat(args.lang)
    elif cmd == "sample-init":
        from pathlib import Path

        dest = Path(args.path) if args.path else workspace() / "sample_quest"
        write_sample_game(dest)
        set_game_root(dest)
        print(f"PG sample → {dest}")
        print("Play with:  hk-localize play")
    elif cmd == "play":
        _cmd_play(port=args.port)
    else:
        ap.print_help()


if __name__ == "__main__":
    main()
