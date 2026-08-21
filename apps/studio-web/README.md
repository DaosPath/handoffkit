# Handoff Kit Web (Studio + docs)

Next.js app for the HandoffKit monorepo: marketing/docs site and **Handoff Kit Studio** demos.

## Commands

From the repository root:

```powershell
pnpm web:dev
pnpm web:lint
pnpm web:build
pnpm web:test:studio
```

Or from this folder:

```powershell
pnpm run lint
pnpm run build
pnpm run test:studio
pnpm exec next dev -p 3000
```

## Studio MAI panel

- Live multi-agent panel: `/demos/mai-style-panel`
- Providers: **NVIDIA NIM** and **Groq** (API keys via env)
- Env (server-only, not committed): `NVIDIA_API_KEY`, `GROQ_API_KEY`, optional model/base URL overrides

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
