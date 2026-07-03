# Changelog

## 0.9.0

- Promoted package maturity classifier to beta.
- Added final pre-1.0 public API, migration, and compatibility documentation.
- Added public API export and signature compatibility tests.
- Added local wheel install smoke coverage.
- Hardened provider tool adapter validation for malformed payloads.
- Improved README and road-to-1.0 documentation.

## 0.8.0

- Added run tracing and replay summaries.
- Added FileTraceStore.
- Added report file utilities.
- Added CLI doctor, api, trace, replay and report validation commands.
- Added stable API documentation for the road to 1.0.
- Added JSON schema helpers for core contracts.
- Improved handoff quality evaluator configuration.
- Hardened provider tool adapter validation.

## 0.7.0

- Added reusable validation reports and contract validators.
- Added deterministic handoff quality metrics and reports.
- Added provider-native tool formats for HandoffKit, OpenAI, and Anthropic shapes.
- Added provider_adapter support to Agent.run_with_tools().
- Added quality, validator, and provider-format CLI demos.
- Added offline examples and Markdown/JSON reports for 0.7.0 workflows.
- Expanded tests for validators, quality scoring, provider adapters, and CLI demos.

## 0.6.0

- Added StructuredOutputSchema and StructuredOutputResult.
- Added JsonOutputParser and OutputRepairer.
- Added Agent.run_structured().
- Added ProviderCapabilities and ProviderToolAdapter.
- Added ToolCallParser for provider-style tool calls.
- Added provider_json mode to Agent.run_with_tools().
- Added structured output and provider tool adapter demos.
- Added tests for structured outputs and provider tool call normalization.

## 0.5.0

- Added RecipeStep, Recipe, RecipeRunner and RecipeRunResult.
- Added WorkflowTemplate for reusable agent workflow patterns.
- Added Extension and ExtensionRegistry.
- Added built-in recipe factories.
- Added recipe and extension demos.
- Added Markdown/JSON recipe reports.
- Added tests for recipes, templates and extensions.

## 0.4.0

- Added MemoryItem, MemoryStore, and JsonMemoryStore.
- Added project context indexing and retrieval.
- Added ContextPack for packaging retrieved files and memories.
- Added Agent.run_with_context().
- Added context_refs to HandoffState.
- Added memory and project-context examples.
- Added context handoff demo.
- Expanded README for memory and context workflows.

## 0.3.0

- Added ToolCall and ToolResult.
- Added ToolRegistry.
- Added Agent.run_with_tools().
- Added deterministic local tool execution.
- Added provider JSON tool-call loop.
- Added basic safety layer for shell/write operations.
- Added tool execution reports.
- Added examples for local and fake-provider tool execution.
- Added tests for tool execution flow.

## 0.2.0

- Added JSON-schema-style tool metadata with `Tool.to_schema()`
- Strengthened `HandoffState` contract validation
- Improved protocol-difference tests and examples
- Added a tool schema demo example
- Expanded README for package consumers
- Added basic Ruff lint configuration

## 0.1.1

- Added GitHub Actions CI
- Added badges
- Added Ollama example
- Added multi-agent coding team example
- Improved README
- Improved package validation
