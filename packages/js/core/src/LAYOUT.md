# @handoffkit/core source layout

The public entrypoint is `index.js`; implementation is split into focused browser-safe modules.

| Module | Responsibility |
|--------|----------------|
| `utils.js` | Constants, pure helpers, JSON helpers, version |
| `contracts.js` | HandoffState, validation, contract parity |
| `providers-core.js` | Base, echo, fallback, OpenAI and Ollama providers |
| `safety.js` | Dangerous commands and approval helpers |
| `tools.js` | Tool registry and provider adapters |
| `agent.js` | Agent and run results |
| `team.js` | Handoff protocol and teams |
| `quality.js` | Handoff quality evaluation |
| `tracing.js` | Trace, timeline and replay models |
| `context.js` | Context documents and packs |
| `evaluation.js` | Workflow evaluation |
| `memory.js` | In-memory stores and reports |
| `extensions.js` | Extension registry |

`index.monolith.js` and `split.mjs` are archival migration artifacts, excluded from npm tarballs. Running the splitter requires `--force-regenerate` because it can overwrite hardened modules.

```bash
pnpm --filter @handoffkit/core check
pnpm --filter @handoffkit/core test
```
