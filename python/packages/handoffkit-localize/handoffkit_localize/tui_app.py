"""Rich Textual TUI for handoffkit-localize (public)."""

from __future__ import annotations

from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, Vertical, VerticalScroll
from textual.widgets import Button, Footer, Header, Input, Label, RichLog, Static

from handoffkit_localize import __version__
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


class LocalizeApp(App[None]):
    """Public localization control panel."""

    CSS = """
    Screen { background: #0f1419; }
    #title {
        dock: top;
        height: 3;
        content-align: center middle;
        text-style: bold;
        color: #7dd3fc;
        background: #111827;
    }
    #sidebar {
        width: 28;
        background: #111827;
        border-right: solid #1f2937;
        padding: 1;
    }
    #main {
        padding: 1 2;
    }
    Button {
        width: 100%;
        margin: 0 0 1 0;
    }
    .ok { color: #4ade80; }
    .warn { color: #fbbf24; }
    .err { color: #f87171; }
    #log {
        height: 1fr;
        border: solid #1f2937;
        background: #0b1220;
    }
    Input { margin: 0 0 1 0; }
    """

    BINDINGS = [
        Binding("q", "quit", "Quit"),
        Binding("s", "status", "Status"),
        Binding("r", "run_fast", "Run fast"),
    ]

    TITLE = "HandoffKit Localize"
    SUB_TITLE = f"v{__version__} · public · PG samples"

    def compose(self) -> ComposeResult:
        yield Header(show_clock=True)
        yield Static(
            f"HandoffKit Localize  ·  public multi-agent i18n  ·  v{__version__}",
            id="title",
        )
        with Horizontal():
            with Vertical(id="sidebar"):
                yield Label("Actions")
                yield Button("Status", id="btn_status", variant="primary")
                yield Button("Providers", id="btn_providers")
                yield Button("Analyze", id="btn_analyze")
                yield Button("Extract", id="btn_extract")
                yield Button("Translate (fast)", id="btn_translate")
                yield Button("Apply packs", id="btn_apply")
                yield Button("Heuristic quality", id="btn_quality")
                yield Button("Init PG sample", id="btn_sample")
                yield Button("Quit", id="btn_quit", variant="error")
                yield Label("Game path")
                yield Input(placeholder="Absolute path to game…", id="path_input")
                yield Button("Set game path", id="btn_set_path")
            with Vertical(id="main"):
                yield Static(id="dashboard")
                yield RichLog(id="log", highlight=True, markup=True)
        yield Footer()

    def on_mount(self) -> None:
        self.action_status()

    def _log(self, msg: str) -> None:
        self.query_one("#log", RichLog).write(msg)

    def action_status(self) -> None:
        s = load_settings()
        root = game_root(s)
        lines = [
            f"[b cyan]game_root[/]  {root or '(not set)'}",
            f"[b]exists[/]     {bool(root and root.exists())}",
            f"[b]targets[/]    {', '.join(s['languages']['targets'])}",
            f"[b]translator[/] {provider_label('translator')}",
            f"[b]reviewer[/]   {provider_label('reviewer')}",
            f"[b]workspace[/]  {workspace()}",
            f"[b]settings[/]   {SETTINGS_PATH}",
            "",
            "[dim]Heuristic quality = rule-based components "
            "(coverage, freshness, hygiene, brevity, speakers) — not an LLM judge.[/]",
        ]
        cat = load_catalog()
        if cat:
            lines.append(f"[b]catalog[/]    {len(cat)} strings")
            for lang in s["languages"]["targets"]:
                n = len(load_memory(lang))
                lines.append(f"  memory/{lang}: {n}")
        self.query_one("#dashboard", Static).update("\n".join(lines))
        self._log("[green]Status refreshed[/]")

    def on_button_pressed(self, event: Button.Pressed) -> None:
        bid = event.button.id or ""
        try:
            if bid == "btn_quit":
                self.exit()
            elif bid == "btn_status":
                self.action_status()
            elif bid == "btn_providers":
                for p in list_providers_info():
                    mark = "✓" if p["key_set"] else "·"
                    self._log(
                        f"{mark} [cyan]{p['id']}[/]  {p['default_model']}  "
                        f"[dim]{p['env']}[/]"
                    )
            elif bid == "btn_set_path":
                path = self.query_one("#path_input", Input).value.strip()
                if not path:
                    self._log("[yellow]Enter a path first[/]")
                    return
                p = set_game_root(path)
                self._log(f"[green]game_root → {p}[/]")
                self.action_status()
            elif bid == "btn_analyze":
                rep = run_analyze(use_llm=False)
                self._log(
                    f"[green]engine={rep.engine} conf={rep.confidence:.0%}[/] "
                    f"samples={len(rep.sample_files)}"
                )
                for n in rep.notes[:5]:
                    self._log(f"  • {n}")
            elif bid == "btn_extract":
                rows = run_extract()
                self._log(f"[green]extracted {len(rows)} strings[/]")
                self.action_status()
            elif bid == "btn_translate":
                self._log("[cyan]Translating (may take a while)…[/]")
                run_translate(limit=0, force=False)
                self._log("[green]translate done[/]")
                self.action_status()
            elif bid == "btn_apply":
                res = run_apply()
                for r in res:
                    self._log(f"[green]apply {r.get('lang')} → {r.get('pack')}[/]")
            elif bid == "btn_quality":
                reports = run_quality()
                for r in reports:
                    self._log(
                        f"[b]{r['lang']}[/] heuristic score "
                        f"[cyan]{r['score_0_100']}[/]/100  "
                        f"({r['method']})"
                    )
            elif bid == "btn_sample":
                dest = workspace() / "sample_quest"
                write_sample_game(dest)
                set_game_root(dest)
                self._log(f"[green]PG sample written → {dest}[/]")
                self.action_status()
        except SystemExit as e:
            self._log(f"[red]{e}[/]")
        except Exception as exc:
            self._log(f"[red]{exc}[/]")

    def action_run_fast(self) -> None:
        try:
            self._log("[cyan]analyze → extract → translate → apply[/]")
            run_analyze(use_llm=False)
            run_extract()
            run_translate()
            run_apply()
            for r in run_quality():
                self._log(f"{r['lang']}: {r['score_0_100']}")
            self._log("[green]Pipeline finished[/]")
            self.action_status()
        except Exception as exc:
            self._log(f"[red]{exc}[/]")


def run_tui() -> None:
    LocalizeApp().run()
