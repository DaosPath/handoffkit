"""Durable replay persistence and corruption handling."""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

import pytest

from handoffkit.csp import DurableReplayProtection, ReplayContext
from handoffkit.csp.security import ReplayDetectedError, SecurityError

CONTRACTS = Path(__file__).resolve().parents[4] / "shared" / "contracts"


def context(
    *,
    peer: str = "peer-a",
    session: str = "session-a",
    fingerprint: str = "sha256:" + "a" * 64,
) -> ReplayContext:
    return ReplayContext(
        peer_id=peer,
        session_id=session,
        credential_fingerprint=fingerprint,
        security_profile="standard",
    )


def record(
    protection: DurableReplayProtection,
    scope: str,
    sequence: int,
    nonce: str,
    replay_context: ReplayContext,
) -> None:
    protection.check_and_record(
        scope,
        sequence,
        nonce,
        time.time(),
        context=replay_context,
    )


def test_durable_replay_rejects_nonce_and_sequence_after_restart(tmp_path):
    path = tmp_path / "replay.json"
    scope = f"{context().credential_fingerprint}|session-a"
    first = DurableReplayProtection(path)
    record(first, scope, 1, "nonce-1", context())

    restored = DurableReplayProtection(path)
    with pytest.raises(ReplayDetectedError) as nonce_replay:
        record(restored, scope, 2, "nonce-1", context())
    assert nonce_replay.value.code == "replay_nonce"
    with pytest.raises(ReplayDetectedError) as sequence_replay:
        record(restored, scope, 1, "nonce-2", context())
    assert sequence_replay.value.code == "replay_sequence"

    record(restored, scope, 2, "nonce-2", context())
    assert restored.generation == 2


def test_python_loads_shared_durable_replay_fixture(tmp_path):
    fixture = CONTRACTS / "test-fixtures/security/durable-replay-v1.json"
    path = tmp_path / "shared-replay.json"
    path.write_bytes(fixture.read_bytes())
    if os.name == "posix":
        path.chmod(0o600)

    restored = DurableReplayProtection(path)
    assert restored.status() == {
        "format": "handoffkit.security.replay",
        "format_version": 1,
        "generation": 7,
        "scopes": 1,
        "nonces": 2,
    }
    scope = f"sha256:{'a' * 64}|session-a"
    with pytest.raises(ReplayDetectedError) as replay:
        restored.check_and_record(scope, 42, None, None, context=context())
    assert replay.value.code == "replay_sequence"


def test_durable_replay_scopes_peer_session_and_rotated_credential(tmp_path):
    path = tmp_path / "replay.json"
    protection = DurableReplayProtection(path)
    first = context()
    other_peer = context(peer="peer-b")
    other_session = context(session="session-b")
    rotated = context(fingerprint="sha256:" + "b" * 64)

    record(protection, f"{first.credential_fingerprint}|session-a", 1, "same", first)
    record(protection, f"{first.credential_fingerprint}|session-b", 1, "same", other_session)
    record(protection, f"{other_peer.credential_fingerprint}|peer-b-session", 1, "same", other_peer)
    record(protection, f"{rotated.credential_fingerprint}|session-a", 1, "same", rotated)
    assert protection.status()["scopes"] == 4


@pytest.mark.parametrize("mutation", ["truncated", "checksum"])
def test_durable_replay_quarantines_corrupt_state(tmp_path, mutation):
    path = tmp_path / "replay.json"
    protection = DurableReplayProtection(path)
    replay_context = context()
    record(
        protection,
        f"{replay_context.credential_fingerprint}|session-a",
        1,
        "nonce-1",
        replay_context,
    )
    if mutation == "truncated":
        path.write_text("{", encoding="utf-8")
    else:
        value = json.loads(path.read_text(encoding="utf-8"))
        value["checksum"] = "sha256:" + "0" * 64
        path.write_text(json.dumps(value), encoding="utf-8")

    with pytest.raises(SecurityError) as caught:
        DurableReplayProtection(path)
    assert caught.value.code == "security_state_corrupt"
    assert not path.exists()
    assert len(list(tmp_path.glob("replay.json.corrupt-*"))) == 1


def test_durable_replay_ignores_orphaned_pre_replace_temp_file(tmp_path):
    path = tmp_path / "replay.json"
    replay_context = context()
    protection = DurableReplayProtection(path)
    scope = f"{replay_context.credential_fingerprint}|session-a"
    record(protection, scope, 1, "nonce-1", replay_context)
    (tmp_path / ".replay.json.tmp-crash").write_text("{", encoding="utf-8")

    restored = DurableReplayProtection(path)
    with pytest.raises(ReplayDetectedError):
        record(restored, scope, 1, "nonce-2", replay_context)


def test_durable_replay_write_failure_does_not_advance_memory(tmp_path, monkeypatch):
    path = tmp_path / "replay.json"
    replay_context = context()
    scope = f"{replay_context.credential_fingerprint}|session-a"
    protection = DurableReplayProtection(path)
    record(protection, scope, 1, "nonce-1", replay_context)
    real_replace = os.replace

    def fail_replace(source, target):
        if os.fspath(target) == os.fspath(path):
            raise OSError("simulated full disk")
        return real_replace(source, target)

    monkeypatch.setattr(os, "replace", fail_replace)
    with pytest.raises(SecurityError) as caught:
        record(protection, scope, 2, "nonce-2", replay_context)
    assert caught.value.code == "security_state_write_failed"

    monkeypatch.setattr(os, "replace", real_replace)
    record(protection, scope, 2, "nonce-2", replay_context)


def test_durable_replay_capacity_fails_closed_without_forgetting_state(tmp_path):
    path = tmp_path / "replay.json"
    protection = DurableReplayProtection(path, max_scopes=1, max_seen_nonces=1)
    replay_context = context()
    scope = f"{replay_context.credential_fingerprint}|session-a"
    record(protection, scope, 1, "nonce-1", replay_context)

    with pytest.raises(SecurityError) as nonce_capacity:
        record(protection, scope, 2, "nonce-2", replay_context)
    assert nonce_capacity.value.code == "replay_state_capacity"

    another = context(peer="peer-b", session="session-b")
    with pytest.raises(SecurityError) as scope_capacity:
        record(protection, "other-scope", 1, "other", another)
    assert scope_capacity.value.code == "replay_state_capacity"

    restored = DurableReplayProtection(path, max_scopes=1, max_seen_nonces=1)
    with pytest.raises(ReplayDetectedError):
        record(restored, scope, 1, "nonce-new", replay_context)


def test_durable_replay_compaction_expires_old_scope(tmp_path):
    path = tmp_path / "replay.json"
    protection = DurableReplayProtection(
        path,
        window_seconds=1,
        state_ttl_seconds=2,
    )
    replay_context = context()
    scope = f"{replay_context.credential_fingerprint}|session-a"
    before = time.time()
    record(protection, scope, 1, "nonce-1", replay_context)
    protection.compact(now=before + 3)
    assert protection.status()["scopes"] == 0
    assert protection.status()["nonces"] == 0

    restored = DurableReplayProtection(
        path,
        window_seconds=1,
        state_ttl_seconds=2,
    )
    assert restored.status()["scopes"] == 0


def test_durable_replay_state_contains_bounded_authenticated_context(tmp_path):
    path = tmp_path / "replay.json"
    replay_context = context()
    protection = DurableReplayProtection(path)
    scope = f"{replay_context.credential_fingerprint}|session-a"
    record(protection, scope, 7, "nonce-7", replay_context)

    state = json.loads(path.read_text(encoding="utf-8"))
    assert state["format"] == "handoffkit.security.replay"
    assert state["format_version"] == 1
    assert state["generation"] == 1
    assert state["checksum"].startswith("sha256:")
    assert state["records"] == [
        {
            "credential_fingerprint": replay_context.credential_fingerprint,
            "expires_at": state["records"][0]["expires_at"],
            "last_sequence": 7,
            "nonces": [
                {
                    "seen_at": state["records"][0]["nonces"][0]["seen_at"],
                    "value": "nonce-7",
                }
            ],
            "peer_id": "peer-a",
            "scope": scope,
            "security_profile": "standard",
            "session_id": "session-a",
            "updated_at": state["records"][0]["updated_at"],
        }
    ]


def test_durable_replay_requires_context_for_new_scope(tmp_path):
    protection = DurableReplayProtection(tmp_path / "replay.json")
    with pytest.raises(SecurityError) as caught:
        protection.check_and_record("scope", 1, "nonce", time.time())
    assert caught.value.code == "replay_context_missing"
