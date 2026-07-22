# HandoffKit Roadmap

Last updated: 2026-07-10

This document is the product roadmap for **HandoffKit** (core runtimes + Studio web).  
Status legend: **Done** · **In progress** · **Planned** · **Later**

---

## 1.14 — Security, quality gates, product maturity

### P0 — before any production use (**In progress**)

| Item | Status | Notes |
|------|--------|--------|
| Terminal execution **without** `shell=True` | **Done** | Python `run_command` uses argv + `shell=False`; JS ffmpeg helpers use `spawn` argv |
| Mandatory tool **sandbox** | **Done** | `handoffkit.sandbox.ToolSandbox`; FS tools resolve under workspace |
| Restrict filesystem to **workspace** | **Done** | `HANDOFFKIT_WORKSPACE` or cwd; path escape raises |
| **Approvals on by default** | **Done** | `require_approval` defaults from sandbox (`True`); mutating tools blocked until bypass |
| CI **Ruff blocking** + release gate | **Done** | Ruff before tests in CI; Publish `quality-gate` job must pass before build/npm |
| Tests safe for **sdist** (missing monorepo files) | **Done** | skip helpers when contracts/`.github` absent; docs resolve via package root |
| **Coverage gate** for tools + validation | **Done** | `--cov-fail-under=80` on tools/safety/sandbox/validation modules |

### P1 — stabilization (**In progress**)

| Item | Status | Notes |
|------|--------|-------|
| Split `cli.py` | **Done** | Implementation under `handoffkit/_cli/` (demos, media, project, main); thin `cli.py` facade |
| Split JS `core/index.js` | **Done** | Modular sibling modules + `index.js` facade; tests green |
| Medical datasets out of `.py` | **Done** | JSON under `handoffkit/benchmarks/data/`; loaders stay thin |
| Freeze smaller public API | **Done** | `PUBLIC_API.md` tiers: Stable / Extended / Experimental |
| Deprecation policy | **Done** | `docs/python/DEPRECATION.md` + release cadence |
| Studio: DB, auth, workspaces | **Done (v1)** | Wired into MAI panel run save/list APIs; file-backed, DB-ready |
| Fix Rust / C++ docs | **Done** | Clear “under construction” READMEs (UTF-8) |
| Fewer releases, consolidated changelogs | **Done** | Documented in DEPRECATION.md |

### P2 — external credibility (**In progress / foundation**)

| Item | Status | Notes |
|------|--------|-------|
| Independent benchmark | **Published** | Methodology `handoffkit-protocol-v1` + APIs/CLI; no public leaderboard |
| External use cases | **Docs** | Integration guides + comparison table |
| Comparison vs LangGraph / AutoGen / CrewAI / OpenAI Agents SDK | **Foundation** | Same-task protocol in EXTERNAL_BENCHMARK.md |
| Cost / latency / context-loss / recovery metrics | **Done** | `handoffkit.benchmarks.metrics` |
| Open contributions + issues hygiene | **Done** | Root `CONTRIBUTING.md` |
| Second maintainer | **Policy** | Stated goal in CONTRIBUTING (onboarding pending people) |
| Published threat model | **Done** | `docs/python/THREAT_MODEL.md` |

---

## Studio (apps/web) — now

| Item | Status | Notes |
|------|--------|--------|
| Liquid-glass landing + docs | **Done** | Next.js app under `apps/web` |
| Studio demos hub (`/demos`) | **Done** | Featured demo + catalog |
| MAI-style expert panel live | **Done** | Streamed multi-agent run |
| Provider switch: NVIDIA NIM ↔ Groq | **Done** | Per-agent model pickers |
| Benchmark / simple / blank cases | **Done** | Case library presets |
| Top-3 consensus UI + parse recovery | **Done** | `RANKINGS_JSON` + prose fallbacks |
| Live execution report + token usage | **Done** | Groq metered; NIM trial = $0 |
| **Local run history** | **Done** | Filesystem JSON under `apps/web/.data/mai-runs/` (gitignored) |
| Export benchmark corpus (API) | **Done** | `GET /api/demos/mai-panel/runs?export=benchmark` |
| CI: web typecheck + studio tests | **Done** | GitHub Actions web job |

### Explicit gap: run history is **not** database-backed yet

Today:

- Runs are saved **on the app server’s local disk** (`.data/mai-runs/*.json`).
- Good for single-node Studio demos and local development.
- **Not** multi-instance, multi-user, or durable across deploys/redeploys.

**Planned (see below):** database-backed run history so high volume can power a public MAI-style benchmark.

---

## Studio — next (near term)

| Item | Status | Priority | Notes |
|------|--------|----------|--------|
| **Database-backed run history** | **Planned** | **P0** | Postgres (or SQLite for self-host) + migrations; replace filesystem store |
| Auth / workspace scoping for runs | **Planned** | P1 | So multi-user Studio doesn’t share one flat log |
| Run detail page (reload a past run) | **Planned** | P1 | Full answer, rankings, handoffs, costs |
| Background export jobs for corpus | **Planned** | P2 | Large benchmark dumps without blocking API |
| Live demos beyond MAI panel | **Planned** | P2 | Coding review, support, rescue (still mock UI today) |
| Cloud durable storage for traces | **Later** | P2 | S3/R2 for large final answers / traces |

### Why DB history is on the roadmap (benchmark path)

1. **Many users** run the live panel → each run stores task hash, models, rankings, usage, success.
2. **DB history** keeps that durable and queryable (by provider, model, case preset, time).
3. When volume is high → **export / aggregate** → public **MAI-style benchmark** (scores, calibration, cost, latency).

Local file history is the **bootstrap**. Database history is the **prerequisite** for serious multi-user benchmarking.

---

## Benchmark program (after traffic)

| Item | Status | Depends on |
|------|--------|------------|
| Public MAI-style panel benchmark | **Later** | DB history + volume + scoring rubric |
| Gold labels for fixed case packs | **Planned** | Benchmark case library (partially started in Studio) |
| Leaderboard (models × providers) | **Later** | Aggregated runs + fair eval protocol |
| Cost / latency Pareto charts | **Later** | Metered usage (Groq done; multi-provider expand) |

---

## Core runtimes

| Item | Status | Notes |
|------|--------|--------|
| Python primary runtime | **Done** | PyPI `handoffkit` |
| JS/TS core + monorepo packages | **Done** | `@handoffkit/core`, CLI, recipes, … |
| OpenAI-compatible provider usage capture | **Done** | `lastUsage` for Studio cost estimates |
| Rust contracts | **Done** | Full agent runtime still limited |
| C++ contracts | **Done** | Wire types + fixture round-trips |
| C++ runtime core | **Done** | C++20 Agent/Team/Tools/Protocol + `handoffkit::core` / demos split; fallback+usage; safe tools; install consumer smoke (`examples/consumer_core`); Conan/vcpkg overlays; release tarball+attestations in publish.yml |
| Go runtime package | **Planned** | README target `1.9.0`-era idea; keep if still desired |
| Cross-runtime contract suite in CI | **In progress** | Python + JS + Rust + C++ + web jobs |

---

## Version framing (high level)

| Horizon | Theme |
|---------|--------|
| **Now** | Studio live MAI panel, dual providers, local run log, CI green |
| **Next** | **DB run history**, auth/workspaces, richer run replay UI |
| **Then** | Public benchmark from real multi-user Studio traffic |
| **2.x** | Deeper web visualizer / multi-demo live orchestration |

---

## Non-goals (for now)

- Shipping secrets or live run JSON to the public git repo  
- Treating NIM free trial as a commercial cost source of truth  
- Replacing Python as the primary research/benchmark CLI overnight  

---

## Related paths

| Path | Role |
|------|------|
| `apps/web/src/lib/studio/run-history.ts` | Local filesystem history (current) |
| `apps/web/src/app/api/demos/mai-panel/runs` | List / get / export API |
| `apps/web/.data/mai-runs/` | Local storage (gitignored) |
| `.github/workflows/ci.yml` | CI including studio tests |
