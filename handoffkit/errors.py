"""Package-specific exceptions."""


class StateTransferError(Exception):
    """Base exception for handoffkit."""


class AgentError(StateTransferError):
    """Raised when an agent cannot complete an operation."""


class ProtocolError(StateTransferError):
    """Raised when a handoff protocol is invalid or cannot run."""


class HandoffValidationError(StateTransferError):
    """Raised when a handoff state violates the expected contract."""


class ToolExecutionError(StateTransferError):
    """Raised when a tool fails during execution."""


class DangerousCommandError(StateTransferError):
    """Raised when a shell command is blocked by the safety policy."""


class ProviderConfigurationError(StateTransferError):
    """Raised when a provider is missing required configuration."""


class ProviderExecutionError(StateTransferError):
    """Raised when a provider request fails."""
