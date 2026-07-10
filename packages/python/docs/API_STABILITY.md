# HandoffKit API Stability

HandoffKit 1.0.0 is the first stable API release. Public exports listed in
`docs/PUBLIC_API.md` are covered by compatibility tests and should not receive
breaking changes in later 1.x releases.

## Stable 1.0 APIs

- `Agent`, `Team`, `HandoffState`, `HandoffProtocol`
- `Tool`, `ToolCall`, `ToolResult`, `ToolRegistry`
- `Recipe`, `RecipeStep`, `RecipeRunner`, `RecipeRunResult`
- `ValidationReport`, `HandoffQualityReport`
- `ProviderToolAdapter`
- `RunTrace`, `ReplayRunner`
- `WorkflowEvaluator`, `WorkflowEvaluationReport`
- `TemplateScaffolder`, `ProjectTemplate`

## Python ↔ JavaScript parity

- Public runtime APIs that exist in both languages must stay **1:1** in
  behavior and **snake_case** JSON wire format.
- JavaScript may use camelCase constructors/properties; `toDict` / `toWire`
  must match Python `to_dict`.
- Shared surface (including media context handoffs in 1.13+) ships in the
  **same release** for Python (`handoffkit`) and JS (`@handoffkit/*`).
- Language-only exceptions: native CLIs, Rust/C++ contract layers, and
  intentionally single-language packages (e.g. `handoffkit-localize`).

## Compatibility Rules

- Existing `validate()` methods keep returning the original success value or
  raising their existing error type.
- Synchronous APIs keep their 0.9.0 behavior.
- Async helpers are additive and run sequentially by default where handoff order
  matters.
- Trace and replay APIs do not re-execute providers, tools, shell commands, or
  file writes.
- Normal tests and examples stay offline unless explicitly marked as API tests.
- New runtime dependencies are avoided in the core package.
- Public constructors and methods listed in `docs/PUBLIC_API.md` are covered by
  compatibility tests.

## Experimental Areas

- Provider-specific integration examples.
- Future cloud/service integrations.
- Any API not exported from `handoffkit.__init__`.
