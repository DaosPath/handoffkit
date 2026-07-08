# HandoffKit Shared Contracts

This folder is the language-neutral contract layer for HandoffKit.

Both runtimes must treat these JSON shapes as canonical:

- Python package: `packages/python`
- JavaScript package: `packages/core`

Rules:

- wire JSON uses `snake_case`,
- runtimes may expose ergonomic local naming, but must read and write the
  canonical fixtures,
- normal tests stay offline and deterministic,
- provider payloads and secrets do not belong here.

## Files

- `schemas/handoff-state.schema.json`
- `schemas/run-trace.schema.json`
- `fixtures/handoff_state.json`
- `fixtures/run_trace.json`
