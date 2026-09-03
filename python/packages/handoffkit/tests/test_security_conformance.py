from __future__ import annotations

import json
import time
from pathlib import Path

import pytest

from handoffkit.csp import (
    AuthorizationError,
    CapabilityPolicy,
    PeerIdentity,
    ReplayProtection,
    SecurityConfig,
    SecurityError,
    SignedArtifact,
    negotiate_security_profile,
)

CONTRACTS = Path(__file__).resolve().parents[4] / "shared" / "contracts"
VECTORS = json.loads(
    (CONTRACTS / "conformance/security-v1.json").read_text(encoding="utf-8")
)


def test_security_wire_conformance() -> None:
    config = json.loads((CONTRACTS / "fixtures/security_config.json").read_text("utf-8"))
    parsed_config = SecurityConfig(**config)
    assert {
        "profile": parsed_config.profile.value,
        "require_mtls": parsed_config.require_mtls,
        "allow_insecure_loopback": parsed_config.allow_insecure_loopback,
        "trust_domain": parsed_config.trust_domain,
        "replay_window_seconds": parsed_config.replay_window_seconds,
        "max_clock_skew_seconds": parsed_config.max_clock_skew_seconds,
    } == config

    peer = json.loads((CONTRACTS / "fixtures/peer_identity.json").read_text("utf-8"))
    assert PeerIdentity.from_dict(peer).to_dict() == peer
    artifact = json.loads((CONTRACTS / "fixtures/signed_artifact.json").read_text("utf-8"))
    signed = SignedArtifact.from_dict(artifact)
    assert signed.to_dict() == artifact
    assert signed.canonical_payload().decode() == VECTORS["signed_artifact"]["canonical_payload"]


def test_finalization_unavailable_fixture_is_fail_closed() -> None:
    fixture = json.loads(
        (CONTRACTS / "test-fixtures/security/finalization-unavailable-v1.json").read_text(
            encoding="utf-8"
        )
    )
    expected = {
        "ocsp_fetch": "ocsp_fetch_unavailable",
        "exactly_once": "exactly_once_unavailable",
        "zeroization_global": None,
        "ml_dsa": "artifact_algorithm_unsupported",
        "ecdsa": "artifact_algorithm_unsupported",
        "slh_dsa": "artifact_algorithm_unsupported",
        "hybrid_pq": "security_profile_unavailable",
    }
    assert fixture["format"] == "handoffkit.security.unavailable"
    assert fixture["format_version"] == 1
    assert fixture["generation"] == 1
    assert {item["name"] for item in fixture["capabilities"]} == set(expected)
    for item in fixture["capabilities"]:
        assert item["status"] == "unavailable"
        assert item["fail_closed"] is True
        assert item.get("error_code") == expected[item["name"]]
        assert item["participants"] == ["python", "javascript", "go", "rust", "cpp"]
        if item["name"] == "ecdsa":
            assert item["available_in"] == ["python", "cpp"]
            assert item["unavailable_in"] == ["javascript", "go", "rust"]


@pytest.mark.parametrize("case", VECTORS["profile_negotiation"], ids=lambda case: case["id"])
def test_profile_negotiation_conformance(case: dict[str, object]) -> None:
    if "error_code" in case:
        with pytest.raises(SecurityError) as raised:
            negotiate_security_profile(case["required"], case["offered"], case["supported"])
        assert raised.value.code == case["error_code"]
    else:
        selected = negotiate_security_profile(case["required"], case["offered"], case["supported"])
        assert selected.value == case["selected"]


@pytest.mark.parametrize("case", VECTORS["authorization"], ids=lambda case: case["id"])
def test_authorization_conformance(case: dict[str, object]) -> None:
    peer = PeerIdentity(
        peer_id="peer",
        node_id="node",
        capabilities=tuple(case["peer_capabilities"]),
    )
    policy = CapabilityPolicy(allowed_operations=case["allowed_operations"])
    assert policy.is_operation_authorized(str(case["operation"]), peer) is case["authorized"]
    if not case["authorized"] and str(case["operation"]).startswith("job:"):
        with pytest.raises(AuthorizationError) as raised:
            policy.authorize_job(str(case["operation"])[4:], peer)
        assert raised.value.code == "authorization_denied"


@pytest.mark.parametrize("case", VECTORS["replay"], ids=lambda case: case["id"])
def test_replay_conformance(case: dict[str, object]) -> None:
    replay = ReplayProtection(window_seconds=30, max_skew_seconds=3)
    now = time.time()
    for operation in case["operations"]:
        scope = f"{operation['peer']}\0{operation['session']}"
        timestamp = now + int(operation["timestamp_offset"])
        if "error_code" in operation:
            with pytest.raises(SecurityError) as raised:
                replay.check_and_record(
                    scope,
                    int(operation["sequence"]),
                    str(operation["nonce"]),
                    timestamp,
                )
            assert raised.value.code == operation["error_code"]
        else:
            replay.check_and_record(
                scope,
                int(operation["sequence"]),
                str(operation["nonce"]),
                timestamp,
            )
