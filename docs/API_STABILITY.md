# HandoffKit API Stability

HandoffKit 0.9.0 is the final pre-1.0 API audit. The project is still pre-1.0,
but these APIs are intended to remain stable unless a final compatibility issue
finds a clear design problem before 1.0.

## 1.0 Candidate APIs

- `Agent`, `Team`, `HandoffState`, `HandoffProtocol`
- `Tool`, `ToolCall`, `ToolResult`, `ToolRegistry`
- `Recipe`, `RecipeStep`, `RecipeRunner`, `RecipeRunResult`
- `ValidationReport`, `HandoffQualityReport`
- `ProviderToolAdapter`
- `RunTrace`, `ReplayRunner`

## Compatibility Rules

- Existing `validate()` methods keep returning the original success value or
  raising their existing error type.
- Trace and replay APIs do not re-execute providers, tools, shell commands, or
  file writes.
- Normal tests and examples stay offline unless explicitly marked as API tests.
- New runtime dependencies are avoided unless they become essential for 1.0.
- Public constructors and methods listed in `docs/PUBLIC_API.md` are covered by
  compatibility tests.

## Experimental Areas

- Provider-specific integration examples.
- Future cloud/service integrations.
- Any API not exported from `handoffkit.__init__`.
