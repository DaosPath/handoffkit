# handoffkit-localize

**Public** multi-agent game localization CLI + rich TUI for [HandoffKit](https://github.com/DaosPath/handoffkit).

- Includes a short **PG** sample game for demos (`hk-localize sample-init` / `play`)
- Multi-engine: RPG Maker MV/MZ, Ren'Py, Unity (loose assets), Godot, generic
- Multi-provider via HandoffKit (OpenCode, Groq, NVIDIA, …)
- Heuristic quality scores (transparent, not LLM “magic scores”)
- Rich **Textual** TUI + classic CLI

Point `hk-localize set-game` at any supported game folder on your machine.  
This package ships only the PG sample; your own game files stay local and are not part of the published package.

## Install

```bash
pip install handoffkit-localize
# or from monorepo:
pip install -e packages/localize
```

Requires `handoffkit` and API keys for the providers you use.

## Quick start

```bash
# Rich TUI (default)
hk-localize

# CLI
hk-localize status
hk-localize set-game ./path/to/game
hk-localize providers
hk-localize set-model --all --provider opencode-go --model deepseek-v4-flash
hk-localize analyze
hk-localize run --no-review
hk-localize quality
hk-localize chat --lang es

# Political PG sample game
hk-localize sample-init
hk-localize play
# Browser opens http://127.0.0.1:8765/  (NOT file:// — CORS would block JSON)

# After translate+apply, switch Lang in the reader to show ES/ZH/…
hk-localize extract
hk-localize translate --langs es --limit 50
hk-localize apply
hk-localize play
```

### Sample game: *The Ballot and the Bridge*

Short **political intrigue** (election, press, parliament, unions, a contested bridge).  
**PG / public-safe.** ~300 extractable strings for translation demos.  
Play: **`hk-localize play`** (local HTTP server). Do not open `index.html` via `file://`.

## Architecture

```
Meta-Analyzer  → detect engine + extract plan
SuperOrchestrator
  └── LangMeta[lang]
        ├── SubOrchestrator × N → TranslatorAgent × 10
        └── ReviewerAgent × N (optional LQA)
Heuristic quality  → logs/quality/
Chat-fix          residual issues
```

## Engines

| Engine | Support |
|--------|---------|
| RPG Maker MV / MZ | Full extract/apply language packs |
| Ren'Py | Dialogue-oriented `.rpy` extract + sidecar |
| Godot | CSV / translation-friendly text |
| Unity builds | Loose JSON/CSV/TXT under StreamingAssets etc. |
| Generic | Text-like file scrape |

## License

MIT
