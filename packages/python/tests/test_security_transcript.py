from __future__ import annotations

import json
from pathlib import Path

import pytest

from handoffkit.csp import (
    AuthenticationError,
    PeerIdentity,
    SecurityProfile,
    SecurityProfileMismatchError,
    SecurityTranscript,
    verify_security_transcript,
)

FIXTURE = (
    Path(__file__).resolve().parents[2]
    / "contracts"
    / "test-fixtures"
    / "security"
    / "security-transcript-v1.json"
)


def fixture_values() -> tuple[PeerIdentity, PeerIdentity, dict[str, object]]:
    value = json.loads(FIXTURE.read_text(encoding="utf-8"))
    return (
        PeerIdentity.from_dict(value["sender"]),
        PeerIdentity.from_dict(value["receiver"]),
        value["transcript"],
    )


def test_python_security_transcript_matches_shared_canonical_fixture() -> None:
    sender, receiver, expected = fixture_values()
    transcript = SecurityTranscript.build(
        protocol_version="1.0",
        requested_profile="standard",
        selected_profile="standard",
        sender=sender,
        receiver=receiver,
        tls_version="TLSv1.3",
        negotiated_group=None,
        session_id="session-transcript-1",
        handshake_nonce="nonce-transcript-1",
        timestamp="2026-01-01T00:00:00Z",
    )
    assert transcript.to_dict() == expected
    assert SecurityTranscript.from_dict(expected) == transcript


def test_python_security_transcript_rejects_hash_tamper_downgrade_and_identity() -> None:
    sender, receiver, expected = fixture_values()
    hash_tamper = {**expected, "timestamp": "2026-01-01T00:00:01Z"}
    with pytest.raises(AuthenticationError) as hash_error:
        SecurityTranscript.from_dict(hash_tamper)
    assert hash_error.value.code == "security_transcript_hash_mismatch"

    downgrade = {**expected, "selected_profile": "local", "transcript_hash": ""}
    downgrade_transcript = SecurityTranscript(**downgrade)
    downgrade["transcript_hash"] = downgrade_transcript.digest()
    with pytest.raises(SecurityProfileMismatchError):
        verify_security_transcript(
            downgrade,
            protocol_version="1.0",
            profile=SecurityProfile.STANDARD,
            sender=sender,
            receiver=receiver,
            tls_version="TLSv1.3",
            negotiated_group=None,
            session_id="session-transcript-1",
            handshake_nonce="nonce-transcript-1",
            timestamp="2026-01-01T00:00:00Z",
        )

    wrong_identity = {**expected, "receiver_peer_id": "other-peer", "transcript_hash": ""}
    identity_transcript = SecurityTranscript(**wrong_identity)
    wrong_identity["transcript_hash"] = identity_transcript.digest()
    with pytest.raises(AuthenticationError) as identity_error:
        verify_security_transcript(
            wrong_identity,
            protocol_version="1.0",
            profile=SecurityProfile.STANDARD,
            sender=sender,
            receiver=receiver,
            tls_version="TLSv1.3",
            negotiated_group=None,
            session_id="session-transcript-1",
            handshake_nonce="nonce-transcript-1",
            timestamp="2026-01-01T00:00:00Z",
        )
    assert identity_error.value.code == "security_transcript_identity_mismatch"
