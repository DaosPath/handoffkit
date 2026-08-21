# Handoff Kit Web (Studio + docs)

Next.js app for the HandoffKit monorepo: marketing/docs site and **Handoff Kit Studio** demos.

## Commands

From the repository root:

```powershell
pnpm web:dev
pnpm web:lint
pnpm web:build
pnpm web:test:studio
pnpm web:a11y:audit # with Studio running on :3100
pnpm browser:studio:interop
```

Or from this folder:

```powershell
pnpm run lint
pnpm run build
pnpm run test:studio
pnpm run a11y:audit # with Studio running on :3100
pnpm exec next dev -p 3000
```

## Studio clinical lab

- Sequential lab: `/demos/clinical-lab` (research / professional / public)
- Deprecated adapter: `/demos/mai-style-panel` (predefined vignettes only; no personal symptoms)
- Clinical lab providers: live role execution remains **unavailable** until a
  provider adapter is integrated and tested; the lab does not claim clinical
  validity or an official 897-case score.
- MAI-style panel providers: **Ollama local** is supported when its `/api/tags`
  endpoint responds; NVIDIA/Groq are optional OpenAI-compatible paths.
- Env (server-only, not committed): `OLLAMA_BASE_URL`, `OLLAMA_MODEL`,
  `NVIDIA_API_KEY`, `GROQ_API_KEY`, and optional model overrides
- Clinical runs: `apps/web/.data/clinical-runs/` (gitignored)

## Studio MAI panel

The panel discovers installed Ollama models at runtime and never marks a
hard-coded model as ready. Echo mode is explicit (`offline: true` in the API or
the UI checkbox); missing cloud credentials return `provider_unavailable`
instead of silently producing an offline result. A run is successful only when
all three experts return and the Judge emits exactly three distinct integer
weights summing to 100 plus a red-flag re-rank trigger. This is a research
orchestration demo, not a diagnostic or clinical-validity claim.

### Run history (current vs planned)

| Layer | Status | Where |
|-------|--------|--------|
| **Local filesystem history** | **Done** | `apps/web/.data/mai-runs/*.json` (gitignored) |
| List / detail / export API | **Done** | `/api/demos/mai-panel/runs` · `?export=benchmark` |
| UI “Run history” panel | **Done** | Bottom of MAI live demo |
| **Database-backed history** | **Planned (P0)** | See root [ROADMAP.md](../../ROADMAP.md) |
| Public MAI benchmark from traffic | **Later** | Needs DB history + volume |

Local history is enough for demos. **Do not treat it as production multi-user storage** — deploys and multi-instance hosts will not share the same log until the DB work lands.

## Layout

```
apps/web/src/app          # routes (docs, demos, APIs)
apps/web/src/components   # UI
apps/web/src/lib/studio   # MAI runner, models, rankings, run history
```

## Roadmap

Product roadmap (Studio + core): **[../../ROADMAP.md](../../ROADMAP.md)**.
