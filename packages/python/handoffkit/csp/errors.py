"""HK-CSP runtime errors."""


class CspError(RuntimeError):
    """Base error for HK-CSP operations."""


class ChannelClosedError(CspError):
    """Raised when a closed channel is used."""


class BackpressureError(CspError):
    """Raised when a rejecting channel has no remaining capacity."""


class DeadlineExceededError(CspError):
    """Raised when a message or session deadline has elapsed."""


class MessageTooLargeError(CspError):
    """Raised when an encoded envelope exceeds the configured limit."""


class DistributedRuntimeUnavailableError(CspError):
    """Raised when distributed mode is requested before a backend is installed."""


class ProtocolVersionError(CspError):
    """Raised for unsupported HK-CSP protocol major versions."""
