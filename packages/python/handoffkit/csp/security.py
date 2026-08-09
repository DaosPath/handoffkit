"""Security profiles, TLS 1.3 config, mTLS, peer identity, authorization & replay for HK-CSP."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import ssl
import stat
import threading
import time
import weakref
from abc import ABC, abstractmethod
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from dataclasses import replace as dataclass_replace
from datetime import timezone
from enum import Enum
from pathlib import Path
from typing import Any, Protocol
from urllib.parse import unquote, urlparse

from cryptography import x509
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)

from handoffkit.csp.errors import CspError


class SecurityProfile(str, Enum):
    """Supported network security profiles."""

    LOCAL = "local"
    STANDARD = "standard"
    HYBRID_PQ = "hybrid-pq"
    RESEARCH = "research"


class SecurityError(CspError):
    """Base exception for security and authentication failures."""

    code = "security_error"

    def __init__(
        self,
        message: str,
        *,
        code: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code or type(self).code
        self.details = dict(details or {})

    def to_dict(self) -> dict[str, Any]:
        """Return the canonical structured error representation."""
        return {
            "code": self.code,
            "message": str(self),
            "details": dict(self.details),
        }


class SecurityProfileMismatchError(SecurityError):
    """Raised when negotiated or required security profiles do not match."""

    code = "security_profile_mismatch"


class SecurityProfileUnavailableError(SecurityError):
    """Raised when the selected security profile has no usable provider."""

    code = "security_profile_unavailable"


class AuthenticationError(SecurityError):
    """Raised when peer identity or certificate validation fails."""

    code = "authentication_failed"


class AuthorizationError(SecurityError):
    """Raised when an operation or path exceeds granted capabilities."""

    code = "authorization_denied"


class ReplayDetectedError(SecurityError):
    """Raised when message timestamp or sequence violates replay protection rules."""

    code = "replay_detected"


class ArtifactSignatureError(SecurityError):
    """Raised when a signed artifact fails cryptographic or signer policy checks."""

    code = "artifact_signature_invalid"


class RevocationPolicy(Protocol):
    """Read-only revocation decision interface consumed by secure routes."""

    def is_revoked(self, kind: str, value: str, *, now: int | None = None) -> bool:
        """Return whether a normalized subject is currently revoked."""
        ...


def negotiate_security_profile(
    required: SecurityProfile | str,
    offered: SecurityProfile | str,
    supported_profiles: Sequence[SecurityProfile | str],
) -> SecurityProfile:
    """Select an exact profile; mismatches and unavailable providers fail closed."""
    try:
        required_profile = SecurityProfile(required)
        offered_profile = SecurityProfile(offered)
        supported = {SecurityProfile(profile) for profile in supported_profiles}
    except ValueError as error:
        raise SecurityProfileUnavailableError(
            "A security profile is not recognized by this runtime."
        ) from error
    if required_profile != offered_profile:
        raise SecurityProfileMismatchError(
            "Required and offered security profiles do not match.",
            details={
                "required": required_profile.value,
                "offered": offered_profile.value,
            },
        )
    if required_profile not in supported:
        raise SecurityProfileUnavailableError(
            "The exact security profile has no active provider.",
            details={"profile": required_profile.value},
        )
    return required_profile


HYBRID_PQ_GROUP = "X25519MLKEM768"
CERTIFICATE_IDENTITY_SCHEME = "spiffe"


@dataclass(frozen=True)
class SecurityConfig:
    """Configuration governing transport and node security."""

    profile: SecurityProfile | str = SecurityProfile.LOCAL
    allow_insecure_loopback: bool = False
    require_mtls: bool = False
    trust_domain: str = "handoffkit.internal"
    credential_source: str = "file"
    credential_target: str | None = None
    ca_cert_path: str | None = None
    cert_path: str | None = None
    key_path: str | None = None
    ocsp_response_path: str | None = None
    ocsp_fetch: bool = False
    ocsp_responder_url: str | None = None
    require_ocsp: bool = False
    replay_window_seconds: int = 300
    max_clock_skew_seconds: int = 10

    def __post_init__(self) -> None:
        if isinstance(self.profile, str):
            try:
                object.__setattr__(self, "profile", SecurityProfile(self.profile))
            except ValueError as err:
                raise ValueError(f"invalid_profile: {self.profile}") from err

        if self.credential_source not in ("file", "os_keystore"):
            raise SecurityError(
                "credential_source must be 'file' or 'os_keystore'.",
                code="invalid_security_config",
            )
        if self.credential_source == "os_keystore":
            # Python intentionally has no OS-keystore adapter in this release.
            # Never fall back to PEM paths when the unavailable source is asked.
            raise SecurityError(
                "Python OS keystore provider is unavailable; use credential_source='file'.",
                code="os_keystore_unavailable",
            )
        if self.credential_target and self.credential_source == "file":
            raise SecurityError(
                "credential_target requires an OS keystore provider.",
                code="invalid_security_config",
            )

        if self.ocsp_fetch or self.ocsp_responder_url:
            raise SecurityError(
                "Python TLS has no provider-backed OCSP responder fetch.",
                code="ocsp_fetch_unavailable",
                details={"runtime": "python"},
            )
        if self.ocsp_response_path or self.require_ocsp:
            raise SecurityError(
                "Python TLS has no configured OCSP response validation backend.",
                code="ocsp_fetch_unavailable",
                details={"runtime": "python", "reason": "ocsp_validation_unavailable"},
            )

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
        is_loopback = host in ("127.0.0.1", "localhost", "::1")
        if self.profile in (SecurityProfile.LOCAL, SecurityProfile.RESEARCH) and not is_loopback:
            raise ValueError(
                f"Profile '{self.profile.value}' cannot listen on non-loopback interface '{host}'"
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


SECURITY_TRANSCRIPT_FORMAT = "handoffkit.security.transcript"
SECURITY_TRANSCRIPT_FORMAT_VERSION = 1


@dataclass(frozen=True)
class SecurityTranscript:
    """Canonical additive HK-CSP 1.x transcript carried inside authenticated TLS."""

    protocol_version: str
    requested_profile: str
    selected_profile: str
    sender_peer_id: str
    sender_node_id: str
    sender_credential_fingerprint: str
    receiver_peer_id: str
    receiver_node_id: str
    receiver_credential_fingerprint: str
    tls_version: str
    negotiated_group: str | None
    session_id: str
    handshake_nonce: str
    capabilities_hash: str
    timestamp: str
    binding_type: str
    binding_hash: str
    transcript_hash: str = ""
    format: str = SECURITY_TRANSCRIPT_FORMAT
    format_version: int = SECURITY_TRANSCRIPT_FORMAT_VERSION

    def __post_init__(self) -> None:
        if self.format != SECURITY_TRANSCRIPT_FORMAT:
            raise AuthenticationError(
                "Security transcript format is not recognized.",
                code="security_transcript_invalid",
            )
        if self.format_version != SECURITY_TRANSCRIPT_FORMAT_VERSION:
            raise AuthenticationError(
                "Security transcript format version is unavailable.",
                code="security_transcript_version",
            )
        for name in (
            "protocol_version",
            "requested_profile",
            "selected_profile",
            "sender_peer_id",
            "sender_node_id",
            "sender_credential_fingerprint",
            "receiver_peer_id",
            "receiver_node_id",
            "receiver_credential_fingerprint",
            "tls_version",
            "session_id",
            "handshake_nonce",
            "capabilities_hash",
            "timestamp",
            "binding_type",
            "binding_hash",
        ):
            if not getattr(self, name):
                raise AuthenticationError(
                    f"Security transcript field '{name}' is empty.",
                    code="security_transcript_invalid",
                )
        for value in (
            self.sender_credential_fingerprint,
            self.receiver_credential_fingerprint,
            self.capabilities_hash,
            self.binding_hash,
        ):
            if not _is_sha256_fingerprint(value):
                raise AuthenticationError(
                    "Security transcript contains an invalid SHA-256 value.",
                    code="security_transcript_invalid",
                )
        if self.transcript_hash and not _is_sha256_fingerprint(self.transcript_hash):
            raise AuthenticationError(
                "Security transcript hash is invalid.",
                code="security_transcript_invalid",
            )

    @classmethod
    def build(
        cls,
        *,
        protocol_version: str,
        requested_profile: str,
        selected_profile: str,
        sender: PeerIdentity,
        receiver: PeerIdentity,
        tls_version: str,
        negotiated_group: str | None,
        session_id: str,
        handshake_nonce: str,
        timestamp: str,
    ) -> SecurityTranscript:
        capabilities_hash = _sha256_canonical(sorted(sender.capabilities))
        binding_hash = _sha256_canonical(
            {
                "receiver_credential_fingerprint": _normalize_fingerprint(
                    receiver.credential_fingerprint
                ),
                "sender_credential_fingerprint": _normalize_fingerprint(
                    sender.credential_fingerprint
                ),
                "tls_version": tls_version,
            }
        )
        transcript = cls(
            protocol_version=protocol_version,
            requested_profile=requested_profile,
            selected_profile=selected_profile,
            sender_peer_id=sender.peer_id,
            sender_node_id=sender.node_id,
            sender_credential_fingerprint=_normalize_fingerprint(
                sender.credential_fingerprint
            ),
            receiver_peer_id=receiver.peer_id,
            receiver_node_id=receiver.node_id,
            receiver_credential_fingerprint=_normalize_fingerprint(
                receiver.credential_fingerprint
            ),
            tls_version=tls_version,
            negotiated_group=negotiated_group,
            session_id=session_id,
            handshake_nonce=handshake_nonce,
            capabilities_hash=capabilities_hash,
            timestamp=timestamp,
            binding_type="tls-certificate-endpoints",
            binding_hash=binding_hash,
        )
        return cls(**{**transcript.to_dict(), "transcript_hash": transcript.digest()})

    def unsigned_dict(self) -> dict[str, Any]:
        return {
            "binding_hash": self.binding_hash,
            "binding_type": self.binding_type,
            "capabilities_hash": self.capabilities_hash,
            "format": self.format,
            "format_version": self.format_version,
            "handshake_nonce": self.handshake_nonce,
            "negotiated_group": self.negotiated_group,
            "protocol_version": self.protocol_version,
            "receiver_credential_fingerprint": self.receiver_credential_fingerprint,
            "receiver_node_id": self.receiver_node_id,
            "receiver_peer_id": self.receiver_peer_id,
            "requested_profile": self.requested_profile,
            "selected_profile": self.selected_profile,
            "sender_credential_fingerprint": self.sender_credential_fingerprint,
            "sender_node_id": self.sender_node_id,
            "sender_peer_id": self.sender_peer_id,
            "session_id": self.session_id,
            "timestamp": self.timestamp,
            "tls_version": self.tls_version,
        }

    def digest(self) -> str:
        return _sha256_canonical(self.unsigned_dict())

    def to_dict(self) -> dict[str, Any]:
        return {**self.unsigned_dict(), "transcript_hash": self.transcript_hash}

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> SecurityTranscript:
        try:
            transcript = cls(
                protocol_version=str(value["protocol_version"]),
                requested_profile=str(value["requested_profile"]),
                selected_profile=str(value["selected_profile"]),
                sender_peer_id=str(value["sender_peer_id"]),
                sender_node_id=str(value["sender_node_id"]),
                sender_credential_fingerprint=str(value["sender_credential_fingerprint"]),
                receiver_peer_id=str(value["receiver_peer_id"]),
                receiver_node_id=str(value["receiver_node_id"]),
                receiver_credential_fingerprint=str(
                    value["receiver_credential_fingerprint"]
                ),
                tls_version=str(value["tls_version"]),
                negotiated_group=(
                    str(value["negotiated_group"])
                    if value.get("negotiated_group") is not None
                    else None
                ),
                session_id=str(value["session_id"]),
                handshake_nonce=str(value["handshake_nonce"]),
                capabilities_hash=str(value["capabilities_hash"]),
                timestamp=str(value["timestamp"]),
                binding_type=str(value["binding_type"]),
                binding_hash=str(value["binding_hash"]),
                transcript_hash=str(value["transcript_hash"]),
                format=str(value["format"]),
                format_version=int(value["format_version"]),
            )
        except (KeyError, TypeError, ValueError) as error:
            raise AuthenticationError(
                "Security transcript is malformed.",
                code="security_transcript_invalid",
            ) from error
        if not hmac.compare_digest(transcript.transcript_hash, transcript.digest()):
            raise AuthenticationError(
                "Security transcript hash does not match its canonical payload.",
                code="security_transcript_hash_mismatch",
            )
        return transcript


def verify_security_transcript(
    value: Mapping[str, Any],
    *,
    protocol_version: str,
    profile: SecurityProfile,
    sender: PeerIdentity,
    receiver: PeerIdentity,
    tls_version: str,
    negotiated_group: str | None,
    session_id: str,
    handshake_nonce: str,
    timestamp: str,
) -> SecurityTranscript:
    transcript = SecurityTranscript.from_dict(value)
    expected = SecurityTranscript.build(
        protocol_version=protocol_version,
        requested_profile=profile.value,
        selected_profile=profile.value,
        sender=sender,
        receiver=receiver,
        tls_version=tls_version,
        negotiated_group=negotiated_group,
        session_id=session_id,
        handshake_nonce=handshake_nonce,
        timestamp=timestamp,
    )
    if (
        transcript.requested_profile != profile.value
        or transcript.selected_profile != profile.value
    ):
        raise SecurityProfileMismatchError(
            "Security transcript attempted a profile downgrade.",
            details={
                "requested": transcript.requested_profile,
                "selected": transcript.selected_profile,
                "required": profile.value,
            },
        )
    identity_fields = (
        "sender_peer_id",
        "sender_node_id",
        "sender_credential_fingerprint",
        "receiver_peer_id",
        "receiver_node_id",
        "receiver_credential_fingerprint",
    )
    if any(getattr(transcript, name) != getattr(expected, name) for name in identity_fields):
        raise AuthenticationError(
            "Security transcript identities do not match the authenticated TLS endpoints.",
            code="security_transcript_identity_mismatch",
        )
    if transcript.to_dict() != expected.to_dict():
        raise AuthenticationError(
            "Security transcript does not match the authenticated HK-CSP exchange.",
            code="security_transcript_mismatch",
        )
    return transcript


def peer_identity_from_certificate(
    certificate: bytes | str | Path,
    *,
    capabilities: Sequence[str] = (),
) -> PeerIdentity:
    if isinstance(certificate, Path):
        raw = certificate.read_bytes()
    elif isinstance(certificate, str):
        candidate = Path(certificate)
        raw = candidate.read_bytes() if candidate.exists() else certificate.encode("utf-8")
    else:
        raw = certificate
    parsed = (
        x509.load_pem_x509_certificate(raw)
        if raw.lstrip().startswith(b"-----BEGIN CERTIFICATE-----")
        else x509.load_der_x509_certificate(raw)
    )
    try:
        san = parsed.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
    except x509.ExtensionNotFound as error:
        raise AuthenticationError(
            "Certificate has no subject alternative name extension.",
            code="identity_san_missing",
        ) from error
    identity_uris = [
        value
        for value in san.get_values_for_type(x509.UniformResourceIdentifier)
        if urlparse(value).scheme == CERTIFICATE_IDENTITY_SCHEME
    ]
    if len(identity_uris) != 1:
        raise AuthenticationError(
            "Certificate must contain exactly one HK-CSP identity URI SAN.",
            code="identity_san_invalid",
        )
    peer_id, node_id, worker_id, trust_domain = _parse_identity_uri(identity_uris[0])
    return PeerIdentity(
        peer_id=peer_id,
        node_id=node_id,
        worker_id=worker_id,
        trust_domain=trust_domain,
        credential_fingerprint=certificate_fingerprint(raw),
        capabilities=tuple(capabilities),
        issued_at=int(parsed.not_valid_before_utc.timestamp()),
        expires_at=int(parsed.not_valid_after_utc.timestamp()),
    )


def _sha256_canonical(value: Any) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


def _is_sha256_fingerprint(value: str) -> bool:
    prefix, separator, digest = value.partition(":")
    return separator == ":" and prefix == "sha256" and len(digest) == 64 and all(
        character in "0123456789abcdef" for character in digest
    )


class CredentialRotationPolicy:
    """Thread-safe current/previous credential acceptance window."""

    def __init__(
        self,
        current_fingerprint: str,
        *,
        previous_fingerprint: str | None = None,
        transition_until: int = 0,
        max_clock_skew_seconds: int = 10,
    ) -> None:
        if max_clock_skew_seconds < 0:
            raise ValueError("max_clock_skew_seconds must not be negative")
        self._lock = threading.RLock()
        self._current = _normalize_fingerprint(current_fingerprint)
        self._previous = (
            _normalize_fingerprint(previous_fingerprint) if previous_fingerprint else None
        )
        self._transition_until = transition_until
        self.max_clock_skew_seconds = max_clock_skew_seconds

    def rotate(self, new_fingerprint: str, *, transition_until: int) -> None:
        if transition_until < 0:
            raise ValueError("transition_until must not be negative")
        normalized = _normalize_fingerprint(new_fingerprint)
        with self._lock:
            self._previous = self._current
            self._current = normalized
            self._transition_until = transition_until

    def is_allowed(self, fingerprint: str, *, now: int | None = None) -> bool:
        normalized = _normalize_fingerprint(fingerprint)
        timestamp = int(time.time()) if now is None else now
        with self._lock:
            if normalized == self._current:
                return True
            return bool(
                self._previous
                and normalized == self._previous
                and timestamp <= self._transition_until + self.max_clock_skew_seconds
            )

    def set_transition_until(self, transition_until: int) -> None:
        if transition_until < 0:
            raise ValueError("transition_until must not be negative")
        with self._lock:
            self._transition_until = transition_until

    def status(self, *, now: int | None = None) -> dict[str, Any]:
        timestamp = int(time.time()) if now is None else now
        with self._lock:
            return {
                "current_fingerprint": self._current,
                "previous_fingerprint": self._previous,
                "transition_until": self._transition_until,
                "previous_accepted": bool(
                    self._previous
                    and timestamp <= self._transition_until + self.max_clock_skew_seconds
                ),
            }


@dataclass(frozen=True)
class CertificateIdentityPolicy:
    """Local policy used to authorize identity extracted from a verified certificate."""

    trust_domain: str
    capabilities_by_fingerprint: Mapping[str, Sequence[str]] = field(default_factory=dict)
    revoked_fingerprints: frozenset[str] = field(default_factory=frozenset)
    expected_peer_id: str | None = None
    expected_node_id: str | None = None
    expected_worker_id: str | None = None
    allowed_issuer_names: tuple[str, ...] = field(default_factory=tuple)
    require_authorized_fingerprint: bool = True
    revocation_policy: RevocationPolicy | None = None
    rotation_policy: CredentialRotationPolicy | None = None

    def __post_init__(self) -> None:
        if not self.trust_domain:
            raise ValueError("trust_domain must not be empty")
        normalized_grants = {
            _normalize_fingerprint(fingerprint): tuple(capabilities)
            for fingerprint, capabilities in self.capabilities_by_fingerprint.items()
        }
        object.__setattr__(self, "capabilities_by_fingerprint", normalized_grants)
        object.__setattr__(
            self,
            "revoked_fingerprints",
            frozenset(_normalize_fingerprint(value) for value in self.revoked_fingerprints),
        )


def certificate_fingerprint(certificate: bytes | str | Path) -> str:
    """Compute the canonical SHA-256 fingerprint of a PEM or DER certificate."""
    if isinstance(certificate, Path):
        raw = certificate.read_bytes()
    elif isinstance(certificate, str):
        candidate = Path(certificate)
        raw = candidate.read_bytes() if candidate.exists() else certificate.encode("utf-8")
    else:
        raw = certificate
    cert = (
        x509.load_pem_x509_certificate(raw)
        if raw.lstrip().startswith(b"-----BEGIN CERTIFICATE-----")
        else x509.load_der_x509_certificate(raw)
    )
    return f"sha256:{cert.fingerprint(hashes.SHA256()).hex()}"


def authenticate_ssl_peer(
    ssl_object: ssl.SSLObject | ssl.SSLSocket,
    policy: CertificateIdentityPolicy,
) -> PeerIdentity:
    """Derive an authorized peer identity from a completed verified TLS handshake."""
    if ssl_object.version() != "TLSv1.3":
        raise AuthenticationError(
            "Authenticated transport did not negotiate TLS 1.3.",
            code="tls_version_mismatch",
            details={"negotiated_version": ssl_object.version()},
        )
    der = ssl_object.getpeercert(binary_form=True)
    if not der:
        raise AuthenticationError(
            "TLS peer did not present a certificate.",
            code="peer_certificate_missing",
        )
    cert = x509.load_der_x509_certificate(der)
    now = time.time()
    issued_at = int(cert.not_valid_before_utc.astimezone(timezone.utc).timestamp())
    expires_at = int(cert.not_valid_after_utc.astimezone(timezone.utc).timestamp())
    if now < issued_at or now > expires_at:
        raise AuthenticationError(
            "TLS peer certificate is outside its validity period.",
            code="credential_expired",
            details={"issued_at": issued_at, "expires_at": expires_at},
        )

    issuer_name = cert.issuer.rfc4514_string()
    if policy.allowed_issuer_names and issuer_name not in policy.allowed_issuer_names:
        raise AuthenticationError(
            "TLS peer certificate issuer is not allowed by local policy.",
            code="issuer_not_allowed",
            details={"issuer": issuer_name},
        )

    try:
        san = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
    except x509.ExtensionNotFound as exc:
        raise AuthenticationError(
            "TLS peer certificate has no subject alternative name extension.",
            code="identity_san_missing",
        ) from exc
    identity_uris = [
        value
        for value in san.get_values_for_type(x509.UniformResourceIdentifier)
        if urlparse(value).scheme == CERTIFICATE_IDENTITY_SCHEME
    ]
    if len(identity_uris) != 1:
        raise AuthenticationError(
            "TLS peer certificate must contain exactly one HK-CSP identity URI SAN.",
            code="identity_san_invalid",
            details={"identity_uri_count": len(identity_uris)},
        )
    peer_id, node_id, worker_id, trust_domain = _parse_identity_uri(identity_uris[0])
    if trust_domain != policy.trust_domain:
        raise AuthenticationError(
            "TLS peer trust domain does not match local policy.",
            code="trust_domain_mismatch",
            details={"expected": policy.trust_domain, "actual": trust_domain},
        )
    _verify_expected_identity(policy, peer_id, node_id, worker_id)

    fingerprint = certificate_fingerprint(der)
    durable_revocation = policy.revocation_policy
    revoked_kind = next(
        (
            kind
            for kind, value in (
                ("certificate_fingerprint", fingerprint),
                ("peer_id", peer_id),
                ("issuer", issuer_name),
                ("trust_domain", trust_domain),
            )
            if durable_revocation is not None
            and durable_revocation.is_revoked(kind, value, now=int(now))
        ),
        None,
    )
    if fingerprint in policy.revoked_fingerprints or revoked_kind is not None:
        raise AuthenticationError(
            "TLS peer credential is revoked by local policy.",
            code="credential_revoked",
            details={
                "credential_fingerprint": fingerprint,
                "revocation_kind": revoked_kind or "certificate_fingerprint",
            },
        )
    if policy.rotation_policy is not None and not policy.rotation_policy.is_allowed(
        fingerprint, now=int(now)
    ):
        raise AuthenticationError(
            "TLS peer credential is outside the configured rotation window.",
            code="credential_rotation_rejected",
            details={"credential_fingerprint": fingerprint},
        )
    grants = policy.capabilities_by_fingerprint.get(fingerprint)
    if grants is None and policy.require_authorized_fingerprint:
        raise AuthenticationError(
            "TLS peer credential is not authorized by local policy.",
            code="credential_not_authorized",
            details={"credential_fingerprint": fingerprint},
        )

    return PeerIdentity(
        peer_id=peer_id,
        node_id=node_id,
        worker_id=worker_id,
        trust_domain=trust_domain,
        credential_fingerprint=fingerprint,
        capabilities=tuple(grants or ()),
        issued_at=issued_at,
        expires_at=expires_at,
    )


def validate_declared_peer_identity(
    authenticated: PeerIdentity,
    declared: PeerIdentity,
) -> None:
    """Reject any wire identity claim that differs from certificate/local policy data."""
    comparisons = {
        "peer_id": (authenticated.peer_id, declared.peer_id),
        "node_id": (authenticated.node_id, declared.node_id),
        "worker_id": (authenticated.worker_id, declared.worker_id),
        "trust_domain": (authenticated.trust_domain, declared.trust_domain),
        "credential_fingerprint": (
            authenticated.credential_fingerprint,
            _normalize_fingerprint(declared.credential_fingerprint),
        ),
        "capabilities": (authenticated.capabilities, declared.capabilities),
    }
    mismatches = [name for name, (expected, actual) in comparisons.items() if expected != actual]
    if mismatches:
        raise AuthenticationError(
            "Declared peer identity does not match the authenticated certificate identity.",
            code="declared_identity_mismatch",
            details={"fields": mismatches},
        )


def _parse_identity_uri(uri: str) -> tuple[str, str, str | None, str]:
    parsed = urlparse(uri)
    parts = [unquote(value) for value in parsed.path.split("/") if value]
    if parsed.scheme != CERTIFICATE_IDENTITY_SCHEME or len(parts) not in (4, 6):
        raise AuthenticationError(
            "TLS peer identity URI SAN has an invalid format.",
            code="identity_san_invalid",
        )
    if parts[0] != "peer" or parts[2] != "node":
        raise AuthenticationError(
            "TLS peer identity URI SAN has an invalid format.",
            code="identity_san_invalid",
        )
    worker_id = None
    if len(parts) == 6:
        if parts[4] != "worker":
            raise AuthenticationError(
                "TLS peer identity URI SAN has an invalid worker segment.",
                code="identity_san_invalid",
            )
        worker_id = parts[5]
    peer_id, node_id = parts[1], parts[3]
    if not parsed.hostname or not peer_id or not node_id or (len(parts) == 6 and not worker_id):
        raise AuthenticationError(
            "TLS peer identity URI SAN contains an empty identity component.",
            code="identity_san_invalid",
        )
    return peer_id, node_id, worker_id, parsed.hostname


def _verify_expected_identity(
    policy: CertificateIdentityPolicy,
    peer_id: str,
    node_id: str,
    worker_id: str | None,
) -> None:
    expected = {
        "peer_id": policy.expected_peer_id,
        "node_id": policy.expected_node_id,
        "worker_id": policy.expected_worker_id,
    }
    actual = {"peer_id": peer_id, "node_id": node_id, "worker_id": worker_id}
    mismatches = [
        name for name, value in expected.items() if value is not None and actual[name] != value
    ]
    if mismatches:
        raise AuthenticationError(
            "Certificate identity does not match local peer expectations.",
            code="certificate_identity_mismatch",
            details={"fields": mismatches},
        )


def _normalize_fingerprint(value: str) -> str:
    normalized = value.strip().lower().replace(":", "")
    if normalized.startswith("sha256"):
        normalized = normalized[len("sha256") :]
    return f"sha256:{normalized}"


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
        if peer is not None:
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
        self._seen_nonces: dict[tuple[str, str], float] = {}
        self._last_sequences: dict[str, int] = {}

    def check_and_record(
        self,
        session_id: str,
        sequence: int,
        nonce: str | None = None,
        created_at_ts: float | None = None,
        *,
        context: Any | None = None,
    ) -> None:
        del context
        now = time.time()
        if created_at_ts is not None:
            if created_at_ts < (now - self.window_seconds):
                raise ReplayDetectedError(
                    f"Message timestamp is older than replay window ({self.window_seconds}s).",
                    code="replay_timestamp_stale",
                )
            if created_at_ts > (now + self.max_skew_seconds):
                raise ReplayDetectedError(
                    f"Message timestamp in future beyond clock skew ({self.max_skew_seconds}s).",
                    code="replay_timestamp_future",
                )

        if session_id in self._last_sequences:
            last_seq = self._last_sequences[session_id]
            if sequence <= last_seq:
                raise ReplayDetectedError(
                    f"Seq {sequence} not monotonic for session {session_id} (last: {last_seq}).",
                    code="replay_sequence",
                )
        nonce_key = (session_id, nonce) if nonce else None
        if nonce:
            self.prune_old_nonces(now)
            if nonce_key in self._seen_nonces:
                raise ReplayDetectedError(
                    f"Duplicate nonce detected: {nonce}", code="replay_nonce"
                )

        if nonce_key and len(self._seen_nonces) >= self.max_seen_nonces:
            raise SecurityError(
                "Replay nonce capacity is exhausted.",
                code="replay_state_capacity",
                details={"max_seen_nonces": self.max_seen_nonces},
            )

        self._last_sequences[session_id] = sequence
        if nonce_key:
            self._seen_nonces[nonce_key] = now

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

    def close(self) -> None:
        """End the backend lifecycle; stateless implementations may do nothing."""
        return None

    def __enter__(self) -> KeyStore:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()


class FileKeyStore(KeyStore):
    """Development file backend with explicit lifecycle and key-permission checks."""

    def __init__(
        self,
        ca_cert_path: str | Path | None = None,
        cert_path: str | Path | None = None,
        key_path: str | Path | None = None,
    ) -> None:
        self.ca_cert_path = Path(ca_cert_path) if ca_cert_path else None
        self.cert_path = Path(cert_path) if cert_path else None
        self.key_path = Path(key_path) if key_path else None
        self._closed = False

    def _read(self, path: Path | None, *, private: bool = False) -> str | None:
        if self._closed:
            raise SecurityError("KeyStore is closed.", code="keystore_closed")
        if path is None or not path.exists():
            return None
        if path.is_symlink() or not path.is_file():
            raise SecurityError(
                "KeyStore paths must reference regular non-symlink files.",
                code="keystore_path_unsafe",
                details={"path": str(path)},
            )
        if private and os.name == "posix":
            mode = path.stat().st_mode
            if mode & (stat.S_IRWXG | stat.S_IRWXO):
                raise SecurityError(
                    "Private key file grants group or other permissions.",
                    code="insecure_key_permissions",
                    details={"path": str(path), "mode": oct(stat.S_IMODE(mode))},
                )
        return path.read_text(encoding="utf-8")

    def get_ca_certificate(self) -> str | None:
        return self._read(self.ca_cert_path)

    def get_certificate(self) -> str | None:
        return self._read(self.cert_path)

    def get_private_key(self) -> str | None:
        return self._read(self.key_path, private=True)

    def close(self) -> None:
        self._closed = True


def artifact_public_key_fingerprint(public_key: Ed25519PublicKey) -> str:
    """Return the canonical SHA-256 fingerprint of raw Ed25519 public-key bytes."""
    raw = public_key.public_bytes(
        serialization.Encoding.Raw,
        serialization.PublicFormat.Raw,
    )
    return f"sha256:{hashlib.sha256(raw).hexdigest()}"


@dataclass(frozen=True)
class SignedArtifact:
    """Canonical Ed25519 signature envelope for an artifact hash."""

    artifact_id: str
    content_hash: str
    signature: str
    algorithm: str
    signer_identity: str
    key_fingerprint: str
    created_at: int

    def __post_init__(self) -> None:
        if not self.artifact_id or not self.signer_identity:
            raise ValueError("artifact_id and signer_identity must not be empty")
        if self.algorithm != "ed25519":
            raise ArtifactSignatureError(
                f"unsupported artifact signature algorithm: {self.algorithm}",
                code="artifact_algorithm_unsupported",
                details={"algorithm": self.algorithm, "runtime": "python"},
            )
        if len(self.content_hash) != 64:
            raise ValueError("content_hash must be a lowercase SHA-256 hex digest")
        try:
            int(self.content_hash, 16)
        except ValueError as error:
            raise ValueError("content_hash must be a lowercase SHA-256 hex digest") from error
        if self.content_hash != self.content_hash.lower():
            raise ValueError("content_hash must be lowercase")
        normalized = _normalize_fingerprint(self.key_fingerprint)
        if len(normalized) != 71:
            raise ValueError("key_fingerprint must contain a SHA-256 digest")
        try:
            int(normalized.removeprefix("sha256:"), 16)
        except ValueError as error:
            raise ValueError("key_fingerprint must contain a SHA-256 digest") from error
        object.__setattr__(self, "key_fingerprint", normalized)
        if self.created_at < 0:
            raise ValueError("created_at must not be negative")

    def to_dict(self) -> dict[str, Any]:
        return {
            "artifact_id": self.artifact_id,
            "content_hash": self.content_hash,
            "signature": self.signature,
            "algorithm": self.algorithm,
            "signer_identity": self.signer_identity,
            "key_fingerprint": self.key_fingerprint,
            "created_at": self.created_at,
        }

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> SignedArtifact:
        return cls(
            artifact_id=str(value["artifact_id"]),
            content_hash=str(value["content_hash"]),
            signature=str(value["signature"]),
            algorithm=str(value["algorithm"]),
            signer_identity=str(value["signer_identity"]),
            key_fingerprint=str(value["key_fingerprint"]),
            created_at=int(value["created_at"]),
        )

    def canonical_payload(self) -> bytes:
        unsigned = {
            "algorithm": self.algorithm,
            "artifact_id": self.artifact_id,
            "content_hash": self.content_hash,
            "created_at": self.created_at,
            "key_fingerprint": self.key_fingerprint,
            "signer_identity": self.signer_identity,
        }
        return json.dumps(
            unsigned,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")


@dataclass(frozen=True)
class ArtifactSigningCredential:
    """Locally trusted Ed25519 public key and lifecycle policy."""

    signer_identity: str
    public_key_pem: bytes | str
    valid_from: int = 0
    valid_until: int = 0
    revoked: bool = False

    def public_key(self) -> Ed25519PublicKey:
        encoded = (
            self.public_key_pem.encode("utf-8")
            if isinstance(self.public_key_pem, str)
            else self.public_key_pem
        )
        key = serialization.load_pem_public_key(encoded)
        if not isinstance(key, Ed25519PublicKey):
            raise TypeError("artifact signing credential must contain an Ed25519 public key")
        return key

    @property
    def fingerprint(self) -> str:
        return artifact_public_key_fingerprint(self.public_key())


class ArtifactTrustPolicy:
    """Allowlisted signer keys, identities, validity windows, and revocation state."""

    def __init__(
        self,
        credentials: Sequence[ArtifactSigningCredential],
        *,
        allowed_algorithms: Sequence[str] = ("ed25519",),
        max_future_skew_seconds: int = 10,
        revocation_policy: RevocationPolicy | None = None,
    ) -> None:
        self.credentials = {credential.fingerprint: credential for credential in credentials}
        self.allowed_algorithms = frozenset(allowed_algorithms)
        self.max_future_skew_seconds = max_future_skew_seconds
        self.revocation_policy = revocation_policy


class ArtifactSigner:
    """Ed25519 producer for canonical SignedArtifact envelopes."""

    def __init__(self, private_key: Ed25519PrivateKey, signer_identity: str) -> None:
        if not signer_identity:
            raise ValueError("signer_identity must not be empty")
        self.private_key = private_key
        self.signer_identity = signer_identity

    @classmethod
    def from_pem(cls, private_key_pem: bytes | str, signer_identity: str) -> ArtifactSigner:
        encoded = (
            private_key_pem.encode("utf-8") if isinstance(private_key_pem, str) else private_key_pem
        )
        key = serialization.load_pem_private_key(encoded, password=None)
        if not isinstance(key, Ed25519PrivateKey):
            raise TypeError("artifact signer requires an Ed25519 private key")
        return cls(key, signer_identity)

    @property
    def key_fingerprint(self) -> str:
        return artifact_public_key_fingerprint(self.private_key.public_key())

    def sign(
        self,
        artifact_id: str,
        data: bytes | Path,
        *,
        created_at: int | None = None,
    ) -> SignedArtifact:
        artifact = SignedArtifact(
            artifact_id=artifact_id,
            content_hash=ArtifactVerifier.compute_sha256(data),
            signature="",
            algorithm="ed25519",
            signer_identity=self.signer_identity,
            key_fingerprint=self.key_fingerprint,
            created_at=int(time.time()) if created_at is None else created_at,
        )
        signature = base64.b64encode(self.private_key.sign(artifact.canonical_payload())).decode(
            "ascii"
        )
        return SignedArtifact(**{**artifact.to_dict(), "signature": signature})


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

    @staticmethod
    def verify_signed_artifact(
        data: bytes | Path,
        signed_artifact: SignedArtifact | Mapping[str, Any],
        policy: ArtifactTrustPolicy,
        *,
        now: int | None = None,
    ) -> bool:
        artifact = (
            signed_artifact
            if isinstance(signed_artifact, SignedArtifact)
            else SignedArtifact.from_dict(signed_artifact)
        )
        if artifact.algorithm not in policy.allowed_algorithms:
            raise ArtifactSignatureError(
                "Artifact signature algorithm is not allowlisted.",
                code="artifact_algorithm_unsupported",
            )
        if not ArtifactVerifier.verify_integrity(data, artifact.content_hash):
            raise ArtifactSignatureError(
                "Artifact content does not match the signed SHA-256 digest.",
                code="artifact_integrity_mismatch",
            )
        credential = policy.credentials.get(artifact.key_fingerprint)
        if credential is None:
            raise ArtifactSignatureError(
                "Artifact signer key is not trusted.",
                code="artifact_signer_untrusted",
            )
        if artifact.signer_identity != credential.signer_identity:
            raise ArtifactSignatureError(
                "Artifact signer identity does not match local key policy.",
                code="artifact_signer_mismatch",
            )
        timestamp = int(time.time()) if now is None else now
        signer_revoked = policy.revocation_policy is not None and any(
            (
                policy.revocation_policy.is_revoked(
                    "signer_fingerprint", artifact.key_fingerprint, now=timestamp
                ),
                policy.revocation_policy.is_revoked(
                    "peer_id", artifact.signer_identity, now=timestamp
                ),
            )
        )
        if credential.revoked or signer_revoked:
            raise ArtifactSignatureError(
                "Artifact signer key is revoked.",
                code="artifact_signer_revoked",
            )
        if credential.valid_from and timestamp < credential.valid_from:
            raise ArtifactSignatureError(
                "Artifact signer credential is not yet valid.",
                code="artifact_signer_expired",
            )
        if credential.valid_until and timestamp > credential.valid_until:
            raise ArtifactSignatureError(
                "Artifact signer credential is expired.",
                code="artifact_signer_expired",
            )
        if artifact.created_at > timestamp + policy.max_future_skew_seconds:
            raise ArtifactSignatureError(
                "Artifact signature timestamp is too far in the future.",
                code="artifact_timestamp_invalid",
            )
        if credential.valid_from and artifact.created_at < credential.valid_from:
            raise ArtifactSignatureError(
                "Artifact was signed before the credential validity window.",
                code="artifact_timestamp_invalid",
            )
        if credential.valid_until and artifact.created_at > credential.valid_until:
            raise ArtifactSignatureError(
                "Artifact was signed after the credential validity window.",
                code="artifact_timestamp_invalid",
            )
        try:
            signature = base64.b64decode(artifact.signature, validate=True)
            credential.public_key().verify(signature, artifact.canonical_payload())
        except (InvalidSignature, ValueError) as error:
            raise ArtifactSignatureError(
                "Artifact signature verification failed.",
                code="artifact_signature_invalid",
            ) from error
        return True


def build_ssl_context(
    config: SecurityConfig,
    is_server: bool = False,
) -> ssl.SSLContext | None:
    """Build a hardened TLS 1.3 SSLContext based on SecurityConfig."""
    if config.profile == SecurityProfile.LOCAL:
        return None

    if config.profile == SecurityProfile.RESEARCH:
        raise SecurityProfileUnavailableError(
            "The research profile cannot be used by a network transport.",
            details={"profile": config.profile.value},
        )

    if not _tls13_supported():
        raise SecurityProfileUnavailableError(
            "TLS 1.3 is unavailable in the active Python SSL provider.",
            details={"profile": config.profile.value, "provider": ssl.OPENSSL_VERSION},
        )

    if config.profile == SecurityProfile.HYBRID_PQ:
        raise SecurityProfileUnavailableError(
            "The Python TLS integration cannot prove negotiation of required hybrid "
            f"group {HYBRID_PQ_GROUP}.",
            details={
                "profile": SecurityProfile.HYBRID_PQ.value,
                "provider": ssl.OPENSSL_VERSION,
                "required_group": HYBRID_PQ_GROUP,
                "reason": "negotiated_group_unobservable",
            },
        )

    if is_server:
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    else:
        # create_default_context loads platform trust anchors. A configured CA below
        # augments that store rather than silently disabling system roots.
        context = ssl.create_default_context(ssl.Purpose.SERVER_AUTH)
    context.minimum_version = ssl.TLSVersion.TLSv1_3
    context.maximum_version = ssl.TLSVersion.TLSv1_3

    if config.ca_cert_path:
        context.load_verify_locations(cafile=config.ca_cert_path)

    if bool(config.cert_path) != bool(config.key_path):
        raise ValueError("cert_path and key_path must be configured together.")

    if is_server and not (config.cert_path and config.key_path):
        raise ValueError("TLS server requires cert_path and key_path.")

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


class ReloadableTLSContext:
    """Atomically swaps validated TLS credentials and trust for new connections."""

    def __init__(self, config: SecurityConfig, *, is_server: bool) -> None:
        self._lock = threading.RLock()
        self.is_server = is_server
        self._profile = config.profile
        self._trust_domain = config.trust_domain
        context = build_ssl_context(config, is_server=is_server)
        if context is None:
            raise SecurityError(
                "Reloadable TLS context requires a secure profile.",
                code="tls_profile_required",
            )
        self._current_context = context
        self._generation = 1
        self._current_fingerprint = self._credential_fingerprint(config)
        self._previous_fingerprint: str | None = None
        self._transition_until = 0
        self._trust_anchor_hash = self._file_hash(config.ca_cert_path)
        self._previous_trust_anchor_hash: str | None = None
        self._certificate_expires_at = self._certificate_expiry(config)
        self._current_certificate_identity = (
            peer_identity_from_certificate(config.cert_path) if config.cert_path else None
        )
        self._identities_by_context: weakref.WeakKeyDictionary[
            ssl.SSLContext, PeerIdentity
        ] = weakref.WeakKeyDictionary()
        if self._current_certificate_identity is not None:
            self._identities_by_context[context] = self._current_certificate_identity
        self._router_context: ssl.SSLContext | None = None
        if is_server:
            # The context attached to the listener must itself request client
            # certificates. OpenSSL decides whether to emit CertificateRequest
            # before all attributes of a context selected by the SNI callback
            # are applied. Reuse the fully validated initial context as the
            # router, then select the current immutable context for every new
            # handshake. Existing sessions retain the context they negotiated.
            router = context
            router.set_servername_callback(self._route_server_context)
            self._router_context = router

    def context(self, *, is_server: bool) -> ssl.SSLContext:
        if is_server != self.is_server:
            raise SecurityError(
                "TLS reload provider role does not match transport role.",
                code="tls_reload_role_mismatch",
            )
        with self._lock:
            if is_server:
                assert self._router_context is not None
                return self._router_context
            return self._current_context

    def reload(
        self,
        config: SecurityConfig,
        *,
        transition_seconds: int = 300,
        now: int | None = None,
    ) -> dict[str, Any]:
        if transition_seconds < 0:
            raise ValueError("transition_seconds must not be negative")
        if config.profile != self._profile or config.trust_domain != self._trust_domain:
            raise SecurityError(
                "TLS reload cannot change security profile or trust domain.",
                code="tls_reload_policy_mismatch",
            )
        # Build and validate everything before acquiring the swap lock. A bad
        # certificate, key, or trust bundle leaves the active context untouched.
        candidate = build_ssl_context(config, is_server=self.is_server)
        if candidate is None:
            raise SecurityError(
                "TLS reload requires a secure profile.",
                code="tls_profile_required",
            )
        fingerprint = self._credential_fingerprint(config)
        trust_hash = self._file_hash(config.ca_cert_path)
        expiry = self._certificate_expiry(config)
        identity = peer_identity_from_certificate(config.cert_path) if config.cert_path else None
        timestamp = int(time.time()) if now is None else now
        with self._lock:
            self._previous_fingerprint = self._current_fingerprint
            self._previous_trust_anchor_hash = self._trust_anchor_hash
            self._current_context = candidate
            self._current_fingerprint = fingerprint
            self._trust_anchor_hash = trust_hash
            self._certificate_expires_at = expiry
            self._current_certificate_identity = identity
            if identity is not None:
                self._identities_by_context[candidate] = identity
            self._transition_until = timestamp + transition_seconds
            self._generation += 1
            return self.status(now=timestamp)

    def local_identity(
        self,
        *,
        context: ssl.SSLContext | None = None,
        capabilities: Sequence[str] = (),
    ) -> PeerIdentity | None:
        with self._lock:
            identity = (
                self._identities_by_context.get(context)
                if context is not None
                else self._current_certificate_identity
            )
            if identity is None:
                return None
            return dataclass_replace(
                identity,
                capabilities=tuple(capabilities),
            )

    def status(self, *, now: int | None = None) -> dict[str, Any]:
        timestamp = int(time.time()) if now is None else now
        with self._lock:
            return {
                "generation": self._generation,
                "role": "server" if self.is_server else "client",
                "security_profile": self._profile.value,
                "current_fingerprint": self._current_fingerprint,
                "previous_fingerprint": self._previous_fingerprint,
                "transition_until": self._transition_until,
                "previous_accepted": bool(
                    self._previous_fingerprint and timestamp <= self._transition_until
                ),
                "trust_anchor_hash": self._trust_anchor_hash,
                "previous_trust_anchor_hash": self._previous_trust_anchor_hash,
                "certificate_expires_at": self._certificate_expires_at,
                "provider": ssl.OPENSSL_VERSION,
            }

    def _route_server_context(
        self,
        ssl_object: ssl.SSLObject | ssl.SSLSocket,
        server_name: str | None,
        _initial_context: ssl.SSLContext,
    ) -> None:
        if not server_name:
            raise ssl.SSLError("reloadable TLS server requires SNI")
        with self._lock:
            ssl_object.context = self._current_context

    @staticmethod
    def _credential_fingerprint(config: SecurityConfig) -> str | None:
        return certificate_fingerprint(Path(config.cert_path)) if config.cert_path else None

    @staticmethod
    def _certificate_expiry(config: SecurityConfig) -> int:
        if not config.cert_path:
            return 0
        certificate = x509.load_pem_x509_certificate(Path(config.cert_path).read_bytes())
        return int(certificate.not_valid_after_utc.timestamp())

    @staticmethod
    def _file_hash(path: str | None) -> str | None:
        if not path:
            return None
        return f"sha256:{hashlib.sha256(Path(path).read_bytes()).hexdigest()}"


def _tls13_supported() -> bool:
    return bool(
        getattr(ssl, "HAS_TLSv1_3", False)
        and hasattr(ssl, "TLSVersion")
        and hasattr(ssl.TLSVersion, "TLSv1_3")
    )


def detect_hybrid_pq_support() -> bool:
    """Return false until Python can verify the group negotiated on a real socket."""
    return False


def get_supported_crypto_capabilities() -> dict[str, Any]:
    """Return runtime supported cryptographic capabilities."""
    has_tls13 = _tls13_supported()
    has_hybrid_pq = detect_hybrid_pq_support()
    profiles = [SecurityProfile.LOCAL.value]
    if has_tls13:
        profiles.append(SecurityProfile.STANDARD.value)
    if has_hybrid_pq:
        profiles.append(SecurityProfile.HYBRID_PQ.value)
    return {
        "tls13_supported": has_tls13,
        "provider": ssl.OPENSSL_VERSION,
        "profiles_supported": profiles,
        "profiles_recognized": [profile.value for profile in SecurityProfile],
        "digest_algorithms": ["sha256"],
        "signature_algorithms": ["ed25519"],
        "hybrid_pq_group": HYBRID_PQ_GROUP if has_hybrid_pq else None,
        "hybrid_pq_supported": has_hybrid_pq,
    }
