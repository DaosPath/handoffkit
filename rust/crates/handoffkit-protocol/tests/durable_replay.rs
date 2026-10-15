use handoffkit_protocol::security::{
    DurableReplayOptions, ReplayContext, ReplayProtection, DURABLE_REPLAY_FORMAT,
    DURABLE_REPLAY_FORMAT_VERSION,
};
use serde_json::Value;
use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

fn options() -> DurableReplayOptions {
    DurableReplayOptions {
        window_seconds: 30,
        max_clock_skew_seconds: 3,
        max_seen_nonces: 32,
        max_scopes: 8,
        state_ttl_seconds: 60,
        max_file_bytes: 64 * 1024,
    }
}

fn context(peer: &str, session: &str, fingerprint: &str) -> ReplayContext {
    ReplayContext {
        peer_id: peer.to_string(),
        session_id: session.to_string(),
        credential_fingerprint: fingerprint.to_string(),
        security_profile: "standard".to_string(),
    }
}

#[test]
fn restart_preserves_sequence_nonce_and_authenticated_scope() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("replay.json");
    let timestamp = now();
    let first_context = context("peer-a", "session-a", "sha256:aa");
    let mut first = ReplayProtection::new_durable(&path, options()).unwrap();
    first
        .check_and_record_context(
            "sha256:aa|session-a",
            1,
            Some("nonce-a"),
            Some(timestamp),
            Some(&first_context),
        )
        .unwrap();
    let status = first.durable_status().unwrap();
    assert_eq!(status.format, DURABLE_REPLAY_FORMAT);
    assert_eq!(status.format_version, DURABLE_REPLAY_FORMAT_VERSION);
    assert_eq!(status.scopes, 1);
    drop(first);

    let mut restarted = ReplayProtection::new_durable(&path, options()).unwrap();
    assert_eq!(
        restarted
            .check_and_record_context(
                "sha256:aa|session-a",
                1,
                Some("nonce-a"),
                Some(timestamp),
                Some(&first_context),
            )
            .unwrap_err()
            .code,
        "replay_sequence"
    );
    assert_eq!(
        restarted
            .check_and_record_context(
                "sha256:aa|session-a",
                2,
                Some("nonce-a"),
                Some(timestamp),
                Some(&first_context),
            )
            .unwrap_err()
            .code,
        "replay_nonce"
    );
    for (scope, scoped_context) in [
        (
            "sha256:aa|session-b",
            context("peer-a", "session-b", "sha256:aa"),
        ),
        (
            "sha256:bb|session-a",
            context("peer-a", "session-a", "sha256:bb"),
        ),
        (
            "sha256:cc|session-a",
            context("peer-b", "session-a", "sha256:cc"),
        ),
    ] {
        restarted
            .check_and_record_context(
                scope,
                1,
                Some("nonce-a"),
                Some(timestamp),
                Some(&scoped_context),
            )
            .unwrap();
    }
}

#[test]
fn rust_loads_shared_durable_replay_fixture() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("shared-replay.json");
    fs::write(
        &path,
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../shared/contracts/test-fixtures/security/durable-replay-v1.json"
        )),
    )
    .unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
    }
    let mut restored = ReplayProtection::new_durable(&path, options()).unwrap();
    assert_eq!(
        restored.durable_status().unwrap(),
        handoffkit_protocol::security::DurableReplayStatus {
            format: DURABLE_REPLAY_FORMAT,
            format_version: DURABLE_REPLAY_FORMAT_VERSION,
            generation: 7,
            scopes: 1,
            nonces: 2,
        }
    );
    let replay_context = context("peer-a", "session-a", &format!("sha256:{}", "a".repeat(64)));
    assert_eq!(
        restored
            .check_and_record_context(
                &format!("sha256:{}|session-a", "a".repeat(64)),
                42,
                None,
                None,
                Some(&replay_context),
            )
            .unwrap_err()
            .code,
        "replay_sequence"
    );
}

#[test]
fn truncated_and_bad_checksum_state_are_quarantined() {
    for mutation in ["truncated", "checksum"] {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("replay.json");
        let timestamp = now();
        let replay_context = context("peer", "session", "sha256:aa");
        let mut replay = ReplayProtection::new_durable(&path, options()).unwrap();
        replay
            .check_and_record_context(
                "sha256:aa|session",
                1,
                Some("nonce"),
                Some(timestamp),
                Some(&replay_context),
            )
            .unwrap();
        drop(replay);
        if mutation == "truncated" {
            fs::write(&path, b"{\"checksum\":").unwrap();
        } else {
            let mut value: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
            value["checksum"] = Value::String("sha256:00".to_string());
            fs::write(&path, serde_json::to_vec(&value).unwrap()).unwrap();
        }
        let error = ReplayProtection::new_durable(&path, options()).unwrap_err();
        assert_eq!(error.code, "security_state_corrupt");
        assert!(!path.exists());
        assert!(fs::read_dir(directory.path())
            .unwrap()
            .flatten()
            .any(|entry| entry.file_name().to_string_lossy().contains("corrupt-")));
    }
}

#[test]
fn orphan_temp_is_ignored_and_failed_write_rolls_back_memory() {
    let root = tempfile::tempdir().unwrap();
    let state_directory = root.path().join("state");
    fs::create_dir(&state_directory).unwrap();
    let path = state_directory.join("replay.json");
    fs::write(state_directory.join(".replay.json.tmp-orphan"), b"partial").unwrap();
    let timestamp = now();
    let replay_context = context("peer", "session", "sha256:aa");
    let mut replay = ReplayProtection::new_durable(&path, options()).unwrap();
    replay
        .check_and_record_context(
            "sha256:aa|session",
            1,
            Some("nonce-1"),
            Some(timestamp),
            Some(&replay_context),
        )
        .unwrap();

    let backup = root.path().join("replay-backup.json");
    fs::rename(&path, &backup).unwrap();
    fs::remove_file(state_directory.join(".replay.json.tmp-orphan")).unwrap();
    fs::remove_dir(&state_directory).unwrap();
    fs::write(&state_directory, b"blocks directory creation").unwrap();
    assert_eq!(
        replay
            .check_and_record_context(
                "sha256:aa|session",
                2,
                Some("nonce-2"),
                Some(timestamp),
                Some(&replay_context),
            )
            .unwrap_err()
            .code,
        "security_state_path_unsafe"
    );
    fs::remove_file(&state_directory).unwrap();
    fs::create_dir(&state_directory).unwrap();
    fs::rename(&backup, &path).unwrap();
    replay
        .check_and_record_context(
            "sha256:aa|session",
            2,
            Some("nonce-2"),
            Some(timestamp),
            Some(&replay_context),
        )
        .unwrap();
}

#[test]
fn capacity_fails_closed_and_compaction_expires_state() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("replay.json");
    let timestamp = now();
    let mut bounded = options();
    bounded.max_seen_nonces = 1;
    bounded.window_seconds = 1;
    bounded.state_ttl_seconds = 1;
    let replay_context = context("peer", "session", "sha256:aa");
    let mut replay = ReplayProtection::new_durable(&path, bounded.clone()).unwrap();
    replay
        .check_and_record_context(
            "sha256:aa|session",
            1,
            Some("nonce-1"),
            Some(timestamp),
            Some(&replay_context),
        )
        .unwrap();
    assert_eq!(
        replay
            .check_and_record_context(
                "sha256:aa|session",
                2,
                Some("nonce-2"),
                Some(timestamp),
                Some(&replay_context),
            )
            .unwrap_err()
            .code,
        "replay_state_capacity"
    );
    replay.compact_durable(timestamp + 2).unwrap();
    assert_eq!(replay.durable_status().unwrap().scopes, 0);
    drop(replay);
    let mut restarted = ReplayProtection::new_durable(&path, bounded).unwrap();
    restarted
        .check_and_record_context(
            "sha256:aa|session",
            1,
            Some("nonce-1"),
            None,
            Some(&replay_context),
        )
        .unwrap();
}

#[test]
fn new_durable_scope_requires_authenticated_context() {
    let directory = tempfile::tempdir().unwrap();
    let mut replay =
        ReplayProtection::new_durable(directory.path().join("replay.json"), options()).unwrap();
    assert_eq!(
        replay
            .check_and_record("scope", 1, Some("nonce"), Some(now()))
            .unwrap_err()
            .code,
        "replay_context_missing"
    );
}
