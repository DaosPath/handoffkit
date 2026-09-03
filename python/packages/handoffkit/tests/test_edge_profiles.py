from __future__ import annotations

import json
from pathlib import Path

import pytest

from handoffkit.csp import (
    CapabilityPolicy,
    CertificateIdentityPolicy,
    EdgeProfile,
    EdgeRuntimeProfile,
    NetworkConfig,
    SecurityConfig,
    SecurityError,
    SecurityProfile,
    SessionConfig,
)

FIXTURE = (
    Path(__file__).resolve().parents[2]
    / "contracts"
    / "test-fixtures"
    / "security"
    / "edge-runtime-profiles-v1.json"
)


@pytest.mark.monorepo
def test_edge_profiles_match_shared_fixture_and_drive_sessions() -> None:
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert fixture["format"] == "handoffkit.edge-profiles"
    assert fixture["format_version"] == 1

    for expected in fixture["profiles"]:
        profile = EdgeRuntimeProfile.for_profile(expected["name"])
        assert profile.to_dict() == expected
        assert EdgeRuntimeProfile.from_dict(expected) == profile

        session = SessionConfig.for_profile("edge-session", profile.name)
        assert session.channel_capacity == profile.channel_capacity
        assert session.max_message_bytes == profile.max_frame_bytes
        assert session.ack_timeout_ms == profile.ack_timeout_ms
        assert session.dedup_capacity == profile.dedup_capacity
        assert session.retry_policy == profile.reconnect
        assert session.metadata["edge_profile"] == profile.name.value


def test_edge_profile_drives_real_network_limits_and_fails_closed() -> None:
    security = SecurityConfig(
        profile=SecurityProfile.STANDARD,
        require_mtls=True,
        trust_domain="edge.example",
    )
    identity = CertificateIdentityPolicy(
        trust_domain="edge.example",
        require_authorized_fingerprint=False,
    )
    capabilities = CapabilityPolicy(allowed_operations=("job:training",))
    edge = EdgeRuntimeProfile.for_profile(EdgeProfile.EDGE_SMALL)

    network = NetworkConfig.for_profile(
        edge,
        security_config=security,
        identity_policy=identity,
        capability_policy=capabilities,
    )
    assert network.max_message_bytes == edge.max_frame_bytes
    assert network.connect_timeout_ms == edge.connect_timeout_ms
    assert network.io_timeout_ms == edge.io_timeout_ms
    assert network.retry_policy == edge.reconnect

    with pytest.raises(SecurityError) as rejected:
        NetworkConfig.for_profile(
            edge,
            security_config=SecurityConfig(
                profile=SecurityProfile.LOCAL,
                allow_insecure_loopback=True,
                trust_domain="edge.example",
            ),
            identity_policy=identity,
            capability_policy=capabilities,
        )
    assert rejected.value.code == "edge_security_profile_mismatch"


def test_edge_profile_label_cannot_be_spoofed() -> None:
    with pytest.raises(ValueError, match="does not match"):
        SessionConfig.for_profile(
            "edge-session",
            EdgeProfile.EDGE_SMALL,
            metadata={"edge_profile": "server"},
        )
