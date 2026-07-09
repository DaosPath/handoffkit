"""Compatibility tests for the stable 1.0 public API surface."""

# ruff: noqa: E501

from __future__ import annotations

import inspect

import handoffkit
from handoffkit import (
    Agent,
    HandoffProtocol,
    HandoffState,
    ProviderToolAdapter,
    RecipeRunner,
    ReplayRunner,
    RunTrace,
    StructuredOutputSchema,
    Team,
)

EXPECTED_EXPORTS = [
    "Agent",
    "ContextDocument",
    "ContextPack",
    "ContextRetriever",
    "ContextRunResult",
    "ContractParityReport",
    "DeclarativeTool",
    "DubbingSegment",
    "EvaluationCheck",
    "EvaluationResult",
    "Extension",
    "ExtensionRegistry",
    "FileTraceStore",
    "HandoffProtocol",
    "HandoffQualityEvaluator",
    "HandoffQualityMetric",
    "HandoffQualityReport",
    "HandoffState",
    "HandoffStateValidator",
    "HandoffValidationError",
    "HttpJsonTool",
    "JsonMemoryStore",
    "JsonOutputParser",
    "MediaAsset",
    "MediaWorkflowReport",
    "MemoryItem",
    "MemoryReport",
    "MemoryStore",
    "OutputRepairer",
    "OutputValidationError",
    "ProjectIndexer",
    "ProjectTemplate",
    "ProviderCapabilities",
    "ProviderToolAdapter",
    "ProviderToolFormat",
    "Recipe",
    "RecipeRunResult",
    "RecipeRunner",
    "RecipeStep",
    "ReplayRunner",
    "ReplaySummary",
    "RunTrace",
    "ScaffoldResult",
    "ShowcaseResult",
    "SpeakerProfile",
    "StructuredOutputResult",
    "StructuredOutputSchema",
    "StructuredOutputValidator",
    "Team",
    "TeamRunResult",
    "TemplateFile",
    "TemplateScaffolder",
    "Tool",
    "ToolCall",
    "ToolCallParser",
    "ToolExecutionReport",
    "ToolFactory",
    "ToolRegistry",
    "ToolResult",
    "ToolSchemaValidator",
    "ToolSpec",
    "TraceEvent",
    "TraceStep",
    "TranscriptSegment",
    "ValidationIssue",
    "ValidationReport",
    "WorkflowEvaluationReport",
    "WorkflowEvaluator",
    "WorkflowTemplate",
    "__version__",
    "build_contract_parity_report",
    "build_dubbing_plan",
    "build_showcase",
    "create_extension",
    "delete_key",
    "extract_audio",
    "ffmpeg_available",
    "format_srt_timestamp",
    "init_project",
    "init_project_interactive",
    "list_keys",
    "list_providers",
    "load_dynamic_extensions",
    "load_report_json",
    "mux_audio",
    "read_transcript_json",
    "render_report",
    "render_report_html",
    "run_demo",
    "run_named_showcase",
    "run_recipe_demo",
    "run_showcase",
    "set_key",
    "showcase_names",
    "tool",
    "write_project_report",
    "write_report_files",
    "write_report_html",
    "write_srt",
    "write_transcript_json",
]


def test_public_all_exports_are_explicit_and_stable() -> None:
    assert sorted(handoffkit.__all__) == EXPECTED_EXPORTS


def test_public_exports_are_importable() -> None:
    for name in EXPECTED_EXPORTS:
        assert hasattr(handoffkit, name), name


def test_key_public_signatures_are_stable() -> None:
    signatures = {
        "Agent": Agent,
        "Team": Team,
        "HandoffState": HandoffState,
        "HandoffProtocol": HandoffProtocol,
        "ProviderToolAdapter": ProviderToolAdapter,
        "RunTrace": RunTrace,
        "ReplayRunner": ReplayRunner,
        "RecipeRunner": RecipeRunner,
        "StructuredOutputSchema": StructuredOutputSchema,
    }

    expected = {
        "Agent": "(name: 'str', role: 'str', *, model: 'str' = 'echo', tools: 'Sequence[Tool | Callable[..., Any]] | None' = None, provider: 'BaseProvider | None' = None, memory: 'AgentMemory | None' = None) -> 'None'",
        "Team": "(agents: 'Sequence[Agent]', *, protocol: 'HandoffProtocol | None' = None) -> 'None'",
        "HandoffState": "(task: 'str', from_agent: 'str', to_agent: 'str', summary: 'str' = '', decisions: 'list[str]' = <factory>, important_files: 'list[str]' = <factory>, errors: 'list[str]' = <factory>, next_steps: 'list[str]' = <factory>, context_refs: 'list[str]' = <factory>, metadata: 'dict[str, Any]' = <factory>) -> None",
        "HandoffProtocol": "(mode: 'ProtocolMode' = 'hybrid_state') -> 'None'",
        "ProviderToolAdapter": "(*, capabilities: 'ProviderCapabilities | None' = None, provider_format: 'ProviderToolFormat | None' = None) -> 'None'",
        "RunTrace": "(run_id: 'str', name: 'str', success: 'bool', final_output: 'str', steps: 'list[TraceStep]' = <factory>, handoffs: 'list[HandoffState | dict[str, Any]]' = <factory>, metadata: 'dict[str, Any]' = <factory>) -> None",
        "ReplayRunner": "(trace: 'RunTrace') -> 'None'",
        "RecipeRunner": "(recipe: 'Recipe', *, protocol: 'HandoffProtocol | None' = None) -> 'None'",
        "StructuredOutputSchema": "(name: 'str', fields: 'dict[str, type[Any] | Any]', description: 'str' = '', required: 'list[str]' = <factory>, metadata: 'dict[str, Any]' = <factory>) -> None",
    }

    assert {name: str(inspect.signature(symbol)) for name, symbol in signatures.items()} == expected


def test_key_public_method_signatures_are_stable() -> None:
    methods = {
        "HandoffState.validate": HandoffState.validate,
        "HandoffState.json_schema": HandoffState.json_schema,
        "StructuredOutputSchema.validate": StructuredOutputSchema.validate,
        "ProviderToolAdapter.tools_to_provider_format": ProviderToolAdapter.tools_to_provider_format,
        "ProviderToolAdapter.parse_tool_calls": ProviderToolAdapter.parse_tool_calls,
        "ProviderToolAdapter.parse_final": ProviderToolAdapter.parse_final,
        "RunTrace.from_team_result": RunTrace.from_team_result,
        "RunTrace.from_recipe_result": RunTrace.from_recipe_result,
        "RunTrace.from_tool_execution_report": RunTrace.from_tool_execution_report,
        "RecipeRunner.run": RecipeRunner.run,
    }
    expected = {
        "HandoffState.validate": "(self) -> 'HandoffState'",
        "HandoffState.json_schema": "() -> 'dict[str, Any]'",
        "StructuredOutputSchema.validate": "(self, data: 'dict[str, Any]') -> 'dict[str, Any]'",
        "ProviderToolAdapter.tools_to_provider_format": "(self, tools: 'list[Tool] | tuple[Tool, ...] | list[Any] | tuple[Any, ...]', provider_format: 'ProviderToolFormat | None' = None) -> 'list[dict[str, Any]]'",
        "ProviderToolAdapter.parse_tool_calls": "(self, provider_response: 'str | dict[str, Any]', provider_format: 'ProviderToolFormat | None' = None) -> 'list[ToolCall]'",
        "ProviderToolAdapter.parse_final": "(self, provider_response: 'str | dict[str, Any]') -> 'str | None'",
        "RunTrace.from_team_result": "(result: 'Any', *, run_id: 'str' = '', name: 'str' = 'team-run') -> 'RunTrace'",
        "RunTrace.from_recipe_result": "(result: 'Any', *, run_id: 'str' = '', name: 'str' = '') -> 'RunTrace'",
        "RunTrace.from_tool_execution_report": "(report: 'Any', *, run_id: 'str' = '', name: 'str' = 'tool-execution') -> 'RunTrace'",
        "RecipeRunner.run": "(self, initial_task: 'str | None' = None, memory: 'MemoryStore | None' = None, context: 'ContextPack | None' = None, tools: 'Sequence[Tool | Callable[..., Any]] | None' = None) -> 'RecipeRunResult'",
    }

    assert {name: str(inspect.signature(method)) for name, method in methods.items()} == expected
