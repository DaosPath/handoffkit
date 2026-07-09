# HandoffKit Shared Contracts

This folder is the language-neutral contract layer for HandoffKit.

All runtimes must treat these JSON shapes as canonical:

- Python package: `packages/python`
- JavaScript package: `packages/js`
- Rust package: `packages/rust`
- C++ package: `packages/cpp`

Rules:

- wire JSON uses `snake_case`,
- runtimes may expose ergonomic local naming, but must read and write the
  canonical fixtures,
- normal tests stay offline and deterministic,
- provider payloads and secrets do not belong here.
- contract parity reports should stay deterministic and offline.

## Files

- `schemas/handoff-state.schema.json`
- `schemas/run-trace.schema.json`
- `schemas/validation-report.schema.json`
- `schemas/quality-report.schema.json`
- `schemas/tool-call.schema.json`
- `schemas/tool-result.schema.json`
- `schemas/provider-tool-schema.schema.json`
- `fixtures/handoff_state.json`
- `fixtures/run_trace.json`
- `fixtures/validation_report.json`
- `fixtures/quality_report.json`
- `fixtures/tool_call.json`
- `fixtures/tool_result.json`
- `fixtures/provider_tool_schema.json`
