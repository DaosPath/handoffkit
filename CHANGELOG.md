# Changelog

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
