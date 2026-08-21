"""CLI helpers for ``handoffkit browse …``."""

from __future__ import annotations

import argparse
import json
from typing import Any


def add_browse_parser(subparsers: Any) -> None:
    browse = subparsers.add_parser(
        "browse",
        help="First-party web search / fetch / research (handoffkit.browser).",
    )
    browse_sub = browse.add_subparsers(dest="browse_command")

    search_p = browse_sub.add_parser("search", help="Live/offline web search.")
    search_p.add_argument("query", nargs="+", help="Search query.")
    search_p.add_argument("--max", type=int, default=6)
    search_p.add_argument("--json", action="store_true")
    search_p.add_argument("--fixture", action="store_true")
    search_p.add_argument("--allow", action="append", default=[])
    search_p.add_argument("--deny", action="append", default=[])

    fetch_p = browse_sub.add_parser("fetch", help="Fetch one URL as markdown.")
    fetch_p.add_argument("url", help="Absolute http(s) URL.")
    fetch_p.add_argument("--json", action="store_true")
    fetch_p.add_argument("--markdown", action="store_true")
    fetch_p.add_argument("--format", choices=["markdown", "readme"], default="markdown")
    fetch_p.add_argument("--fixture", action="store_true")

    research_p = browse_sub.add_parser("research", help="Search-then-fetch research pack.")
    research_p.add_argument("query", nargs="+", help="Research query.")
    research_p.add_argument("--max-pages", type=int, default=3)
    research_p.add_argument("--json", action="store_true")
    research_p.add_argument("--markdown", action="store_true")
    research_p.add_argument("--cache", action="store_true")
    research_p.add_argument("--fixture", action="store_true")
    research_p.add_argument("--allow", action="append", default=[])
    research_p.add_argument("--deny", action="append", default=[])
    research_p.add_argument("--format", choices=["markdown", "readme"], default="markdown")

    fixture_p = browse_sub.add_parser("fixture", help="Offline fixture crawl demo.")
    fixture_p.add_argument("--json", action="store_true")
    browse_sub.add_parser("tools", help="List registered browser tool names.")


def run_browse_command(args: argparse.Namespace) -> int:
    from handoffkit.browser import (
        create_browser_agent_kit,
        gather_web_research,
        make_fixture_map_transport,
        research_prompt_section,
        web_search,
    )

    cmd = getattr(args, "browse_command", None)
    if not cmd:
        print(
            "handoffkit browse\n\n"
            "  browse search <query> [--max 6] [--json] [--allow host] [--deny host]\n"
            "  browse fetch <url> [--markdown|--json] [--format markdown|readme]\n"
            "  browse research <query> [--max-pages 3] [--json|--markdown] [--cache]\n"
            "  browse fixture\n"
            "  browse tools"
        )
        return 0

    use_fixture = bool(getattr(args, "fixture", False))
    kit = create_browser_agent_kit(
        {
            "fixture": use_fixture,
            "use_cache": bool(getattr(args, "cache", False)),
            "allow_hosts": list(getattr(args, "allow", []) or []),
            "deny_hosts": list(getattr(args, "deny", []) or []),
            "format": getattr(args, "format", "markdown"),
            "max_pages": int(getattr(args, "max_pages", 3) or 3),
        }
    )

    if cmd == "tools":
        print("\n".join(t.name for t in kit["tools"]))
        return 0

    if cmd == "fixture":
        transport = make_fixture_map_transport()
        pack = gather_web_research(
            transport=transport,
            seed_urls=["https://fixture.local/"],
            seed_only=True,
            max_pages=3,
            prefer_explore=True,
            max_depth=1,
        )
        if getattr(args, "json", False):
            print(json.dumps(pack.to_dict(), indent=2, ensure_ascii=False))
        else:
            print(pack.markdown_context or research_prompt_section(pack))
        return 0 if pack.pages_ok > 0 else 1

    if cmd == "search":
        query = " ".join(args.query).strip()
        result = web_search(
            query,
            transport=kit["transport"],
            max_results=int(getattr(args, "max", 6) or 6),
            allow_hosts=list(getattr(args, "allow", []) or []),
            deny_hosts=list(getattr(args, "deny", []) or []),
        )
        if args.json:
            print(json.dumps(result, indent=2, ensure_ascii=False))
        else:
            print(f"query: {result['query']}")
            print(f"count: {result['count']}")
            for hit in result.get("results") or []:
                print(f"- {hit.get('title') or '(untitled)'} :: {hit.get('url')}")
        return 0 if result.get("success") else 1

    if cmd == "fetch":
        page = kit["fetch_markdown"](args.url, format=getattr(args, "format", "markdown"))
        if args.json:
            print(json.dumps(page.to_dict(), indent=2, ensure_ascii=False))
        else:
            print(page.markdown or page.error or "")
        return 0 if page.success else 1

    if cmd == "research":
        query = " ".join(args.query).strip()
        pack = kit["gather"](
            query=query,
            max_pages=int(getattr(args, "max_pages", 3) or 3),
            allow_hosts=list(getattr(args, "allow", []) or []),
            deny_hosts=list(getattr(args, "deny", []) or []),
            format=getattr(args, "format", "markdown"),
        )
        if args.json:
            print(json.dumps(pack.to_dict(), indent=2, ensure_ascii=False))
        elif getattr(args, "markdown", False):
            print(pack.markdown_context or "")
        else:
            print(research_prompt_section(pack) or pack.markdown_context or pack.error)
        return 0 if pack.pages_ok > 0 else 1

    print(f"unknown browse subcommand: {cmd}")
    return 1
