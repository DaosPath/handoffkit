"""Bounded FIFO channels for HK-CSP."""

from __future__ import annotations

import asyncio
from collections.abc import Iterable
from datetime import datetime, timezone

from handoffkit.csp.errors import (
    BackpressureError,
    ChannelClosedError,
    DeadlineExceededError,
    MessageTooLargeError,
)
from handoffkit.csp.models import ChannelConfig, MessageEnvelope, OverflowPolicy


def _deadline_elapsed(value: str | None) -> bool:
    if not value:
        return False
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed <= datetime.now(timezone.utc)


class CspChannel:
    """One bounded asynchronous FIFO channel."""

    def __init__(self, config: ChannelConfig, *, max_message_bytes: int) -> None:
        self.config = config
        self.max_message_bytes = max_message_bytes
        self._queue: asyncio.Queue[MessageEnvelope] = asyncio.Queue(config.capacity)
        self._closed = False
        self._close_event = asyncio.Event()

    @property
    def name(self) -> str:
        return self.config.name

    @property
    def closed(self) -> bool:
        return self._closed

    def qsize(self) -> int:
        return self._queue.qsize()

    async def send(self, envelope: MessageEnvelope) -> None:
        """Enqueue an envelope, applying size, deadline, and backpressure rules."""
        if self._closed:
            raise ChannelClosedError(f"Channel {self.name!r} is closed.")
        if envelope.channel != self.name:
            raise ValueError(
                f"Envelope channel {envelope.channel!r} does not match {self.name!r}."
            )
        if envelope.encoded_size() > self.max_message_bytes:
            raise MessageTooLargeError(
                f"Envelope {envelope.message_id!r} exceeds {self.max_message_bytes} bytes."
            )
        if _deadline_elapsed(envelope.deadline):
            raise DeadlineExceededError(
                f"Envelope {envelope.message_id!r} deadline has elapsed."
            )
        if self.config.overflow_policy is OverflowPolicy.REJECT and self._queue.full():
            raise BackpressureError(f"Channel {self.name!r} is at capacity.")
        if not self._queue.full():
            self._queue.put_nowait(envelope)
            return
        put_task = asyncio.create_task(self._queue.put(envelope))
        close_task = asyncio.create_task(self._close_event.wait())
        try:
            done, _ = await asyncio.wait(
                (put_task, close_task),
                return_when=asyncio.FIRST_COMPLETED,
            )
            if close_task in done:
                put_task.cancel()
                await asyncio.gather(put_task, return_exceptions=True)
                raise ChannelClosedError(f"Channel {self.name!r} is closed.")
            await put_task
        finally:
            close_task.cancel()
            await asyncio.gather(close_task, return_exceptions=True)

    async def receive(self) -> MessageEnvelope:
        """Receive the next envelope or fail after channel closure."""
        if not self._queue.empty():
            return self._queue.get_nowait()
        if self._closed:
            raise ChannelClosedError(f"Channel {self.name!r} is closed.")
        get_task = asyncio.create_task(self._queue.get())
        close_task = asyncio.create_task(self._close_event.wait())
        try:
            done, _ = await asyncio.wait(
                (get_task, close_task),
                return_when=asyncio.FIRST_COMPLETED,
            )
            if close_task in done:
                get_task.cancel()
                await asyncio.gather(get_task, return_exceptions=True)
                raise ChannelClosedError(f"Channel {self.name!r} is closed.")
            return await get_task
        finally:
            close_task.cancel()
            await asyncio.gather(close_task, return_exceptions=True)

    def cancel(self) -> None:
        """Close immediately and wake blocked senders or receivers."""
        if self._closed:
            return
        self._closed = True
        self._close_event.set()

    async def close(self) -> None:
        """Close the channel and wake a blocked receiver."""
        if self._closed:
            return
        self.cancel()


async def select(channels: Iterable[CspChannel]) -> tuple[CspChannel, MessageEnvelope]:
    """Return the first available envelope from several channels."""
    channel_list = list(channels)
    if not channel_list:
        raise ValueError("select requires at least one channel")
    tasks = {asyncio.create_task(channel.receive()): channel for channel in channel_list}
    try:
        done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        completed = next(iter(done))
        return tasks[completed], completed.result()
    finally:
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
