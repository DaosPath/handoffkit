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
from handoffkit.recipes import (
    Recipe,
    RecipeRunner,
    RecipeRunResult,
    RecipeStep,
    WorkflowTemplate,
)
from handoffkit.runner import Team, TeamRunResult
from handoffkit.tool import Tool, tool
from handoffkit.tool_execution import (
    ToolCall,
    ToolExecutionReport,
    ToolRegistry,
    ToolResult,
)

__version__ = "0.5.0"

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
    "MemoryItem",
    "MemoryReport",
    "MemoryStore",
    "ProjectIndexer",
    "Recipe",
    "RecipeRunResult",
    "RecipeRunner",
    "RecipeStep",
    "Team",
    "TeamRunResult",
    "Tool",
    "ToolCall",
    "ToolExecutionReport",
    "ToolRegistry",
    "ToolResult",
    "WorkflowTemplate",
    "__version__",
    "tool",
]
