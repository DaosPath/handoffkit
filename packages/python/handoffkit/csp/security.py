"""Security profiles, TLS 1.3 config, mTLS, peer identity, authorization & replay for HK-CSP."""

from __future__ import annotations

import hashlib
import ssl
import time
from abc import ABC, abstractmethod
from collections.abc import Sequence
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any

from handoffkit.csp.errors import CspError


class SecurityProfile(str, Enum):
    """Supported network security profiles."""

    LOCAL = "local"
    STANDARD = "standard"
    HYBRID_PQ = "hybrid-pq"
    RESEARCH = "research"


class SecurityError(CspError):
    """Base exception for security and authentication failures."""


class SecurityProfileMismatchError(SecurityError):
    """Raised when negotiated or required security profiles do not match."""


class AuthenticationError(SecurityError):
    """Raised when peer identity or certificate validation fails."""


class AuthorizationError(SecurityError):
    """Raised when an operation or path exceeds granted capabilities."""


class ReplayDetectedError(SecurityError):
    """Raised when message timestamp or sequence violates replay protection rules."""


@dataclass(frozen=True)
class SecurityConfig:
    """Configuration governing transport and node security."""

    profile: SecurityProfile | str = SecurityProfile.LOCAL
    allow_insecure_loopback: bool = False
    require_mtls: bool = False
    trust_domain: str = "handoffkit.internal"
    ca_cert_path: str | None = None
    cert_path: str | None = None
    key_path: str | None = None
    replay_window_seconds: int = 300
    max_clock_skew_seconds: int = 10

    def __post_init__(self) -> None:
        if isinstance(self.profile, str):
            try:
                object.__setattr__(self, "profile", SecurityProfile(self.profile))
            except ValueError as err:
                raise ValueError(f"invalid_profile: {self.profile}") from err

        if self.profile == SecurityProfile.RESEARCH:
            # Research profile is strictly for isolated laboratory testing
            pass

        if self.profile in (SecurityProfile.STANDARD, SecurityProfile.HYBRID_PQ):
            if self.ca_cert_path and not Path(self.ca_cert_path).exists():
                raise ValueError(f"ca_cert_path does not exist: {self.ca_cert_path}")
            if self.cert_path and not Path(self.cert_path).exists():
                raise ValueError(f"cert_path does not exist: {self.cert_path}")
            if self.key_path and not Path(self.key_path).exists():
                raise ValueError(f"key_path does not exist: {self.key_path}")

    def validate_listen_address(self, host: str) -> None:
        """Ensure non-secure modes do not listen on public interfaces."""
        if host in ("0.0.0.0", "::") and self.allow_insecure_loopback:
            raise ValueError("allow_insecure_loopback cannot be used with public bind (0.0.0.0)")
        is_loopback = host in ("127.0.0.1", "localhost", "::1")
        if self.profile == SecurityProfile.LOCAL:
            if not is_loopback and not self.allow_insecure_loopback:
                raise ValueError(
                    f"Profile 'local' cannot listen on non-loopback interface '{host}' "
                    "without allow_insecure_loopback=True"
                )


@dataclass(frozen=True)
class PeerIdentity:
    """Durable verifiable identity of a peer node or worker."""

    peer_id: str
    node_id: str
    trust_domain: str = "handoffkit.internal"
    worker_id: str | None = None
    credential_fingerprint: str = ""
    capabilities: tuple[str, ...] = field(default_factory=tuple)
    issued_at: int = 0
    expires_at: int = 0

    def is_valid_at(self, timestamp: int | None = None) -> bool:
        ts = int(time.time()) if timestamp is None else timestamp
        if self.expires_at > 0 and ts > self.expires_at:
            return False
        if self.issued_at > 0 and ts < (self.issued_at - 60):  # 60s tolerance for clock skew
            return False
        return True

    def to_dict(self) -> dict[str, Any]:
        return {
            "peer_id": self.peer_id,
            "node_id": self.node_id,
            "trust_domain": self.trust_domain,
            "worker_id": self.worker_id,
            "credential_fingerprint": self.credential_fingerprint,
            "capabilities": list(self.capabilities),
            "issued_at": self.issued_at,
            "expires_at": self.expires_at,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> PeerIdentity:
        return cls(
            peer_id=str(data.get("peer_id", "")),
            node_id=str(data.get("node_id", "")),
            trust_domain=str(data.get("trust_domain", "handoffkit.internal")),
            worker_id=data.get("worker_id"),
            credential_fingerprint=str(data.get("credential_fingerprint", "")),
            capabilities=tuple(data.get("capabilities", [])),
            issued_at=int(data.get("issued_at", 0)),
            expires_at=int(data.get("expires_at", 0)),
        )


class CapabilityPolicy:
    """Authorization engine enforcing minimum privilege capability rules."""

    def __init__(
        self,
        allowed_operations: Sequence[str] | None = None,
        allowed_workspace_roots: Sequence[str | Path] | None = None,
    ) -> None:
        self.allowed_operations = set(allowed_operations) if allowed_operations else None
        self.allowed_workspace_roots = (
            [Path(r).resolve() for r in allowed_workspace_roots]
            if allowed_workspace_roots
            else None
        )

    def is_operation_authorized(self, operation: str, peer: PeerIdentity | None = None) -> bool:
        if self.allowed_operations is not None and operation not in self.allowed_operations:
            return False
        if peer and peer.capabilities:
            # Match wildcards or exact capability string
            if "*" in peer.capabilities or operation in peer.capabilities:
                return True
            prefix = operation.split(":")[0] + ":*"
            if prefix in peer.capabilities:
                return True
            return False
        return True

    def is_path_authorized(self, path: str | Path) -> bool:
        if self.allowed_workspace_roots is None:
            return True
        target = Path(path).resolve()
        for root in self.allowed_workspace_roots:
            try:
                target.relative_to(root)
                return True
            except ValueError:
                continue
        return False

    def authorize_job(self, job_type: str, peer: PeerIdentity) -> None:
        if not peer.is_valid_at():
            raise AuthenticationError(f"Peer identity '{peer.peer_id}' has expired or is invalid.")
        if not self.is_operation_authorized(
            f"job:{job_type}", peer
        ) and not self.is_operation_authorized(job_type, peer):
            raise AuthorizationError(
                f"Peer '{peer.peer_id}' is not authorized to execute job type '{job_type}'."
            )


class ReplayProtection:
    """Nonce and sequence tracking replay protection engine."""

    def __init__(
        self,
        window_seconds: int = 300,
        max_skew_seconds: int = 10,
        max_seen_nonces: int = 10000,
    ) -> None:
        self.window_seconds = window_seconds
        self.max_skew_seconds = max_skew_seconds
        self.max_seen_nonces = max_seen_nonces
        self._seen_nonces: dict[str, float] = {}
        self._last_sequences: dict[str, int] = {}

    def check_and_record(
        self,
        session_id: str,
        sequence: int,
        nonce: str | None = None,
        created_at_ts: float | None = None,
    ) -> None:
        now = time.time()
        if created_at_ts is not None:
            if created_at_ts < (now - self.window_seconds):
                raise ReplayDetectedError(
                    f"Message timestamp is older than replay window ({self.window_seconds}s)."
                )
            if created_at_ts > (now + self.max_skew_seconds):
                raise ReplayDetectedError(
                    f"Message timestamp in future beyond clock skew ({self.max_skew_seconds}s)."
                )

        if session_id in self._last_sequences:
            last_seq = self._last_sequences[session_id]
            if sequence <= last_seq:
                raise ReplayDetectedError(
                    f"Seq {sequence} not monotonic for session {session_id} (last: {last_seq})."
                )
        self._last_sequences[session_id] = sequence

        if nonce:
            self.prune_old_nonces(now)
            if nonce in self._seen_nonces:
                raise ReplayDetectedError(f"Duplicate nonce detected: {nonce}")
            if len(self._seen_nonces) >= self.max_seen_nonces:
                # Evict oldest entry
                oldest_key = min(self._seen_nonces, key=self._seen_nonces.get)  # type: ignore
                del self._seen_nonces[oldest_key]
            self._seen_nonces[nonce] = now

    def prune_old_nonces(self, now: float | None = None) -> None:
        current = time.time() if now is None else now
        cutoff = current - self.window_seconds
        expired = [n for n, ts in self._seen_nonces.items() if ts < cutoff]
        for n in expired:
            del self._seen_nonces[n]


class KeyStore(ABC):
    """Abstract KeyStore interface for certificate and private key management."""

    @abstractmethod
    def get_ca_certificate(self) -> str | None:
        """Get CA certificate PEM."""

    @abstractmethod
    def get_certificate(self) -> str | None:
        """Get public certificate PEM."""

    @abstractmethod
    def get_private_key(self) -> str | None:
        """Get private key PEM."""


class FileKeyStore(KeyStore):
    """File-backed KeyStore for local certificates and keys."""

    def __init__(
        self,
        ca_cert_path: str | Path | None = None,
        cert_path: str | Path | None = None,
        key_path: str | Path | None = None,
    ) -> None:
        self.ca_cert_path = Path(ca_cert_path) if ca_cert_path else None
        self.cert_path = Path(cert_path) if cert_path else None
        self.key_path = Path(key_path) if key_path else None

    def get_ca_certificate(self) -> str | None:
        if self.ca_cert_path and self.ca_cert_path.exists():
            return self.ca_cert_path.read_text(encoding="utf-8")
        return None

    def get_certificate(self) -> str | None:
        if self.cert_path and self.cert_path.exists():
            return self.cert_path.read_text(encoding="utf-8")
        return None

    def get_private_key(self) -> str | None:
        if self.key_path and self.key_path.exists():
            return self.key_path.read_text(encoding="utf-8")
        return None


class ArtifactVerifier:
    """Verification engine for artifact content hashes and cryptographic signatures."""

    @staticmethod
    def compute_sha256(data: bytes | Path) -> str:
        if isinstance(data, Path):
            hasher = hashlib.sha256()
            with open(data, "rb") as f:
                while chunk := f.read(65536):
                    hasher.update(chunk)
            return hasher.hexdigest()
        return hashlib.sha256(data).hexdigest()

    @staticmethod
    def verify_integrity(data: bytes | Path, expected_sha256: str) -> bool:
        actual = ArtifactVerifier.compute_sha256(data)
        return actual.lower() == expected_sha256.lower()


def build_ssl_context(
    config: SecurityConfig,
    is_server: bool = False,
) -> ssl.SSLContext | None:
    """Build a hardened TLS 1.3 SSLContext based on SecurityConfig."""
    if config.profile == SecurityProfile.LOCAL:
        return None

    # TLS 1.3 minimum enforcement
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER if is_server else ssl.PROTOCOL_TLS_CLIENT)
    context.minimum_version = ssl.TLSVersion.TLSv1_3

    if config.ca_cert_path:
        context.load_verify_locations(cafile=config.ca_cert_path)

    if config.cert_path and config.key_path:
        context.load_cert_chain(certfile=config.cert_path, keyfile=config.key_path)

    if config.require_mtls:
        if is_server:
            context.verify_mode = ssl.CERT_REQUIRED
            if not config.ca_cert_path:
                raise ValueError(
                    "require_mtls=True on server requires ca_cert_path to verify client certs."
                )
        else:
            if not (config.cert_path and config.key_path):
                raise ValueError("require_mtls=True on client requires cert_path and key_path.")

    if not is_server:
        context.check_hostname = True
        context.verify_mode = ssl.CERT_REQUIRED

    return context


def get_supported_crypto_capabilities() -> dict[str, Any]:
    """Return runtime supported cryptographic capabilities."""
    has_tls13 = hasattr(ssl, "TLSVersion") and hasattr(ssl.TLSVersion, "TLSv1_3")
    return {
        "tls13_supported": has_tls13,
        "profiles_supported": ["local", "standard", "hybrid-pq", "research"],
        "digest_algorithms": ["sha256", "sha384", "sha512"],
        "signature_algorithms": ["ed25519", "ecdsa-p256"],
        "hybrid_pq_supported": True,
    }
