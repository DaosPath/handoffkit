"""Transport interfaces and stdio NDJSON framing for HK-CSP."""

from __future__ import annotations

import asyncio
import inspect
import ssl
import struct
from abc import ABC, abstractmethod
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

from handoffkit.csp.errors import ChannelClosedError, MessageTooLargeError
from handoffkit.csp.models import (
    DEFAULT_MAX_MESSAGE_BYTES,
    MIN_MESSAGE_BYTES,
    MessageEnvelope,
    RetryPolicy,
    sanitize_error_message,
    validate_timestamp,
)
from handoffkit.csp.security import (
    AuthenticationError,
    AuthorizationError,
    CapabilityPolicy,
    CertificateIdentityPolicy,
    PeerIdentity,
    ReplayProtection,
    SecurityConfig,
    SecurityError,
    SecurityProfile,
    authenticate_ssl_peer,
    build_ssl_context,
    validate_declared_peer_identity,
)

_SECURE_TRANSPORT_FACTORY_TOKEN = object()


@dataclass(frozen=True)
class NetworkConfig:
    """Bounded network transport configuration."""

    max_message_bytes: int = DEFAULT_MAX_MESSAGE_BYTES
    connect_timeout_ms: int = 5000
    io_timeout_ms: int = 30000
    retry_policy: RetryPolicy = field(default_factory=RetryPolicy)
    security_config: SecurityConfig = field(default_factory=SecurityConfig)
    identity_policy: CertificateIdentityPolicy | None = None
    capability_policy: CapabilityPolicy | None = None
    replay_protection: ReplayProtection = field(default_factory=ReplayProtection)

    def __post_init__(self) -> None:
        if not MIN_MESSAGE_BYTES <= self.max_message_bytes <= DEFAULT_MAX_MESSAGE_BYTES:
            raise ValueError(
                f"max_message_bytes must be between {MIN_MESSAGE_BYTES} "
                f"and {DEFAULT_MAX_MESSAGE_BYTES}"
            )
        if self.connect_timeout_ms < 1 or self.io_timeout_ms < 1:
            raise ValueError("network timeouts must be at least 1 ms")
        if self.security_config.profile in (
            SecurityProfile.STANDARD,
            SecurityProfile.HYBRID_PQ,
        ):
            if self.identity_policy is None:
                raise ValueError("secure network transport requires identity_policy")
            if self.capability_policy is None:
                raise ValueError("secure network transport requires capability_policy")
            if self.identity_policy.trust_domain != self.security_config.trust_domain:
                raise ValueError("identity_policy trust_domain must match security_config")


class Transport(ABC):
    """Minimal asynchronous envelope transport."""

    @abstractmethod
    async def send(self, envelope: MessageEnvelope) -> None:
        """Send one envelope."""

    @abstractmethod
    async def receive(self) -> MessageEnvelope:
        """Receive one envelope."""

    @abstractmethod
    async def close(self) -> None:
        """Close the transport."""


class StdioTransport(Transport):
    """NDJSON transport over asyncio byte streams."""

    def __init__(
        self,
        reader: asyncio.StreamReader,
        writer: asyncio.StreamWriter,
        *,
        max_message_bytes: int = DEFAULT_MAX_MESSAGE_BYTES,
    ) -> None:
        self.reader = reader
        self.writer = writer
        self.max_message_bytes = max_message_bytes

    async def send(self, envelope: MessageEnvelope) -> None:
        data = envelope.to_json().encode("utf-8") + b"\n"
        if len(data) > self.max_message_bytes:
            raise MessageTooLargeError(f"Encoded envelope exceeds {self.max_message_bytes} bytes.")
        self.writer.write(data)
        await self.writer.drain()

    async def receive(self) -> MessageEnvelope:
        data = await self.reader.readline()
        if not data:
            raise ChannelClosedError("stdio peer closed the protocol stream")
        if len(data) > self.max_message_bytes:
            raise MessageTooLargeError(f"Encoded envelope exceeds {self.max_message_bytes} bytes.")
        return MessageEnvelope.from_json(data.decode("utf-8"))

    async def close(self) -> None:
        self.writer.close()
        await self.writer.wait_closed()


class SubprocessStdioTransport(Transport):
    """Spawn a local child without a shell and exchange NDJSON envelopes."""

    def __init__(
        self,
        process: asyncio.subprocess.Process,
        *,
        max_message_bytes: int = DEFAULT_MAX_MESSAGE_BYTES,
    ) -> None:
        if process.stdout is None or process.stdin is None:
            raise ValueError("subprocess must expose stdin and stdout pipes")
        self.process = process
        self.reader = process.stdout
        self.writer = process.stdin
        self.max_message_bytes = max_message_bytes

    @classmethod
    async def spawn(
        cls,
        argv: Sequence[str],
        *,
        cwd: str | None = None,
        max_message_bytes: int = DEFAULT_MAX_MESSAGE_BYTES,
    ) -> SubprocessStdioTransport:
        if not argv:
            raise ValueError("argv must not be empty")
        process = await asyncio.create_subprocess_exec(
            *argv,
            cwd=cwd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        return cls(process, max_message_bytes=max_message_bytes)

    async def send(self, envelope: MessageEnvelope) -> None:
        data = envelope.to_json().encode("utf-8") + b"\n"
        if len(data) > self.max_message_bytes:
            raise MessageTooLargeError(f"Encoded envelope exceeds {self.max_message_bytes} bytes.")
        self.writer.write(data)
        await self.writer.drain()

    async def receive(self) -> MessageEnvelope:
        data = await self.reader.readline()
        if not data:
            raise ChannelClosedError("child process closed stdout")
        if len(data) > self.max_message_bytes:
            raise MessageTooLargeError(f"Encoded envelope exceeds {self.max_message_bytes} bytes.")
        return MessageEnvelope.from_json(data.decode("utf-8"))

    async def close(self) -> None:
        if not self.writer.is_closing():
            self.writer.close()
            await self.writer.wait_closed()
        if self.process.returncode is None:
            try:
                await asyncio.wait_for(self.process.wait(), timeout=2)
            except TimeoutError:
                self.process.terminate()
                try:
                    await asyncio.wait_for(self.process.wait(), timeout=2)
                except TimeoutError:
                    self.process.kill()
                    await self.process.wait()


class LengthDelimitedTransport(Transport):
    """Four-byte big-endian length framing over asyncio streams."""

    def __init__(
        self,
        reader: asyncio.StreamReader,
        writer: asyncio.StreamWriter,
        *,
        config: NetworkConfig | None = None,
        _secure_factory_token: object | None = None,
    ) -> None:
        self.reader = reader
        self.writer = writer
        self.config = config or NetworkConfig()
        self._send_lock = asyncio.Lock()
        self._receive_lock = asyncio.Lock()
        self._closed = False
        self.authenticated_peer: PeerIdentity | None = None
        profile = self.config.security_config.profile
        if profile in (SecurityProfile.HYBRID_PQ, SecurityProfile.RESEARCH):
            # Keep unavailable/provider-dependent profiles fail-closed even if
            # a caller tries to wrap a socket constructed outside this module.
            build_ssl_context(self.config.security_config, is_server=False)
        if profile in (SecurityProfile.STANDARD, SecurityProfile.HYBRID_PQ):
            if _secure_factory_token is not _SECURE_TRANSPORT_FACTORY_TOKEN:
                raise SecurityError(
                    "Secure transports must be created by TcpTransport.connect() "
                    "or TcpTransport.start_server().",
                    code="secure_transport_factory_required",
                    details={"profile": profile.value},
                )
        if profile in (
            SecurityProfile.STANDARD,
            SecurityProfile.HYBRID_PQ,
        ):
            ssl_object = writer.get_extra_info("ssl_object")
            if ssl_object is None:
                raise AuthenticationError(
                    "Secure network transport requires an authenticated TLS socket.",
                    code="tls_required",
                )
            if self.config.identity_policy is None:
                raise AuthenticationError(
                    "Secure network transport has no certificate identity policy.",
                    code="identity_policy_missing",
                )
            self.authenticated_peer = authenticate_ssl_peer(
                ssl_object,
                self.config.identity_policy,
            )

    async def _io(self, operation: Any) -> Any:
        return await asyncio.wait_for(
            operation,
            timeout=self.config.io_timeout_ms / 1000,
        )

    async def send(self, envelope: MessageEnvelope) -> None:
        if self._closed:
            raise ChannelClosedError("network transport is closed")
        payload = envelope.to_json().encode("utf-8")
        if len(payload) > self.config.max_message_bytes:
            raise MessageTooLargeError(
                f"Encoded envelope exceeds {self.config.max_message_bytes} bytes."
            )
        frame = struct.pack(">I", len(payload)) + payload
        async with self._send_lock:
            self.writer.write(frame)
            await self._io(self.writer.drain())

    async def receive(self) -> MessageEnvelope:
        if self._closed:
            raise ChannelClosedError("network transport is closed")
        async with self._receive_lock:
            try:
                header = await self._io(self.reader.readexactly(4))
            except asyncio.IncompleteReadError as exc:
                raise ChannelClosedError("network peer closed the protocol stream") from exc
            size = struct.unpack(">I", header)[0]
            if size > self.config.max_message_bytes:
                raise MessageTooLargeError(
                    f"Network frame exceeds {self.config.max_message_bytes} bytes."
                )
            try:
                payload = await self._io(self.reader.readexactly(size))
            except asyncio.IncompleteReadError as exc:
                raise ChannelClosedError("network peer sent an incomplete frame") from exc
        envelope = MessageEnvelope.from_json(payload.decode("utf-8"))
        self._validate_secure_envelope(envelope)
        return envelope

    def _validate_secure_envelope(self, envelope: MessageEnvelope) -> None:
        if self.config.security_config.profile not in (
            SecurityProfile.STANDARD,
            SecurityProfile.HYBRID_PQ,
        ):
            return
        peer = self.authenticated_peer
        if peer is None:
            raise AuthenticationError(
                "Secure envelope has no authenticated transport peer.",
                code="authenticated_peer_missing",
            )
        declared_value = envelope.metadata.get("peer_identity")
        if not isinstance(declared_value, dict):
            raise AuthenticationError(
                "Secure envelope requires a declared peer_identity object.",
                code="declared_identity_missing",
            )
        declared = PeerIdentity.from_dict(declared_value)
        validate_declared_peer_identity(peer, declared)
        if envelope.source != peer.peer_id:
            raise AuthenticationError(
                "Envelope source does not match the authenticated peer_id.",
                code="declared_identity_mismatch",
                details={"fields": ["peer_id"]},
            )

        nonce = envelope.metadata.get("security_nonce")
        if not isinstance(nonce, str) or not nonce or len(nonce) > 256:
            raise AuthenticationError(
                "Secure envelope requires a bounded non-empty security_nonce.",
                code="security_nonce_missing",
            )
        created_at = validate_timestamp(envelope.created_at, field_name="created_at").timestamp()
        replay_scope = f"{peer.credential_fingerprint}|{envelope.session_id}"
        self.config.replay_protection.check_and_record(
            replay_scope,
            envelope.sequence,
            nonce=nonce,
            created_at_ts=created_at,
        )

        operation = envelope.metadata.get("operation")
        if not isinstance(operation, str) or not operation:
            raise AuthorizationError(
                "Secure envelope requires an explicit operation for authorization.",
                code="operation_missing",
            )
        policy = self.config.capability_policy
        if policy is None or not policy.is_operation_authorized(operation, peer):
            raise AuthorizationError(
                f"Peer '{peer.peer_id}' is not authorized for operation '{operation}'.",
                details={"peer_id": peer.peer_id, "operation": operation},
            )

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        self.writer.close()
        try:
            await self.writer.wait_closed()
        except (BrokenPipeError, ConnectionError, ssl.SSLError):
            pass


class TcpTransport(LengthDelimitedTransport):
    """Safe TCP client transport with bounded connection retry."""

    @staticmethod
    def _resolve_ssl_context(
        config: NetworkConfig,
        *,
        is_server: bool,
        supplied: ssl.SSLContext | None,
    ) -> ssl.SSLContext | None:
        profile = config.security_config.profile
        if supplied is not None and profile in (
            SecurityProfile.STANDARD,
            SecurityProfile.HYBRID_PQ,
            SecurityProfile.RESEARCH,
        ):
            if profile in (SecurityProfile.HYBRID_PQ, SecurityProfile.RESEARCH):
                # Preserve the provider/profile-specific structured error. In
                # particular, an externally supplied standard context must not
                # make hybrid-pq appear usable.
                build_ssl_context(config.security_config, is_server=is_server)
            raise SecurityError(
                "Secure profiles reject external SSLContext overrides; configure "
                "trust and credentials through SecurityConfig.",
                code="tls_context_override_forbidden",
                details={"profile": profile.value},
            )
        return supplied or build_ssl_context(config.security_config, is_server=is_server)

    @classmethod
    async def connect(
        cls,
        host: str,
        port: int,
        *,
        config: NetworkConfig | None = None,
        ssl_context: ssl.SSLContext | None = None,
        server_hostname: str | None = None,
    ) -> TcpTransport:
        resolved = config or NetworkConfig()
        ssl_ctx = cls._resolve_ssl_context(
            resolved,
            is_server=False,
            supplied=ssl_context,
        )
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(
                host,
                port,
                ssl=ssl_ctx,
                server_hostname=(server_hostname or host) if ssl_ctx is not None else None,
            ),
            timeout=resolved.connect_timeout_ms / 1000,
        )
        return cls(
            reader,
            writer,
            config=resolved,
            _secure_factory_token=_SECURE_TRANSPORT_FACTORY_TOKEN,
        )

    @classmethod
    async def start_server(
        cls,
        client_callback: Any,
        host: str,
        port: int,
        *,
        config: NetworkConfig | None = None,
        ssl_context: ssl.SSLContext | None = None,
    ) -> asyncio.Server:
        resolved = config or NetworkConfig()
        resolved.security_config.validate_listen_address(host)
        ssl_ctx = cls._resolve_ssl_context(
            resolved,
            is_server=True,
            supplied=ssl_context,
        )
        async def on_client(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
            try:
                transport = cls(
                    reader,
                    writer,
                    config=resolved,
                    _secure_factory_token=_SECURE_TRANSPORT_FACTORY_TOKEN,
                )
                result = client_callback(transport)
                if inspect.isawaitable(result):
                    await result
            except SecurityError:
                writer.close()
                try:
                    await writer.wait_closed()
                except (BrokenPipeError, ConnectionError, ssl.SSLError):
                    pass

        return await asyncio.start_server(
            on_client,
            host=host,
            port=port,
            ssl=ssl_ctx,
        )

    @classmethod
    async def connect_with_retry(
        cls,
        host: str,
        port: int,
        *,
        config: NetworkConfig | None = None,
    ) -> TcpTransport:
        resolved = config or NetworkConfig()
        last_error: BaseException | None = None
        policy = resolved.retry_policy
        for attempt in range(1, policy.max_attempts + 1):
            try:
                return await cls.connect(host, port, config=resolved)
            except (OSError, asyncio.TimeoutError) as exc:
                last_error = exc
                if attempt >= policy.max_attempts:
                    break
                delay_ms = min(
                    policy.base_delay_ms * (2 ** (attempt - 1)),
                    policy.max_delay_ms,
                )
                if delay_ms:
                    await asyncio.sleep(delay_ms / 1000)
        detail = sanitize_error_message(str(last_error or "connection failed"))
        raise ConnectionError(f"TCP connection failed after retries: {detail}") from last_error


class UnixSocketTransport(LengthDelimitedTransport):
    """Unix domain socket transport. Unsupported platforms fail clearly."""

    @classmethod
    async def connect(
        cls,
        path: str,
        *,
        config: NetworkConfig | None = None,
    ) -> UnixSocketTransport:
        resolved = config or NetworkConfig()
        open_unix_connection = getattr(asyncio, "open_unix_connection", None)
        if open_unix_connection is None:
            raise RuntimeError("Unix domain sockets are unavailable on this platform")
        reader, writer = await asyncio.wait_for(
            open_unix_connection(path),
            timeout=resolved.connect_timeout_ms / 1000,
        )
        return cls(reader, writer, config=resolved)


class WebSocketTransport(Transport):
    """Optional adapter around a connected WebSocket-like object."""

    def __init__(
        self,
        socket: Any,
        *,
        max_message_bytes: int = DEFAULT_MAX_MESSAGE_BYTES,
    ) -> None:
        if max_message_bytes < MIN_MESSAGE_BYTES:
            raise ValueError(f"max_message_bytes must be at least {MIN_MESSAGE_BYTES}")
        for method in ("send", "recv", "close"):
            if not callable(getattr(socket, method, None)):
                raise TypeError(f"WebSocket adapter requires {method}()")
        self.socket = socket
        self.max_message_bytes = max_message_bytes

    @staticmethod
    async def _resolve(value: Any) -> Any:
        return await value if inspect.isawaitable(value) else value

    async def send(self, envelope: MessageEnvelope) -> None:
        payload = envelope.to_json()
        if len(payload.encode("utf-8")) > self.max_message_bytes:
            raise MessageTooLargeError(f"WebSocket frame exceeds {self.max_message_bytes} bytes.")
        await self._resolve(self.socket.send(payload))

    async def receive(self) -> MessageEnvelope:
        payload = await self._resolve(self.socket.recv())
        if isinstance(payload, bytes):
            encoded = payload
            text = payload.decode("utf-8")
        else:
            text = str(payload)
            encoded = text.encode("utf-8")
        if len(encoded) > self.max_message_bytes:
            raise MessageTooLargeError(f"WebSocket frame exceeds {self.max_message_bytes} bytes.")
        return MessageEnvelope.from_json(text)

    async def close(self) -> None:
        await self._resolve(self.socket.close())
