# HandoffKit Shared Contracts

This folder is the language-neutral contract layer for HandoffKit.

All runtimes must treat these JSON shapes as canonical:

- Python package: `packages/python`
- JavaScript package: `packages/js/core`
- Rust package: `packages/rust`
- C++ package: `packages/cpp`

Rules:

- wire JSON uses `snake_case`,
- runtimes may expose ergonomic local naming, but must read and write the
  canonical fixtures,
- normal tests stay offline and deterministic,
- provider payloads and secrets do not belong here.
- contract parity reports should stay deterministic and offline.

HK-CSP means **Communicating Sequential Processes**. It is HandoffKit's
execution coordination layer, not a browser Content Security Policy. Existing
handoff contracts describe what moves between agents; HK-CSP envelopes describe
how it moves while a workflow is running.

## Files

- `schemas/handoff-state.schema.json`
- `schemas/run-trace.schema.json`
- `schemas/validation-report.schema.json`
- `schemas/quality-report.schema.json`
- `schemas/tool-call.schema.json`
- `schemas/tool-result.schema.json`
- `schemas/provider-tool-schema.schema.json`
- `schemas/message-envelope.schema.json`
- `schemas/session-config.schema.json`
- `schemas/channel-config.schema.json`
- `schemas/delivery-ack.schema.json`
- `schemas/delivery-nack.schema.json`
- `schemas/process-error.schema.json`
- `schemas/worker-capabilities.schema.json`
- `schemas/artifact-ref.schema.json`
- `schemas/training-job.schema.json`
- `schemas/evaluation-job.schema.json`
- `schemas/job-progress.schema.json`
- `fixtures/handoff_state.json`
- `fixtures/run_trace.json`
- `fixtures/validation_report.json`
- `fixtures/quality_report.json`
- `fixtures/tool_call.json`
- `fixtures/tool_result.json`
- `fixtures/provider_tool_schema.json`
- corresponding CSP and worker fixtures under `fixtures/`
