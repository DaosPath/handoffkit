"""Public API for HandoffKit."""

from handoffkit.agent import Agent
from handoffkit.context import (
    ContextDocument,
    ContextPack,
    ContextRetriever,
    ContextRunResult,
    ProjectIndexer,
)
from handoffkit.contracts import ContractParityReport, build_contract_parity_report
from handoffkit.errors import HandoffValidationError
from handoffkit.evaluation import (
    EvaluationCheck,
    EvaluationResult,
    WorkflowEvaluationReport,
    WorkflowEvaluator,
)
from handoffkit.extensions import Extension, ExtensionRegistry
from handoffkit.handoff import HandoffState
from handoffkit.recipes.media import (
    DubbingSegment,
    MediaAsset,
    MediaWorkflowReport,
    SpeakerProfile,
    TranscriptSegment,
    build_dubbing_plan,
    extract_audio,
    ffmpeg_available,
    format_srt_timestamp,
    mux_audio,
    read_transcript_json,
    write_srt,
    write_transcript_json,
)
from handoffkit.memory import JsonMemoryStore, MemoryItem, MemoryReport, MemoryStore
from handoffkit.protocol import HandoffProtocol
from handoffkit.provider_adapters import (
    ProviderCapabilities,
    ProviderToolAdapter,
    ProviderToolFormat,
    ToolCallParser,
)
from handoffkit.quality import (
    HandoffQualityEvaluator,
    HandoffQualityMetric,
    HandoffQualityReport,
)
from handoffkit.recipes import (
    Recipe,
    RecipeRunner,
    RecipeRunResult,
    RecipeStep,
    WorkflowTemplate,
)
from handoffkit.replay import ReplayRunner, ReplaySummary
from handoffkit.reports import (
    load_report_json,
    render_report_html,
    write_report_files,
    write_report_html,
)
from handoffkit.runner import Team, TeamRunResult
from handoffkit.recipes.showcases import ShowcaseResult, build_showcase, run_showcase, showcase_names
from handoffkit.structured import (
    JsonOutputParser,
    OutputRepairer,
    OutputValidationError,
    StructuredOutputResult,
    StructuredOutputSchema,
)
from handoffkit.templates import ProjectTemplate, ScaffoldResult, TemplateFile, TemplateScaffolder
from handoffkit.tool import Tool, tool
from handoffkit.tool_execution import (
    ToolCall,
    ToolExecutionReport,
    ToolRegistry,
    ToolResult,
)
from handoffkit.tool_factory import DeclarativeTool, HttpJsonTool, ToolFactory, ToolSpec
from handoffkit.tracing import FileTraceStore, RunTrace, TraceEvent, TraceStep
from handoffkit.validation import (
    HandoffStateValidator,
    StructuredOutputValidator,
    ToolSchemaValidator,
    ValidationIssue,
    ValidationReport,
)
from handoffkit.cli import (
    create_extension,
    delete_key,
    init_project,
    init_project_interactive,
    list_keys,
    list_providers,
    load_dynamic_extensions,
    render_report,
    run_demo,
    run_named_showcase,
    run_recipe_demo,
    set_key,
    write_project_report,
)

from handoffkit._version import __version__

__all__ = [
    "Agent",
    "ContextDocument",
    "ContextPack",
    "ContextRetriever",
    "ContextRunResult",
    "ContractParityReport",
    "DeclarativeTool",
    "DubbingSegment",
    "Extension",
    "ExtensionRegistry",
    "EvaluationCheck",
    "EvaluationResult",
    "FileTraceStore",
    "HandoffValidationError",
    "HandoffProtocol",
    "HandoffQualityEvaluator",
    "HandoffQualityMetric",
    "HandoffQualityReport",
    "HandoffState",
    "HandoffStateValidator",
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
    "ToolSpec",
    "TraceEvent",
    "TraceStep",
    "TranscriptSegment",
    "ToolSchemaValidator",
    "ValidationIssue",
    "ValidationReport",
    "WorkflowEvaluationReport",
    "WorkflowEvaluator",
    "WorkflowTemplate",
    "__version__",
    "build_dubbing_plan",
    "build_contract_parity_report",
    "create_extension",
    "delete_key",
    "init_project",
    "init_project_interactive",
    "list_keys",
    "list_providers",
    "load_dynamic_extensions",
    "load_report_json",
    "build_showcase",
    "extract_audio",
    "ffmpeg_available",
    "format_srt_timestamp",
    "mux_audio",
    "read_transcript_json",
    "render_report",
    "run_demo",
    "run_named_showcase",
    "run_recipe_demo",
    "set_key",
    "tool",
    "run_showcase",
    "render_report_html",
    "showcase_names",
    "write_project_report",
    "write_report_html",
    "write_report_files",
    "write_srt",
    "write_transcript_json",
]
