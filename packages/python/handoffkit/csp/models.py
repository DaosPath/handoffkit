"""Wire-compatible HK-CSP contracts."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field, replace
from datetime import datetime, timezone
from enum import Enum
from typing import Any

from handoffkit.csp.errors import ProtocolVersionError

PROTOCOL_VERSION = "1.0"
DEFAULT_CHANNEL_CAPACITY = 64
DEFAULT_MAX_MESSAGE_BYTES = 8 * 1024 * 1024


def utc_now() -> str:
    """Return an RFC 3339 UTC timestamp."""
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def validate_timestamp(value: str, *, field_name: str) -> None:
    """Validate one RFC 3339-compatible timestamp."""
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"{field_name} must be a valid timestamp") from exc
    if parsed.tzinfo is None:
        raise ValueError(f"{field_name} must include a timezone")


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
        if self.base_delay_ms < 0 or self.max_delay_ms < 0:
            raise ValueError("retry delays must not be negative")

    def to_dict(self) -> dict[str, int]:
        return asdict(self)

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> RetryPolicy:
        return cls(
            max_attempts=int(value.get("max_attempts", 3)),
            base_delay_ms=int(value.get("base_delay_ms", 100)),
            max_delay_ms=int(value.get("max_delay_ms", 2000)),
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

    def __post_init__(self) -> None:
        if not self.session_id:
            raise ValueError("session_id must not be empty")
        if self.channel_capacity < 1 or self.max_message_bytes < 1024:
            raise ValueError("channel and message limits must be positive")
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
        if not self.name:
            raise ValueError("channel name must not be empty")
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
            if not getattr(self, name):
                raise ValueError(f"{name} must not be empty")
        if self.sequence < 0 or self.attempt < 1:
            raise ValueError("sequence must be non-negative and attempt must be positive")
        validate_timestamp(self.created_at, field_name="created_at")
        if self.deadline:
            validate_timestamp(self.deadline, field_name="deadline")

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

    def to_dict(self) -> dict[str, Any]:
        value = asdict(self)
        value["artifacts"] = [artifact.to_dict() for artifact in self.artifacts]
        return value
