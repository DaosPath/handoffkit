"""Transport interfaces and stdio NDJSON framing for HK-CSP."""

from __future__ import annotations

import asyncio
from abc import ABC, abstractmethod
from collections.abc import Sequence

from handoffkit.csp.errors import ChannelClosedError, MessageTooLargeError
from handoffkit.csp.models import DEFAULT_MAX_MESSAGE_BYTES, MessageEnvelope


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
            raise MessageTooLargeError(
                f"Encoded envelope exceeds {self.max_message_bytes} bytes."
            )
        self.writer.write(data)
        await self.writer.drain()

    async def receive(self) -> MessageEnvelope:
        data = await self.reader.readline()
        if not data:
            raise ChannelClosedError("stdio peer closed the protocol stream")
        if len(data) > self.max_message_bytes:
            raise MessageTooLargeError(
                f"Encoded envelope exceeds {self.max_message_bytes} bytes."
            )
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
            stderr=asyncio.subprocess.PIPE,
        )
        return cls(process, max_message_bytes=max_message_bytes)

    async def send(self, envelope: MessageEnvelope) -> None:
        data = envelope.to_json().encode("utf-8") + b"\n"
        if len(data) > self.max_message_bytes:
            raise MessageTooLargeError(
                f"Encoded envelope exceeds {self.max_message_bytes} bytes."
            )
        self.writer.write(data)
        await self.writer.drain()

    async def receive(self) -> MessageEnvelope:
        data = await self.reader.readline()
        if not data:
            raise ChannelClosedError("child process closed stdout")
        if len(data) > self.max_message_bytes:
            raise MessageTooLargeError(
                f"Encoded envelope exceeds {self.max_message_bytes} bytes."
            )
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
                await self.process.wait()
