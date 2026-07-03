"""Public API for HandoffKit."""

from handoffkit.agent import Agent
from handoffkit.context import (
    ContextDocument,
    ContextPack,
    ContextRetriever,
    ContextRunResult,
    ProjectIndexer,
)
from handoffkit.errors import HandoffValidationError
from handoffkit.extensions import Extension, ExtensionRegistry
from handoffkit.handoff import HandoffState
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
from handoffkit.reports import load_report_json, write_report_files
from handoffkit.runner import Team, TeamRunResult
from handoffkit.structured import (
    JsonOutputParser,
    OutputRepairer,
    OutputValidationError,
    StructuredOutputResult,
    StructuredOutputSchema,
)
from handoffkit.tool import Tool, tool
from handoffkit.tool_execution import (
    ToolCall,
    ToolExecutionReport,
    ToolRegistry,
    ToolResult,
)
from handoffkit.tracing import FileTraceStore, RunTrace, TraceEvent, TraceStep
from handoffkit.validation import (
    HandoffStateValidator,
    StructuredOutputValidator,
    ToolSchemaValidator,
    ValidationIssue,
    ValidationReport,
)

__version__ = "0.9.0"

__all__ = [
    "Agent",
    "ContextDocument",
    "ContextPack",
    "ContextRetriever",
    "ContextRunResult",
    "Extension",
    "ExtensionRegistry",
    "HandoffValidationError",
    "HandoffProtocol",
    "HandoffQualityEvaluator",
    "HandoffQualityMetric",
    "HandoffQualityReport",
    "HandoffState",
    "HandoffStateValidator",
    "JsonMemoryStore",
    "JsonOutputParser",
    "MemoryItem",
    "MemoryReport",
    "MemoryStore",
    "OutputRepairer",
    "OutputValidationError",
    "ProjectIndexer",
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
    "StructuredOutputResult",
    "StructuredOutputSchema",
    "StructuredOutputValidator",
    "Team",
    "TeamRunResult",
    "Tool",
    "ToolCall",
    "ToolCallParser",
    "ToolExecutionReport",
    "ToolRegistry",
    "ToolResult",
    "TraceEvent",
    "TraceStep",
    "ToolSchemaValidator",
    "ValidationIssue",
    "ValidationReport",
    "WorkflowTemplate",
    "__version__",
    "FileTraceStore",
    "load_report_json",
    "tool",
    "write_report_files",
]
