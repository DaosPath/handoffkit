# HandoffKit Public API

HandoffKit 0.9.0 treats the following exports as 1.0 candidates. The exact
runtime behavior remains governed by the docs, tests, and type signatures in the
package.

## Core Workflow

- `Agent`
- `Team`
- `TeamRunResult`
- `HandoffState`
- `HandoffProtocol`

## Tools and Providers

- `Tool`
- `tool`
- `ToolCall`
- `ToolResult`
- `ToolRegistry`
- `ToolExecutionReport`
- `ProviderCapabilities`
- `ProviderToolAdapter`
- `ProviderToolFormat`
- `ToolCallParser`

## Structured Output, Validation, Quality

- `StructuredOutputSchema`
- `StructuredOutputResult`
- `JsonOutputParser`
- `OutputRepairer`
- `OutputValidationError`
- `ValidationIssue`
- `ValidationReport`
- `HandoffValidationError`
- `HandoffStateValidator`
- `StructuredOutputValidator`
- `ToolSchemaValidator`
- `HandoffQualityMetric`
- `HandoffQualityReport`
- `HandoffQualityEvaluator`

## Recipes, Context, Memory, Extensions

- `Recipe`
- `RecipeStep`
- `RecipeRunner`
- `RecipeRunResult`
- `WorkflowTemplate`
- `ContextDocument`
- `ContextPack`
- `ContextRetriever`
- `ContextRunResult`
- `ProjectIndexer`
- `MemoryItem`
- `MemoryStore`
- `JsonMemoryStore`
- `MemoryReport`
- `Extension`
- `ExtensionRegistry`

## Trace, Replay, Reports

- `TraceEvent`
- `TraceStep`
- `RunTrace`
- `FileTraceStore`
- `ReplaySummary`
- `ReplayRunner`
- `write_report_files`
- `load_report_json`

## Compatibility Promise

These APIs should not be removed or receive breaking signature changes before
1.0 unless a final release-candidate test finds a correctness issue.
