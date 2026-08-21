"""Browser Real client. Callback dispatch is a test adapter; TLS is the network path."""

from __future__ import annotations

import secrets
import uuid
from collections.abc import Callable
from typing import Any, Protocol

from handoffkit.browser.core import BrowserCommand, BrowserEvent
from handoffkit.csp.models import MessageEnvelope

BROWSER_CONTROL_CHANNEL = "browser.control"
BROWSER_CONTROL_OPERATION = "browser:control"


class _Transport(Protocol):
    def send(self, payload: dict[str, Any]) -> None: ...

    def receive(self) -> dict[str, Any]: ...


class _AsyncTransport(Protocol):
    async def send(self, envelope: MessageEnvelope) -> None: ...

    async def receive(self) -> MessageEnvelope: ...


class BrowserRealClient:
    def __init__(
        self,
        *,
        dispatch: Callable[[dict[str, Any]], Any] | None = None,
        transport: _Transport | None = None,
        async_transport: _AsyncTransport | None = None,
        fingerprint: str = "",
        peer_id: str = "",
        identity: dict[str, Any] | None = None,
    ) -> None:
        if dispatch is None and transport is None and async_transport is None:
            raise ValueError("Browser Real client requires dispatch or a TLS transport")
        self._dispatch = dispatch
        self._transport = transport
        self._async_transport = async_transport
        wire = dict(identity or {})
        self._peer_id = str(peer_id or wire.get("peer_id") or "")
        self._fingerprint = str(
            fingerprint
            or wire.get("credential_fingerprint")
            or wire.get("fingerprint")
            or ""
        )
        self._identity = {
            "peer_id": self._peer_id,
            "node_id": str(wire.get("node_id") or ""),
            "worker_id": wire.get("worker_id"),
            "trust_domain": str(wire.get("trust_domain") or "handoffkit.internal"),
            "credential_fingerprint": self._fingerprint,
            "capabilities": list(wire.get("capabilities") or ["browser:*"]),
            "issued_at": int(wire.get("issued_at") or 0),
            "expires_at": int(wire.get("expires_at") or 0),
        }
        self._sequence = 0

    def send(self, command: BrowserCommand | dict[str, Any]) -> BrowserEvent:
        wire = command.to_wire() if isinstance(command, BrowserCommand) else dict(command)
        if self._dispatch is not None:
            event = self._dispatch(wire)
            return event if isinstance(event, BrowserEvent) else BrowserEvent.from_wire(event)
        if self._transport is not None:
            self._transport.send(self._wrap(wire).to_dict())
            envelope = self._transport.receive()
            payload = envelope.get("payload") if isinstance(envelope, dict) else envelope
            return BrowserEvent.from_wire(payload if isinstance(payload, dict) else {})
        raise ValueError("synchronous TLS send requires an async_transport via send_tls()")

    async def send_tls(self, command: BrowserCommand | dict[str, Any]) -> BrowserEvent:
        if self._async_transport is None:
            raise ValueError("send_tls requires TcpTransport.connect()")
        wire = command.to_wire() if isinstance(command, BrowserCommand) else dict(command)
        envelope = self._wrap(wire)
        await self._async_transport.send(envelope)
        response = await self._async_transport.receive()
        payload = response.payload if isinstance(response.payload, dict) else {}
        return BrowserEvent.from_wire(payload)

    def _wrap(self, wire: dict[str, Any]) -> MessageEnvelope:
        if not self._fingerprint and not self._peer_id:
            raise ValueError("TLS client identity fingerprint is required")
        self._sequence += 1
        nonce = secrets.token_hex(16)
        source = self._peer_id or f"cert:{self._fingerprint}"
        return MessageEnvelope(
            message_id=f"msg-{uuid.uuid4()}",
            session_id=str(wire.get("session_id") or uuid.uuid4()),
            channel=BROWSER_CONTROL_CHANNEL,
            kind="request",
            source=source,
            sequence=self._sequence,
            payload_type="browser.command",
            payload=wire,
            metadata={
                "nonce": nonce,
                "security_nonce": nonce,
                "operation": BROWSER_CONTROL_OPERATION,
                "certificate_fingerprint": self._fingerprint,
                "peer_identity": dict(self._identity),
                "command_name": str(wire.get("name") or ""),
            },
        )

    async def close(self) -> None:
        transport = self._async_transport or self._transport
        if transport is None:
            return
        destroy = getattr(transport, "destroy", None)
        if callable(destroy):
            destroy()
            return
        closer = getattr(transport, "close", None)
        if callable(closer):
            result = closer()
            if hasattr(result, "__await__"):
                await result

    @classmethod
    async def connect_tls(
        cls,
        host: str,
        port: int,
        *,
        config: Any,
        fingerprint: str = "",
        identity: dict[str, Any] | None = None,
    ) -> BrowserRealClient:
        from handoffkit.csp.security import PeerIdentity
        from handoffkit.csp.transport import TcpTransport

        transport = await TcpTransport.connect(host, port, config=config)
        local = getattr(transport, "local_certificate_identity", None)
        if local is None:
            local = getattr(transport, "_local_certificate_identity", None)
        wire: dict[str, Any] = {}
        if isinstance(local, PeerIdentity):
            wire = local.to_dict()
        elif identity:
            wire = dict(identity)
        policy = getattr(config, "identity_policy", None)
        grants = getattr(policy, "capabilities_by_fingerprint", None) if policy else None
        fp = fingerprint or str(wire.get("credential_fingerprint") or "")
        capabilities = list(wire.get("capabilities") or [])
        if grants and fp:
            found = grants.get(fp) if hasattr(grants, "get") else None
            if found:
                capabilities = list(found)
        wire["capabilities"] = capabilities or ["browser:*"]
        return cls(
            async_transport=transport,
            fingerprint=fp,
            peer_id=str(wire.get("peer_id") or ""),
            identity=wire,
        )
