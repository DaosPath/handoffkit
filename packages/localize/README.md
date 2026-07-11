# handoffkit-localize

**Multi-agent game localization** for the [HandoffKit](https://github.com/DaosPath/handoffkit) ecosystem.

CLI + rich **Textual** TUI that:

1. Detects the game engine  
2. Extracts player-facing strings  
3. Translates them with LLM providers (via HandoffKit)  
4. Applies language packs back into the game tree  
5. Scores coverage with transparent **heuristic** metrics  

| | |
|---|---|
| **PyPI** | `handoffkit-localize` |
| **Commands** | `hk-localize` · `handoffkit-localize` |
| **Version** | 0.1.0 |
| **Python** | 3.10+ |
| **License** | MIT |

---

## What it is (and is not)

### What it is

A **local operator tool** to localize games you already have on disk:

- Point it at a game folder (`set-game`)
- Or generate the built-in **PG sample** (*The Ballot and the Bridge*)
- Run analyze → extract → translate → apply → quality
- Use a full-screen TUI (`hk-localize`) or plain CLI subcommands

Translations are stored as a **memory** (JSON) and a **catalog** (JSONL) under your user workspace. Apply writes engine-specific language packs into the game folder.

### What it is not

- Not a hosted cloud service — everything runs on your machine  
- Not a full RPG Maker / Ren'Py IDE  
- Not an automatic “perfect literary” judge — quality scores are **heuristic** (coverage, freshness, hygiene, …), not LLM taste scores  
- Does **not** upload your game; your assets stay local  

The package ships only a short **PG political sample** for demos. Your own game files are never part of the published package.

---

## How the pipeline works

```
┌─────────────┐     ┌──────────────┐     ┌────────────────┐
│  set-game   │────▶│   analyze    │────▶│    extract     │
│  (path)     │     │  detect eng. │     │  strings →     │
└─────────────┘     └──────────────┘     │  catalog JSONL │
                                         └───────┬────────┘
                                                 │
                    ┌────────────────────────────▼────────┐
                    │  translate (LLM batches per lang)   │
                    │  → memory/<lang>.json               │
                    └────────────────────────────┬────────┘
                                                 │
              ┌──────────────────┬───────────────┼───────────────┐
              ▼                  ▼               ▼               ▼
         apply packs        quality          chat fix        play sample
         (engine write)     (heuristics)     (interactive)   (HTTP server)
```

| Stage | What happens |
|--------|----------------|
| **Analyze** | Walks the folder, picks the best engine detector (RPG Maker, Ren'Py, Godot, Unity loose, or generic). Optional LLM summary of risks / what to skip. |
| **Extract** | Pulls translatable strings into `catalog/strings_en.jsonl` (stable hashed ids). |
| **Translate** | Batches pending strings to your configured LLM provider; saves `memory/es.json`, `zh.json`, … |
| **Apply** | Engine-specific write: e.g. RPG Maker language packs `data_es/`, Ren'Py sidecars, etc. |
| **Quality** | Rule-based score 0–100 (coverage, not-identical-to-EN, hygiene, length, speaker prefixes). |
| **Chat** | Interactive fix pass for one language after translate. |
| **Play** | Serves `www/` over `http://127.0.0.1` so the sample reader works (avoids `file://` CORS). |

Default target languages: **es**, **zh**, **pt**, **hi** (change with `set-targets`).

---

## Install

```bash
pip install handoffkit-localize
```

From this monorepo (editable):

```bash
pip install -e packages/localize
# requires handoffkit available (sibling package / already installed)
```

**Dependencies:** `handoffkit>=1.10`, `rich`, `textual`.

You also need an **API key** for at least one LLM provider (see [Providers](#providers--models)).

---

## 60-second demo (sample game)

No game of your own required:

```bash
# 1) Write the PG sample into the workspace
hk-localize sample-init

# 2) Check paths / agents / keys
hk-localize doctor
hk-localize status

# 3) Configure a provider (example: OpenCode Go)
#    export OPENCODE_API_KEY=...
hk-localize set-model --all --provider opencode-go --model deepseek-v4-flash

# 4) Full pipeline (or step by step)
hk-localize analyze
hk-localize extract
hk-localize translate --langs es --limit 40
hk-localize apply
hk-localize quality

# 5) Play in the browser (HTTP, not file://)
hk-localize play
# → http://127.0.0.1:8765/  — switch Lang after apply
```

Or open the **TUI** (default when you run with no args):

```bash
hk-localize
# same as: hk-localize tui
```

### Sample: *The Ballot and the Bridge*

Short **political intrigue** demo (election, press, parliament, unions, a contested bridge).  
PG / public-safe. Hundreds of extractable strings.  
Includes a tiny RPG Maker–style `www/` reader so you can verify translations visually.

---

## Localize your own game

```bash
# Point at the game root (folder that contains www/ or game/ or project.godot, …)
hk-localize set-game "D:/Games/MyCoolRPG"

hk-localize doctor          # path + API keys
hk-localize analyze         # which engine?
hk-localize extract         # build catalog
hk-localize set-targets es,zh,pt,hi
hk-localize translate       # all targets (or --langs es --limit 100)
hk-localize apply           # write packs into the game tree
hk-localize quality
```

**Tip:** keep a backup of the game before the first `apply`. Apply updates files under the game root according to the engine.

One-shot orchestration:

```bash
hk-localize run --limit 50          # extract + translate + apply (+ quality)
hk-localize run --force             # retranslate everything
hk-localize run --no-review         # reserved flag (skip future LQA pass)
```

---

## Command reference

| Command | Purpose |
|---------|---------|
| `hk-localize` / `tui` | Rich Textual TUI (default with no args) |
| `status` | Settings path, game root, catalog size, memory sizes, agents |
| `providers` | List HandoffKit providers + whether env API key is set |
| `doctor` | Sanity checks (game path, keys) |
| `set-game PATH` | Remember game root (also accepts `…/www`) |
| `set-model --provider X --model Y [--all \| --role translator]` | Bind LLM to roles |
| `set-agent ROLE --provider X --model Y` | Per-role agent config |
| `set-targets es,zh,pt` | Target language codes |
| `analyze [--no-llm]` | Detect engine; optional LLM bullets |
| `extract` | Build `catalog/strings_en.jsonl` |
| `translate [--langs es] [--limit N] [--force]` | Fill `memory/<lang>.json` |
| `apply` | Write language packs into the game |
| `quality` | Heuristic reports under workspace logs |
| `run [--limit N] [--force] [--no-review]` | Pipeline shortcut |
| `chat --lang es` | Interactive post-translate fix chat |
| `sample-init [path]` | Materialize PG sample game |
| `play [--port 8765]` | HTTP server for sample/game `www/` |
| `--version` | Print package version |

---

## Supported engines

Detectors run in order; the highest-confidence match wins.

| Engine | Detection cues | Extract / apply (summary) |
|--------|----------------|---------------------------|
| **RPG Maker MV / MZ** | `www/data/System.json`, `js/rpg_*.js`, maps | Player strings from JSON; apply → `data_<lang>/` packs next to `data/` |
| **Ren'Py** | `*.rpy`, `game/`, `renpy/` | Dialogue-oriented lines; apply → translation sidecars under engine conventions |
| **Godot** | `project.godot`, `.tscn`, CSV translations | Translation-friendly text / CSV-style sources |
| **Unity (loose)** | `StreamingAssets`, loose JSON/CSV/TXT | Text scrapes under common loose-asset layouts |
| **Generic** | Fallback | Scans text-like files when no specialized engine matches |

Exact field filters skip pure asset names (faces, battlers, audio structs, etc.) on RPG Maker so you don’t “translate” file basenames.

---

## Providers & models

Providers come from **HandoffKit** (OpenAI-compatible + OpenCode + native vendors).

```bash
hk-localize providers
# OK opencode-go     deepseek-v4-flash          OPENCODE_API_KEY
# OK nvidia          z-ai/glm-5.2               NVIDIA_API_KEY
# OK groq            llama-3.3-70b-versatile    GROQ_API_KEY
# …
```

Roles (each can use a different provider/model):

| Role | Used for |
|------|----------|
| `analyzer` | Folder / risk summary |
| `translator` | Batch string translation |
| `reviewer` | LQA-style pass (when enabled in orchestration) |
| `chat` | Interactive fix chat |

Examples:

```bash
# OpenCode Go (default in settings)
export OPENCODE_API_KEY=sk-...
hk-localize set-model --all --provider opencode-go --model deepseek-v4-flash

# NVIDIA NIM
export NVIDIA_API_KEY=nvapi-...
hk-localize set-model --all --provider nvidia --model z-ai/glm-5.2

# Groq
export GROQ_API_KEY=gsk_...
hk-localize set-model --all --provider groq --model llama-3.3-70b-versatile
```

Set only the translator:

```bash
hk-localize set-model --role translator --provider nvidia --model z-ai/glm-5.2
```

---

## Workspace layout

Config and work files live under your home directory (not inside the game unless you apply):

```
~/.handoffkit-localize/
  settings.json          # game path, targets, agents, batch sizes
  workspace/
    catalog/
      strings_en.jsonl   # extracted source strings + ids
    memory/
      es.json            # id → translation
      zh.json
      …
    logs/
      analyze_report.json
      quality/
        quality_es.json  # heuristic reports
    glossary/            # optional name locks (if you add them)
    sample_quest/        # created by sample-init / play fallback
```

| Concept | Meaning |
|---------|---------|
| **Catalog** | Source strings once; ids are stable hashes of text |
| **Memory** | Per-language map `id → translated text` (resume-friendly) |
| **Apply mapping** | Only strings that differ from English are written into packs |

Orchestration knobs in `settings.json` (defaults):

- `max_items` — strings per LLM batch (default 60)  
- `max_tokens` — generation budget  
- `agents_per_sub` / `subs_per_lang` — parallelism hints for multi-agent layouts  

---

## Heuristic quality (not LLM magic)

`hk-localize quality` writes reports with a **0–100** composite score:

| Component | Weight | Idea |
|-----------|--------|------|
| **coverage** | 35% | How much of the catalog has a memory entry |
| **freshness** | 25% | Not left identical to English |
| **hygiene** | 20% | Avoid empty strings / broken `\n` dumps |
| **brevity** | 10% | Penalize extreme length blow-ups |
| **speakers** | 10% | Speaker prefix consistency when glossary known |

Use it to track **progress and hygiene**, not as a native-fluency grade.

---

## Architecture (agents)

```
Meta-Analyzer          detect engine + extract plan
SuperOrchestrator
  └── per language
        ├── translator workers (batched LLM calls)
        └── optional reviewer / chat-fix
Heuristic quality      logs/quality/
```

Public package defaults lean on HandoffKit providers; batch prompts ask for **JSON arrays** of `{id, text}` and preserve placeholders.

---

## Typical workflows

### A. Learn the tool with the sample

```bash
hk-localize sample-init
hk-localize set-model --all --provider opencode-go --model deepseek-v4-flash
hk-localize run --langs es --limit 30
hk-localize play
```

### B. Spanish-only pass on a real RPG Maker game

```bash
hk-localize set-game "C:/Games/MyMVGame"
hk-localize set-targets es
hk-localize extract
hk-localize translate --langs es
hk-localize apply
# Launch the game; select Español if the project uses language packs / plugins
```

### C. Resume after interruption

Memory is incremental. Re-run `translate` without `--force` to fill only missing ids. Use `--force` to redo everything.

### D. Fix a few bad lines

```bash
hk-localize chat --lang es
```

---

## Troubleshooting

| Symptom | What to try |
|---------|-------------|
| `game_root missing` | `set-game PATH` or `sample-init` |
| Provider key missing | `providers` / `doctor`; export the env var shown |
| Empty catalog | Run `extract`; confirm engine detection via `analyze` |
| Translate does nothing | Catalog empty, or memory already complete (try `--force` / `--limit`) |
| Sample blank / CORS errors | Use `hk-localize play` (HTTP). Do **not** open `index.html` via `file://` |
| Apply no visible change | Memory still equal to English; check `quality` freshness |
| Wrong engine detected | Inspect `logs/analyze_report.json`; generic fallback may need cleaner layout |

---

## Library usage (optional)

Most users only need the CLI. Internally:

```python
from handoffkit_localize.engines import analyze, get_engine
from handoffkit_localize.pipeline import run_extract, run_translate, run_apply
from handoffkit_localize.settings import set_game_root

set_game_root("D:/Games/MyGame")
run_extract()
run_translate(langs=["es"], limit=20)
run_apply(langs=["es"])
```

---

## Project layout (package source)

```
packages/localize/
  handoffkit_localize/
    cli.py              # hk-localize entry
    tui_app.py          # Textual UI
    pipeline.py         # extract / translate / apply / quality
    engines/            # rpgmaker, renpy, godot, unity, generic
    providers_factory.py
    quality.py
    sample.py           # PG ballot sample writer
    settings.py         # ~/.handoffkit-localize
  _demo_ballot/         # sample assets embedded for demos
  tests/
  pyproject.toml
  README.md
```

---

## Related

- Core multi-agent runtime: [`handoffkit`](https://github.com/DaosPath/handoffkit) (PyPI)  
- Monorepo docs and other packages: repository root  

---

## License

MIT — see [`LICENSE`](./LICENSE).
