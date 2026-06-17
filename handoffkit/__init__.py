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
from handoffkit.handoff import HandoffState
from handoffkit.memory import JsonMemoryStore, MemoryItem, MemoryReport, MemoryStore
from handoffkit.protocol import HandoffProtocol
from handoffkit.runner import Team, TeamRunResult
from handoffkit.tool import Tool, tool
from handoffkit.tool_execution import (
    ToolCall,
    ToolExecutionReport,
    ToolRegistry,
    ToolResult,
)

__version__ = "0.4.0"

__all__ = [
    "Agent",
    "ContextDocument",
    "ContextPack",
    "ContextRetriever",
    "ContextRunResult",
    "HandoffValidationError",
    "HandoffProtocol",
    "HandoffState",
    "JsonMemoryStore",
    "MemoryItem",
    "MemoryReport",
    "MemoryStore",
    "ProjectIndexer",
    "Team",
    "TeamRunResult",
    "Tool",
    "ToolCall",
    "ToolExecutionReport",
    "ToolRegistry",
    "ToolResult",
    "__version__",
    "tool",
]
