# HandoffKit Public API

HandoffKit 1.0.0 treats the following exports as stable public API for the 1.x
series. Runtime behavior is governed by docs, tests, and public type
signatures.

## Core Workflow

- `Agent`
- `Team`
- `TeamRunResult`
- `HandoffState`
- `HandoffProtocol`

Stable sync methods remain the compatibility baseline. Async helpers
`Agent.arun()`, `Agent.arun_structured()`, `Agent.arun_with_context()`,
`Agent.arun_with_tools()`, `Team.arun()`, and `RecipeRunner.arun()` are additive
1.x APIs.

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

- `EvaluationCheck`
- `EvaluationResult`
- `WorkflowEvaluationReport`
- `WorkflowEvaluator`
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

- `ProjectTemplate`
- `ScaffoldResult`
- `TemplateFile`
- `TemplateScaffolder`
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

These APIs should not be removed or receive breaking signature changes in 1.x
without a documented migration path.
