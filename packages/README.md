# Packages

Workspace packages live here.

**Parity:** public Python â†” JavaScript runtime surface ships **1:1** (same
release, snake_case wire JSON). See `python/docs/API_STABILITY.md`.

- `python/`: published Python package (`handoffkit` on PyPI).
- `localize/`: public game i18n app (`handoffkit-localize` / `hk-localize`) — multi-engine, Textual TUI, PG sample demo.
- `contracts/`: shared JSON schemas and canonical fixtures used by Python,
  JavaScript, Rust, and C++ tests.
- `js/core/`: browser-safe JavaScript/TypeScript contract layer
  (`@handoffkit/core`) with async agents, tool format adapters, traces, and
  in-memory report helpers.
- `js/node/`: Node.js-only filesystem helpers (`@handoffkit/node`) for trace
  files, report files, project indexing, and contract inventory inspection.
- `js/next/`: reserved for future Next.js helpers.
- `js/providers/`: reserved for future provider routing helpers.
- `rust/`: Rust contract layer.
- `cpp/`: C++ contract layer.
