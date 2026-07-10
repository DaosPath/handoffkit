# @handoffkit/core source layout (P1)

The public entry remains `index.js` (single bundle for Node resolution + types).

**Planned incremental split** (same export surface):
- `contracts.js` — HandoffState, Validation*, ContractParity
- `runtime.js` — Agent, Team, Protocol
- `tools.js` — Tool*, safety
- `memory.js` / `extensions.js` / `evaluation.js`

Until the split lands with full inter-module imports and tests green,
keep `index.js` as the canonical implementation. Do not reintroduce a
half-split without updating `core.test.js`.
