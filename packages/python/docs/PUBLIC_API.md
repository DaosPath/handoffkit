# HandoffKit Public API

HandoffKit 1.x keeps a **small stable core** plus **extended** surface.
See also `DEPRECATION.md` for how removals work.

| Tier | Compatibility | Examples |
|------|---------------|----------|
| **Stable** | Hard 1.x promise | Agent, Team, HandoffState, Tool*, validation, traces |
| **Extended** | Soft; aliases preferred | Media context handoffs, showcases, CLI helpers |
| **Experimental** | May change | Provider matrix, Studio APIs, Rust/C++ runtime |

`handoffkit.__all__` may export more than the Stable set for convenience.
**Application code should import Stable symbols first**; treat the rest as
Extended unless listed below as Stable.

## Stable — Core Workflow

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

## Stable — Media (classic contracts)

- `MediaAsset`
- `TranscriptSegment`
- `SpeakerProfile`
- `DubbingSegment`
- `MediaWorkflowReport`
- `build_dubbing_plan`
- `format_srt_timestamp`
- `write_srt`
- `write_transcript_json`
- `read_transcript_json`
- `ffmpeg_available`
- `extract_audio`
- `mux_audio`

## Extended — Media context handoffs (1.13+)

- `MEDIA_OPERATIONS`, `MediaOperationSpec`, `MediaContext`, `MediaEditionOp`
- `build_media_context`, `handoff_media_context`, `plan_media_pipeline`
- `build_creation_context`, `build_generation_context`, `build_edition_context`
- `apply_transcript_editions`, `media_context_to_workflow_report`

## Extended — Tool sandbox (1.14+)

- `ToolSandbox`, `SandboxError`, `get_sandbox`, `set_sandbox`, `reset_sandbox`

## Compatibility Promise

**Stable** APIs should not be removed or receive breaking signature changes in
1.x without a documented migration path. **Extended** APIs follow
`DEPRECATION.md` soft rules.
