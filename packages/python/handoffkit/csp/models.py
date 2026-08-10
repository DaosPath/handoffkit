"""Wire-compatible HK-CSP contracts."""

from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass, field, replace
from datetime import datetime, timezone
from enum import Enum
from typing import Any

from handoffkit.csp.errors import ProtocolVersionError

PROTOCOL_VERSION = "1.0"
DEFAULT_CHANNEL_CAPACITY = 64
DEFAULT_MAX_MESSAGE_BYTES = 8 * 1024 * 1024
DEFAULT_MAX_NESTING_DEPTH = 64
MIN_MESSAGE_BYTES = 1024
MAX_ERROR_MESSAGE_BYTES = 2048
MAX_RETRY_ATTEMPTS = 100

_RFC3339_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$")


def utc_now() -> str:
    """Return an RFC 3339 UTC timestamp."""
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def validate_timestamp(value: str, *, field_name: str) -> datetime:
    """Validate one RFC 3339-compatible timestamp."""
    if not isinstance(value, str) or not _RFC3339_RE.fullmatch(value):
        raise ValueError(f"{field_name} must be an RFC 3339 timestamp")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"{field_name} must be an RFC 3339 timestamp") from exc
    if parsed.tzinfo is None:
        raise ValueError(f"{field_name} must include a timezone")
    return parsed


def json_depth(value: Any) -> int:
    """Return maximum nesting depth using the HK-CSP counting rule."""
    if isinstance(value, dict):
        return 1 + max((json_depth(item) for item in value.values()), default=0)
    if isinstance(value, (list, tuple)):
        return 1 + max((json_depth(item) for item in value), default=0)
    return 1


def sanitize_error_message(message: str) -> str:
    """Redact common credentials and bound wire-safe error text."""
    sanitized = str(message).replace("\r", " ").replace("\n", " ").replace("\x00", "")
    for prefix in ("Bearer ", "sk-", "gsk_", "pypi-"):
        sanitized = re.sub(
            re.escape(prefix) + r"[^\s,;\)\]\}]+",
            prefix + "[REDACTED]",
            sanitized,
        )
    return sanitized.encode("utf-8")[:MAX_ERROR_MESSAGE_BYTES].decode("utf-8", "ignore")


def validation_error_code(error: BaseException | str) -> str:
    """Map validation text to a stable cross-runtime differential code."""
    message = str(error).lower()
    mappings = (
        ("protocol version", "unsupported_version"),
        ("rfc 3339", "invalid_timestamp"),
        ("valid timestamp", "invalid_timestamp"),
        ("timezone", "invalid_timestamp"),
        ("deadline must not", "invalid_deadline"),
        ("must not be empty", "empty_field"),
        ("is required", "empty_field"),
        ("at least", "below_minimum"),
        ("positive", "below_minimum"),
        ("must not exceed", "above_maximum"),
        ("nesting depth", "nesting_too_deep"),
        ("message exceeds", "message_too_large"),
        ("invalid_profile", "invalid_profile"),
        ("sha256", "invalid_sha256"),
        ("between 0 and 1", "invalid_progress"),
        ("step must not exceed", "invalid_progress"),
    )
    return next((code for needle, code in mappings if needle in message), "invalid_contract")


def _require_nonempty(name: str, value: str | None) -> None:
    if value is None or not str(value).strip():
        raise ValueError(f"{name} must not be empty")


def _validate_optional_nonempty(name: str, value: str | None) -> None:
    if value is not None and not str(value).strip():
        raise ValueError(f"{name} must not be empty when set")


class RuntimeMode(str, Enum):
    """Execution mode used by teams and recipes."""

    CLASSIC = "classic"
    SESSION = "session"
    DISTRIBUTED = "distributed"


class OverflowPolicy(str, Enum):
    """Behavior when a bounded channel is full."""

    BLOCK = "block"
    REJECT = "reject"


@dataclass(frozen=True)
class RetryPolicy:
    """Bounded acknowledgement retry policy."""

    max_attempts: int = 3
    base_delay_ms: int = 100
    max_delay_ms: int = 2000

    def __post_init__(self) -> None:
        if self.max_attempts < 1:
            raise ValueError("max_attempts must be at least 1")
        if self.max_attempts > MAX_RETRY_ATTEMPTS:
            raise ValueError(f"max_attempts must not exceed {MAX_RETRY_ATTEMPTS}")
        if self.base_delay_ms < 0 or self.max_delay_ms < 0:
            raise ValueError("retry delays must not be negative")
        if self.base_delay_ms > self.max_delay_ms:
            raise ValueError("base_delay_ms must not exceed max_delay_ms")

    def to_dict(self) -> dict[str, int]:
        return asdict(self)

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> RetryPolicy:
        return cls(
            max_attempts=int(value.get("max_attempts", 3)),
            base_delay_ms=int(value.get("base_delay_ms", 100)),
            max_delay_ms=int(value.get("max_delay_ms", 2000)),
        )


class EdgeProfile(str, Enum):
    """Preset operational profiles for edge and server environments."""

    EDGE_SMALL = "edge-small"
    EDGE_STANDARD = "edge-standard"
    SERVER = "server"


@dataclass(frozen=True)
class EdgeRuntimeProfile:
    """Operational limits applied to real edge sessions and transports."""

    name: EdgeProfile
    channel_capacity: int
    max_frame_bytes: int
    pending_ack_limit: int
    dedup_capacity: int
    durable_replay_capacity: int
    connection_limit: int
    heartbeat_seconds: int
    reconnect: RetryPolicy
    connect_timeout_ms: int
    io_timeout_ms: int
    ack_timeout_ms: int
    artifact_limit_bytes: int
    memory_budget_bytes: int
    durable_state_limit_bytes: int
    logging_level: str
    logging_include_payloads: bool
    logging_redact_paths: bool
    security_profile: str

    def __post_init__(self) -> None:
        if isinstance(self.name, str):
            object.__setattr__(self, "name", EdgeProfile(self.name))
        positive = {
            "channel_capacity": self.channel_capacity,
            "max_frame_bytes": self.max_frame_bytes,
            "pending_ack_limit": self.pending_ack_limit,
            "dedup_capacity": self.dedup_capacity,
            "durable_replay_capacity": self.durable_replay_capacity,
            "connection_limit": self.connection_limit,
            "heartbeat_seconds": self.heartbeat_seconds,
            "connect_timeout_ms": self.connect_timeout_ms,
            "io_timeout_ms": self.io_timeout_ms,
            "ack_timeout_ms": self.ack_timeout_ms,
            "artifact_limit_bytes": self.artifact_limit_bytes,
            "memory_budget_bytes": self.memory_budget_bytes,
            "durable_state_limit_bytes": self.durable_state_limit_bytes,
        }
        if any(value < 1 for value in positive.values()):
            raise ValueError("edge runtime limits must be positive")
        if not MIN_MESSAGE_BYTES <= self.max_frame_bytes <= DEFAULT_MAX_MESSAGE_BYTES:
            raise ValueError(
                f"max_frame_bytes must be between {MIN_MESSAGE_BYTES} "
                f"and {DEFAULT_MAX_MESSAGE_BYTES}"
            )
        if self.logging_level not in {"warning", "info"}:
            raise ValueError("edge logging_level must be warning or info")
        if self.logging_include_payloads:
            raise ValueError("edge profiles must not log message payloads")
        if not self.logging_redact_paths:
            raise ValueError("edge profiles must redact paths")
        if self.security_profile != "standard":
            raise ValueError("edge profiles require the standard security profile")

    @classmethod
    def for_profile(cls, profile: EdgeProfile | str) -> EdgeRuntimeProfile:
        """Return the exact built-in profile shared by all runtimes."""
        name = EdgeProfile(profile) if isinstance(profile, str) else profile
        values: dict[EdgeProfile, dict[str, Any]] = {
            EdgeProfile.EDGE_SMALL: {
                "channel_capacity": 16,
                "max_frame_bytes": 1_048_576,
                "pending_ack_limit": 32,
                "dedup_capacity": 512,
                "durable_replay_capacity": 2_048,
                "connection_limit": 8,
                "heartbeat_seconds": 30,
                "reconnect": RetryPolicy(5, 250, 5_000),
                "connect_timeout_ms": 5_000,
                "io_timeout_ms": 15_000,
                "ack_timeout_ms": 10_000,
                "artifact_limit_bytes": 16_777_216,
                "memory_budget_bytes": 268_435_456,
                "durable_state_limit_bytes": 8_388_608,
                "logging_level": "warning",
            },
            EdgeProfile.EDGE_STANDARD: {
                "channel_capacity": 64,
                "max_frame_bytes": 4_194_304,
                "pending_ack_limit": 128,
                "dedup_capacity": 2_048,
                "durable_replay_capacity": 10_000,
                "connection_limit": 32,
                "heartbeat_seconds": 15,
                "reconnect": RetryPolicy(5, 100, 3_000),
                "connect_timeout_ms": 5_000,
                "io_timeout_ms": 30_000,
                "ack_timeout_ms": 30_000,
                "artifact_limit_bytes": 67_108_864,
                "memory_budget_bytes": 1_073_741_824,
                "durable_state_limit_bytes": 33_554_432,
                "logging_level": "info",
            },
            EdgeProfile.SERVER: {
                "channel_capacity": 256,
                "max_frame_bytes": 8_388_608,
                "pending_ack_limit": 1_024,
                "dedup_capacity": 16_384,
                "durable_replay_capacity": 100_000,
                "connection_limit": 256,
                "heartbeat_seconds": 10,
                "reconnect": RetryPolicy(8, 50, 2_000),
                "connect_timeout_ms": 5_000,
                "io_timeout_ms": 60_000,
                "ack_timeout_ms": 60_000,
                "artifact_limit_bytes": 536_870_912,
                "memory_budget_bytes": 4_294_967_296,
                "durable_state_limit_bytes": 268_435_456,
                "logging_level": "info",
            },
        }
        return cls(
            name=name,
            logging_include_payloads=False,
            logging_redact_paths=True,
            security_profile="standard",
            **values[name],
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name.value,
            "channel_capacity": self.channel_capacity,
            "max_frame_bytes": self.max_frame_bytes,
            "pending_ack_limit": self.pending_ack_limit,
            "dedup_capacity": self.dedup_capacity,
            "durable_replay_capacity": self.durable_replay_capacity,
            "connection_limit": self.connection_limit,
            "heartbeat_seconds": self.heartbeat_seconds,
            "reconnect": self.reconnect.to_dict(),
            "timeout": {
                "connect_ms": self.connect_timeout_ms,
                "io_ms": self.io_timeout_ms,
                "ack_ms": self.ack_timeout_ms,
            },
            "artifact_limit_bytes": self.artifact_limit_bytes,
            "memory_budget_bytes": self.memory_budget_bytes,
            "durable_state_limit_bytes": self.durable_state_limit_bytes,
            "logging": {
                "level": self.logging_level,
                "include_payloads": self.logging_include_payloads,
                "redact_paths": self.logging_redact_paths,
            },
            "security_profile": self.security_profile,
        }

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> EdgeRuntimeProfile:
        timeout = dict(value.get("timeout", {}))
        logging = dict(value.get("logging", {}))
        return cls(
            name=EdgeProfile(value["name"]),
            channel_capacity=int(value["channel_capacity"]),
            max_frame_bytes=int(value["max_frame_bytes"]),
            pending_ack_limit=int(value["pending_ack_limit"]),
            dedup_capacity=int(value["dedup_capacity"]),
            durable_replay_capacity=int(value["durable_replay_capacity"]),
            connection_limit=int(value["connection_limit"]),
            heartbeat_seconds=int(value["heartbeat_seconds"]),
            reconnect=RetryPolicy.from_dict(dict(value["reconnect"])),
            connect_timeout_ms=int(timeout["connect_ms"]),
            io_timeout_ms=int(timeout["io_ms"]),
            ack_timeout_ms=int(timeout["ack_ms"]),
            artifact_limit_bytes=int(value["artifact_limit_bytes"]),
            memory_budget_bytes=int(value["memory_budget_bytes"]),
            durable_state_limit_bytes=int(value["durable_state_limit_bytes"]),
            logging_level=str(logging["level"]),
            logging_include_payloads=bool(logging["include_payloads"]),
            logging_redact_paths=bool(logging["redact_paths"]),
            security_profile=str(value["security_profile"]),
        )


@dataclass(frozen=True)
class SessionConfig:
    """Configuration shared by one CSP session."""

    session_id: str
    runtime_mode: RuntimeMode = RuntimeMode.SESSION
    channel_capacity: int = DEFAULT_CHANNEL_CAPACITY
    max_message_bytes: int = DEFAULT_MAX_MESSAGE_BYTES
    ack_timeout_ms: int = 30_000
    dedup_capacity: int = 4096
    retry_policy: RetryPolicy = field(default_factory=RetryPolicy)
    deadline: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def for_profile(
        cls,
        session_id: str,
        profile: EdgeProfile | str = EdgeProfile.EDGE_STANDARD,
        **kwargs: Any,
    ) -> SessionConfig:
        edge = EdgeRuntimeProfile.for_profile(profile)
        metadata = dict(kwargs.pop("metadata", {}))
        configured_name = metadata.get("edge_profile")
        if configured_name not in (None, edge.name.value):
            raise ValueError("metadata edge_profile does not match the applied profile")
        metadata["edge_profile"] = edge.name.value
        defaults = {
            "channel_capacity": edge.channel_capacity,
            "max_message_bytes": edge.max_frame_bytes,
            "dedup_capacity": edge.dedup_capacity,
            "ack_timeout_ms": edge.ack_timeout_ms,
            "retry_policy": edge.reconnect,
            "metadata": metadata,
        }
        defaults.update(kwargs)
        return cls(session_id=session_id, **defaults)

    def __post_init__(self) -> None:
        _require_nonempty("session_id", self.session_id)
        if self.channel_capacity < 1:
            raise ValueError("channel_capacity must be at least 1")
        if self.max_message_bytes < MIN_MESSAGE_BYTES:
            raise ValueError(f"max_message_bytes must be at least {MIN_MESSAGE_BYTES}")
        if self.ack_timeout_ms < 1 or self.dedup_capacity < 1:
            raise ValueError("ack_timeout_ms and dedup_capacity must be positive")
        if self.deadline:
            validate_timestamp(self.deadline, field_name="deadline")

    def to_dict(self) -> dict[str, Any]:
        return {
            "session_id": self.session_id,
            "runtime_mode": self.runtime_mode.value,
            "channel_capacity": self.channel_capacity,
            "max_message_bytes": self.max_message_bytes,
            "ack_timeout_ms": self.ack_timeout_ms,
            "dedup_capacity": self.dedup_capacity,
            "retry_policy": self.retry_policy.to_dict(),
            "deadline": self.deadline,
            "metadata": dict(self.metadata),
        }

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> SessionConfig:
        return cls(
            session_id=str(value["session_id"]),
            runtime_mode=RuntimeMode(value.get("runtime_mode", "session")),
            channel_capacity=int(value.get("channel_capacity", DEFAULT_CHANNEL_CAPACITY)),
            max_message_bytes=int(value.get("max_message_bytes", DEFAULT_MAX_MESSAGE_BYTES)),
            ack_timeout_ms=int(value.get("ack_timeout_ms", 30_000)),
            dedup_capacity=int(value.get("dedup_capacity", 4096)),
            retry_policy=RetryPolicy.from_dict(value.get("retry_policy", {})),
            deadline=value.get("deadline"),
            metadata=dict(value.get("metadata", {})),
        )


@dataclass(frozen=True)
class ChannelConfig:
    """Configuration for a bounded FIFO channel."""

    name: str
    capacity: int = DEFAULT_CHANNEL_CAPACITY
    overflow_policy: OverflowPolicy = OverflowPolicy.BLOCK
    requires_ack: bool = False
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        _require_nonempty("channel.name", self.name)
        if self.capacity < 1:
            raise ValueError("channel capacity must be at least 1")

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "capacity": self.capacity,
            "overflow_policy": self.overflow_policy.value,
            "requires_ack": self.requires_ack,
            "metadata": dict(self.metadata),
        }

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> ChannelConfig:
        return cls(
            name=str(value["name"]),
            capacity=int(value.get("capacity", DEFAULT_CHANNEL_CAPACITY)),
            overflow_policy=OverflowPolicy(value.get("overflow_policy", "block")),
            requires_ack=bool(value.get("requires_ack", False)),
            metadata=dict(value.get("metadata", {})),
        )


@dataclass(frozen=True)
class MessageEnvelope:
    """Canonical message exchanged by HK-CSP processes."""

    message_id: str
    session_id: str
    channel: str
    kind: str
    source: str
    sequence: int
    payload_type: str
    payload: Any
    protocol_version: str = PROTOCOL_VERSION
    target: str | None = None
    created_at: str = field(default_factory=utc_now)
    deadline: str | None = None
    correlation_id: str | None = None
    causation_id: str | None = None
    idempotency_key: str | None = None
    attempt: int = 1
    requires_ack: bool = False
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        major = self.protocol_version.split(".", maxsplit=1)[0]
        if major != PROTOCOL_VERSION.split(".", maxsplit=1)[0]:
            raise ProtocolVersionError(
                f"Unsupported HK-CSP protocol version {self.protocol_version!r}."
            )
        for name in ("message_id", "session_id", "channel", "kind", "source", "payload_type"):
            _require_nonempty(name, getattr(self, name))
        for name in ("target", "correlation_id", "causation_id", "idempotency_key"):
            _validate_optional_nonempty(name, getattr(self, name))
        if self.sequence < 0 or self.attempt < 1:
            raise ValueError("sequence must be non-negative and attempt must be positive")
        validate_timestamp(self.created_at, field_name="created_at")
        if self.deadline:
            validate_timestamp(self.deadline, field_name="deadline")
        self.validate_with_limits()

    def validate_with_limits(
        self,
        *,
        max_message_bytes: int = DEFAULT_MAX_MESSAGE_BYTES,
        max_nesting_depth: int = DEFAULT_MAX_NESTING_DEPTH,
    ) -> MessageEnvelope:
        if self.encoded_size() > max_message_bytes:
            raise ValueError(f"message exceeds limit of {max_message_bytes} bytes")
        metadata_depth = 1 + max((json_depth(item) for item in self.metadata.values()), default=0)
        if max(json_depth(self.payload), metadata_depth) > max_nesting_depth:
            raise ValueError(f"message nesting depth exceeds limit of {max_nesting_depth}")
        return self

    def to_dict(self) -> dict[str, Any]:
        return {
            "protocol_version": self.protocol_version,
            "message_id": self.message_id,
            "session_id": self.session_id,
            "channel": self.channel,
            "kind": self.kind,
            "source": self.source,
            "target": self.target,
            "sequence": self.sequence,
            "created_at": self.created_at,
            "deadline": self.deadline,
            "correlation_id": self.correlation_id,
            "causation_id": self.causation_id,
            "idempotency_key": self.idempotency_key,
            "attempt": self.attempt,
            "requires_ack": self.requires_ack,
            "payload_type": self.payload_type,
            "payload": self.payload,
            "metadata": dict(self.metadata),
        }

    def to_json(self, *, indent: int | None = None) -> str:
        return json.dumps(
            self.to_dict(),
            ensure_ascii=False,
            separators=None if indent else (",", ":"),
            indent=indent,
        )

    def encoded_size(self) -> int:
        return len(self.to_json().encode("utf-8"))

    def next_attempt(self) -> MessageEnvelope:
        return replace(self, attempt=self.attempt + 1)

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> MessageEnvelope:
        return cls(
            protocol_version=str(value.get("protocol_version", PROTOCOL_VERSION)),
            message_id=str(value["message_id"]),
            session_id=str(value["session_id"]),
            channel=str(value["channel"]),
            kind=str(value["kind"]),
            source=str(value["source"]),
            target=value.get("target"),
            sequence=int(value["sequence"]),
            created_at=str(value.get("created_at", utc_now())),
            deadline=value.get("deadline"),
            correlation_id=value.get("correlation_id"),
            causation_id=value.get("causation_id"),
            idempotency_key=value.get("idempotency_key"),
            attempt=int(value.get("attempt", 1)),
            requires_ack=bool(value.get("requires_ack", False)),
            payload_type=str(value["payload_type"]),
            payload=value.get("payload"),
            metadata=dict(value.get("metadata", {})),
        )

    @classmethod
    def from_json(cls, value: str) -> MessageEnvelope:
        data = json.loads(value)
        if not isinstance(data, dict):
            raise ValueError("message envelope JSON must be an object")
        return cls.from_dict(data)


@dataclass(frozen=True)
class DeliveryAck:
    message_id: str
    processed_at: str = field(default_factory=utc_now)
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        _require_nonempty("message_id", self.message_id)
        validate_timestamp(self.processed_at, field_name="processed_at")

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class DeliveryNack:
    message_id: str
    code: str
    message: str
    retryable: bool = False
    processed_at: str = field(default_factory=utc_now)
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        _require_nonempty("message_id", self.message_id)
        _require_nonempty("code", self.code)
        validate_timestamp(self.processed_at, field_name="processed_at")

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class ProcessError:
    code: str
    message: str
    process_id: str
    retryable: bool = False
    details: dict[str, Any] = field(default_factory=dict)
    timestamp: str = field(default_factory=utc_now)

    def __post_init__(self) -> None:
        _require_nonempty("code", self.code)
        _require_nonempty("process_id", self.process_id)
        validate_timestamp(self.timestamp, field_name="timestamp")

    def sanitized(self) -> ProcessError:
        return replace(self, message=sanitize_error_message(self.message))

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class ArtifactRef:
    artifact_id: str
    uri: str
    sha256: str
    size_bytes: int
    media_type: str
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        _require_nonempty("artifact_id", self.artifact_id)
        _require_nonempty("uri", self.uri)
        _require_nonempty("media_type", self.media_type)
        if not re.fullmatch(r"[0-9a-fA-F]{64}", self.sha256):
            raise ValueError("sha256 must contain exactly 64 hexadecimal characters")
        if self.size_bytes < 0:
            raise ValueError("size_bytes must be at least 0")

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> ArtifactRef:
        return cls(**value)


@dataclass(frozen=True)
class WorkerCapabilities:
    worker_id: str
    runtime: str
    os: str
    architecture: str
    cpu_cores: int
    memory_bytes: int
    cuda: bool = False
    cuda_devices: list[str] = field(default_factory=list)
    profiles: list[str] = field(default_factory=list)
    operations: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        for name in ("worker_id", "runtime", "os", "architecture"):
            _require_nonempty(name, getattr(self, name))
        if self.cpu_cores < 1:
            raise ValueError("cpu_cores must be at least 1")
        if self.memory_bytes < 0:
            raise ValueError("memory_bytes must be at least 0")

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class TrainingJob:
    job_id: str
    dataset: ArtifactRef
    output: str
    config: dict[str, Any]
    requested_capabilities: list[str]
    idempotency_key: str
    deadline: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        for name in ("job_id", "output", "idempotency_key"):
            _require_nonempty(name, getattr(self, name))
        if self.deadline:
            validate_timestamp(self.deadline, field_name="deadline")

    def to_dict(self) -> dict[str, Any]:
        value = asdict(self)
        value["dataset"] = self.dataset.to_dict()
        return value


@dataclass(frozen=True)
class EvaluationJob:
    job_id: str
    model: ArtifactRef
    dataset: ArtifactRef
    output: str
    config: dict[str, Any]
    requested_capabilities: list[str]
    idempotency_key: str
    deadline: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        for name in ("job_id", "output", "idempotency_key"):
            _require_nonempty(name, getattr(self, name))
        if self.deadline:
            validate_timestamp(self.deadline, field_name="deadline")

    def to_dict(self) -> dict[str, Any]:
        value = asdict(self)
        value["model"] = self.model.to_dict()
        value["dataset"] = self.dataset.to_dict()
        return value


@dataclass(frozen=True)
class JobProgress:
    job_id: str
    phase: str
    status: str
    step: int
    total_steps: int
    progress: float
    metrics: dict[str, Any]
    message: str
    timestamp: str = field(default_factory=utc_now)
    loss: float | None = None
    artifacts: list[ArtifactRef] = field(default_factory=list)

    def __post_init__(self) -> None:
        for name in ("job_id", "phase", "status"):
            _require_nonempty(name, getattr(self, name))
        validate_timestamp(self.timestamp, field_name="timestamp")
        if not 0.0 <= self.progress <= 1.0:
            raise ValueError("progress must be between 0 and 1")
        if self.step < 0 or self.total_steps < 0 or self.step > self.total_steps:
            raise ValueError("step must not exceed total_steps")

    def to_dict(self) -> dict[str, Any]:
        value = asdict(self)
        value["artifacts"] = [artifact.to_dict() for artifact in self.artifacts]
        return value


@dataclass(frozen=True)
class WorkerHeartbeat:
    """Liveness and load report emitted by a distributed worker."""

    worker_id: str
    sequence: int
    active_jobs: int
    load: float
    timestamp: str = field(default_factory=utc_now)
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        _require_nonempty("worker_id", self.worker_id)
        if self.sequence < 0:
            raise ValueError("sequence must be at least 0")
        if self.active_jobs < 0:
            raise ValueError("active_jobs must be at least 0")
        if not 0.0 <= self.load <= 1.0:
            raise ValueError("load must be between 0 and 1")
        validate_timestamp(self.timestamp, field_name="timestamp")

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> WorkerHeartbeat:
        return cls(**value)


@dataclass(frozen=True)
class DistributedJob:
    """Portable unit of work accepted by the distributed scheduler."""

    job_id: str
    operation: str
    payload: Any
    requested_capabilities: list[str]
    idempotency_key: str
    deadline: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        for name in ("job_id", "operation", "idempotency_key"):
            _require_nonempty(name, getattr(self, name))
        for capability in self.requested_capabilities:
            _require_nonempty("requested_capabilities item", capability)
        if self.deadline:
            validate_timestamp(self.deadline, field_name="deadline")

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> DistributedJob:
        return cls(**value)


@dataclass(frozen=True)
class JobAssignment:
    """Leased assignment of one distributed job to one worker."""

    assignment_id: str
    job_id: str
    worker_id: str
    attempt: int
    assigned_at: str
    lease_deadline: str
    payload: Any
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        for name in ("assignment_id", "job_id", "worker_id"):
            _require_nonempty(name, getattr(self, name))
        if self.attempt < 1:
            raise ValueError("attempt must be at least 1")
        assigned_at = validate_timestamp(self.assigned_at, field_name="assigned_at")
        lease_deadline = validate_timestamp(
            self.lease_deadline,
            field_name="lease_deadline",
        )
        if lease_deadline < assigned_at:
            raise ValueError("lease_deadline must not be earlier than assigned_at")

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> JobAssignment:
        return cls(**value)
