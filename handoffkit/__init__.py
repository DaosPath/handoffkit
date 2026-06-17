"""Public API for HandoffKit."""

from handoffkit.agent import Agent
from handoffkit.errors import HandoffValidationError
from handoffkit.handoff import HandoffState
from handoffkit.protocol import HandoffProtocol
from handoffkit.runner import Team, TeamRunResult
from handoffkit.tool import Tool, tool

__version__ = "0.2.0"

__all__ = [
    "Agent",
    "HandoffValidationError",
    "HandoffProtocol",
    "HandoffState",
    "Team",
    "TeamRunResult",
    "Tool",
    "__version__",
    "tool",
]
