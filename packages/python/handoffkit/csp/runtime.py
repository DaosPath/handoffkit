"""Async HK-CSP session and process runtime."""

from __future__ import annotations

import asyncio
import inspect
from collections import OrderedDict
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from handoffkit.csp.channel import CspChannel
from handoffkit.csp.channel import select as select_channel
from handoffkit.csp.errors import (
    DeadlineExceededError,
    DistributedRuntimeUnavailableError,
)
from handoffkit.csp.models import (
    ChannelConfig,
    DeliveryAck,
    DeliveryNack,
    MessageEnvelope,
    RuntimeMode,
    SessionConfig,
)

ProcessHandler = Callable[["ProcessContext"], Awaitable[Any] | Any]


@dataclass
class ProcessHandle:
    """Handle for one logical CSP process."""

    process_id: str
    task: asyncio.Task[Any]

    @property
    def done(self) -> bool:
        return self.task.done()

    def cancel(self) -> None:
        self.task.cancel()

    async def wait(self) -> Any:
        return await self.task


class ProcessContext:
    """Capabilities exposed to one logical process."""

    def __init__(self, session: CspSession, process_id: str) -> None:
        self.session = session
        self.process_id = process_id

    @property
    def cancelled(self) -> bool:
        return self.session.cancelled

    async def send(self, channel: str, envelope: MessageEnvelope) -> None:
        await self.session.send(channel, envelope)

    async def receive(self, channel: str) -> MessageEnvelope:
        return await self.session.receive(channel)

    async def select(self, channels: Iterable[str]) -> tuple[str, MessageEnvelope]:
        return await self.session.select(channels)

    def ack(self, envelope: MessageEnvelope, **metadata: Any) -> DeliveryAck:
        return self.session.ack(envelope, metadata=metadata)

    def nack(
        self,
        envelope: MessageEnvelope,
        *,
        code: str,
        message: str,
        retryable: bool = False,
        metadata: dict[str, Any] | None = None,
    ) -> DeliveryNack:
        return self.session.nack(
            envelope,
            code=code,
            message=message,
            retryable=retryable,
            metadata=metadata,
        )


class CspSession:
    """Own channels, processes, acknowledgements, and cancellation state."""

    def __init__(self, config: SessionConfig) -> None:
        if config.runtime_mode is RuntimeMode.DISTRIBUTED:
            raise DistributedRuntimeUnavailableError(
                "RuntimeMode.DISTRIBUTED requires the HandoffKit distributed runtime."
            )
        self.config = config
        self._channels: dict[str, CspChannel] = {}
        self._processes: dict[str, ProcessHandle] = {}
        self._pending_acks: dict[str, asyncio.Future[DeliveryAck | DeliveryNack]] = {}
        self._pending_envelopes: dict[str, MessageEnvelope] = {}
        self._dedup: OrderedDict[str, None] = OrderedDict()
        self._cancelled = asyncio.Event()
        self._closed = False
        self._deadline_task: asyncio.Task[None] | None = None

    @property
    def session_id(self) -> str:
        return self.config.session_id

    @property
    def cancelled(self) -> bool:
        return self._cancelled.is_set()

    @property
    def closed(self) -> bool:
        return self._closed

    def channel(
        self,
        name: str,
        *,
        capacity: int | None = None,
        requires_ack: bool = False,
    ) -> CspChannel:
        """Get or create a named channel."""
        if name not in self._channels:
            self._channels[name] = CspChannel(
                ChannelConfig(
                    name=name,
                    capacity=capacity or self.config.channel_capacity,
                    requires_ack=requires_ack,
                ),
                max_message_bytes=self.config.max_message_bytes,
            )
        return self._channels[name]

    def _remaining_deadline(self) -> float | None:
        if not self.config.deadline:
            return None
        parsed = datetime.fromisoformat(self.config.deadline.replace("Z", "+00:00"))
        return (parsed - datetime.now(timezone.utc)).total_seconds()

    def _ensure_deadline_guard(self) -> None:
        if not self.config.deadline or self._deadline_task is not None:
            return

        async def guard() -> None:
            remaining = self._remaining_deadline() or 0
            if remaining > 0:
                await asyncio.sleep(remaining)
            if not self._closed:
                self.cancel()

        self._deadline_task = asyncio.create_task(
            guard(),
            name=f"{self.session_id}-deadline",
        )

    async def _with_deadline(self, operation: Awaitable[Any]) -> Any:
        self._ensure_deadline_guard()
        remaining = self._remaining_deadline()
        if remaining is None:
            return await operation
        if remaining <= 0:
            if inspect.iscoroutine(operation):
                operation.close()
            self.cancel()
            raise DeadlineExceededError(f"Session {self.session_id!r} deadline elapsed.")
        try:
            return await asyncio.wait_for(operation, timeout=remaining)
        except TimeoutError as exc:
            self.cancel()
            raise DeadlineExceededError(
                f"Session {self.session_id!r} deadline elapsed."
            ) from exc

    async def send(self, channel: str, envelope: MessageEnvelope) -> None:
        if envelope.session_id != self.session_id:
            raise ValueError("Envelope session_id does not match this session.")
        if self.cancelled:
            raise RuntimeError("Cannot send through a cancelled CSP session.")
        if envelope.deadline is None and self.config.deadline:
            envelope = replace(envelope, deadline=self.config.deadline)
        await self._with_deadline(self.channel(channel).send(envelope))

    async def receive(self, channel: str) -> MessageEnvelope:
        """Receive one non-duplicate message and track it until ACK/NACK."""
        while True:
            envelope = await self._with_deadline(self.channel(channel).receive())
            key = envelope.idempotency_key
            if key and key in self._dedup:
                self.ack(envelope, metadata={"duplicate": True})
                continue
            self._pending_envelopes[envelope.message_id] = envelope
            return envelope

    async def select(self, channels: Iterable[str]) -> tuple[str, MessageEnvelope]:
        resolved = tuple(channels)
        while True:
            selected, envelope = await self._with_deadline(
                select_channel(self.channel(name) for name in resolved)
            )
            key = envelope.idempotency_key
            if key and key in self._dedup:
                self.ack(envelope, metadata={"duplicate": True})
                continue
            self._pending_envelopes[envelope.message_id] = envelope
            return selected.name, envelope

    def spawn(self, process_id: str, handler: ProcessHandler) -> ProcessHandle:
        """Spawn a logical process owned by this session."""
        if self._closed:
            raise RuntimeError("Cannot spawn a process in a closed session.")
        if process_id in self._processes:
            raise ValueError(f"Process {process_id!r} already exists.")

        async def runner() -> Any:
            result = handler(ProcessContext(self, process_id))
            return await result if inspect.isawaitable(result) else result

        handle = ProcessHandle(process_id, asyncio.create_task(runner(), name=process_id))
        self._processes[process_id] = handle
        self._ensure_deadline_guard()
        return handle

    def ack(
        self,
        envelope: MessageEnvelope,
        *,
        metadata: dict[str, Any] | None = None,
    ) -> DeliveryAck:
        """Acknowledge processing and remember its idempotency key."""
        ack = DeliveryAck(envelope.message_id, metadata=dict(metadata or {}))
        self._pending_envelopes.pop(envelope.message_id, None)
        if envelope.idempotency_key:
            self._dedup[envelope.idempotency_key] = None
            self._dedup.move_to_end(envelope.idempotency_key)
            while len(self._dedup) > self.config.dedup_capacity:
                self._dedup.popitem(last=False)
        future = self._pending_acks.get(envelope.message_id)
        if future is not None and not future.done():
            future.set_result(ack)
        return ack

    def nack(
        self,
        envelope: MessageEnvelope,
        *,
        code: str,
        message: str,
        retryable: bool = False,
        metadata: dict[str, Any] | None = None,
    ) -> DeliveryNack:
        """Reject processing with a structured reason."""
        nack = DeliveryNack(
            message_id=envelope.message_id,
            code=code,
            message=message,
            retryable=retryable,
            metadata=dict(metadata or {}),
        )
        self._pending_envelopes.pop(envelope.message_id, None)
        future = self._pending_acks.get(envelope.message_id)
        if future is not None and not future.done():
            future.set_result(nack)
        return nack

    async def send_with_ack(self, channel: str, envelope: MessageEnvelope) -> DeliveryAck:
        """Send and retry until acknowledged or policy is exhausted."""
        if not envelope.requires_ack:
            raise ValueError("send_with_ack requires envelope.requires_ack=True")
        policy = self.config.retry_policy
        current = envelope
        loop = asyncio.get_running_loop()
        for attempt in range(1, policy.max_attempts + 1):
            future: asyncio.Future[DeliveryAck | DeliveryNack] = loop.create_future()
            self._pending_acks[current.message_id] = future
            try:
                await self.send(channel, current)
                result = await asyncio.wait_for(
                    future,
                    timeout=self.config.ack_timeout_ms / 1000,
                )
            except TimeoutError:
                result = DeliveryNack(
                    current.message_id,
                    "ack_timeout",
                    "Acknowledgement deadline elapsed.",
                    retryable=True,
                )
            finally:
                self._pending_acks.pop(current.message_id, None)
            if isinstance(result, DeliveryAck):
                return result
            if not result.retryable or attempt >= policy.max_attempts:
                raise RuntimeError(f"Message was not acknowledged: {result.code}: {result.message}")
            delay_ms = min(policy.base_delay_ms * (2 ** (attempt - 1)), policy.max_delay_ms)
            if delay_ms:
                await asyncio.sleep(delay_ms / 1000)
            current = current.next_attempt()
        raise AssertionError("retry loop exited unexpectedly")

    async def wait(self) -> list[Any]:
        """Wait for all owned processes and propagate their errors."""
        if not self._processes:
            return []
        return await asyncio.gather(*(handle.wait() for handle in self._processes.values()))

    def cancel(self) -> None:
        """Cancel this session and all child processes."""
        self._cancelled.set()
        for handle in self._processes.values():
            if not handle.done:
                handle.cancel()
        for channel in self._channels.values():
            channel.cancel()
        try:
            current = asyncio.current_task()
        except RuntimeError:
            current = None
        if self._deadline_task is not None and self._deadline_task is not current:
            self._deadline_task.cancel()

    async def close(self) -> None:
        """Close channels and cancel remaining child processes."""
        if self._closed:
            return
        self._closed = True
        self.cancel()
        for channel in self._channels.values():
            await channel.close()
        await asyncio.gather(
            *(handle.task for handle in self._processes.values()),
            return_exceptions=True,
        )
        if self._deadline_task is not None:
            await asyncio.gather(self._deadline_task, return_exceptions=True)


class CspRuntime:
    """Factory for local HK-CSP sessions."""

    def __init__(self, *, mode: RuntimeMode = RuntimeMode.SESSION) -> None:
        self.mode = mode

    def create_session(
        self,
        *,
        session_id: str | None = None,
        config: SessionConfig | None = None,
    ) -> CspSession:
        if self.mode is RuntimeMode.DISTRIBUTED:
            raise DistributedRuntimeUnavailableError(
                "RuntimeMode.DISTRIBUTED becomes available with the distributed backend."
            )
        resolved = config or SessionConfig(
            session_id=session_id or f"session-{uuid4().hex}",
            runtime_mode=self.mode,
        )
        return CspSession(resolved)


def make_envelope(
    *,
    session_id: str,
    channel: str,
    source: str,
    payload_type: str,
    payload: Any,
    sequence: int,
    target: str | None = None,
    kind: str = "data",
    requires_ack: bool = False,
    idempotency_key: str | None = None,
) -> MessageEnvelope:
    """Build an envelope with a generated message ID."""
    return MessageEnvelope(
        message_id=f"msg-{uuid4().hex}",
        session_id=session_id,
        channel=channel,
        kind=kind,
        source=source,
        target=target,
        sequence=sequence,
        payload_type=payload_type,
        payload=payload,
        requires_ack=requires_ack,
        idempotency_key=idempotency_key,
    )
