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
    ToolCallParser,
)
from handoffkit.recipes import (
    Recipe,
    RecipeRunner,
    RecipeRunResult,
    RecipeStep,
    WorkflowTemplate,
)
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

__version__ = "0.6.0"

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
    "HandoffState",
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
    "Recipe",
    "RecipeRunResult",
    "RecipeRunner",
    "RecipeStep",
    "StructuredOutputResult",
    "StructuredOutputSchema",
    "Team",
    "TeamRunResult",
    "Tool",
    "ToolCall",
    "ToolCallParser",
    "ToolExecutionReport",
    "ToolRegistry",
    "ToolResult",
    "WorkflowTemplate",
    "__version__",
    "tool",
]
