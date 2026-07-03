# HandoffKit API Stability

HandoffKit 0.8.0 starts the road to a 1.0 API contract. The project is still
pre-1.0, but these APIs are intended to remain stable unless a 1.0 preparation
issue finds a clear design problem.

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

## Experimental Areas

- Provider-specific integration examples.
- Future cloud/service integrations.
- Any API not exported from `handoffkit.__init__`.
