use std::process::Command;

use handoffkit_protocol::{
    utc_now, MessageEnvelope, RetryPolicy, RuntimeMode, SessionConfig, DEFAULT_MAX_MESSAGE_BYTES,
    PROTOCOL_VERSION,
};
use handoffkit_transport::{client_handshake, SubprocessTransport, Transport};
use serde_json::json;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[test]
fn doctor_reports_runtime_capabilities() {
    let output = Command::new(env!("CARGO_BIN_EXE_handoffkit-rs"))
        .args(["csp", "doctor"])
        .output()
        .unwrap();
    assert!(output.status.success());
    let value: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(value["success"], true);
    assert_eq!(value["runtime"], "rust");
    assert_eq!(value["distributed"], false);
}

#[test]
fn local_demo_uses_real_subprocess_transport() {
    let output = Command::new(env!("CARGO_BIN_EXE_handoffkit-rs"))
        .args(["csp", "demo"])
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let value: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(value["success"], true);
    assert_eq!(value["response_kind"], "result");
}

#[test]
fn inspect_reads_bounded_ndjson() {
    let path = test_artifact("inspect-valid.ndjson");
    let envelope = message("inspect-test", "data", 1);
    std::fs::write(
        &path,
        format!("{}\n", serde_json::to_string(&envelope).unwrap()),
    )
    .unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_handoffkit-rs"))
        .args(["csp", "inspect", path.to_str().unwrap()])
        .output()
        .unwrap();
    let _ = std::fs::remove_file(&path);
    assert!(output.status.success());
    let value: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(value["messages"], 1);
    assert_eq!(value["kinds"]["data"], 1);
}

#[test]
fn inspect_rejects_unterminated_ndjson() {
    let path = test_artifact("inspect-truncated.ndjson");
    std::fs::write(
        &path,
        serde_json::to_vec(&message("inspect-test", "data", 1)).unwrap(),
    )
    .unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_handoffkit-rs"))
        .args(["csp", "inspect", path.to_str().unwrap()])
        .output()
        .unwrap();
    let _ = std::fs::remove_file(&path);
    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("invalid_ndjson"));
}

#[tokio::test]
async fn worker_nacks_unknown_message_and_closes() {
    let args = vec!["csp".to_string(), "worker".to_string()];
    let transport = SubprocessTransport::spawn(
        Path::new(env!("CARGO_BIN_EXE_handoffkit-rs")),
        &args,
        None,
        DEFAULT_MAX_MESSAGE_BYTES,
    )
    .await
    .unwrap();
    let config = SessionConfig {
        session_id: "unknown-test".to_string(),
        runtime_mode: RuntimeMode::Session,
        channel_capacity: 64,
        max_message_bytes: DEFAULT_MAX_MESSAGE_BYTES,
        ack_timeout_ms: 1_000,
        dedup_capacity: 64,
        retry_policy: RetryPolicy::default(),
        deadline: None,
        metadata: HashMap::new(),
    };
    client_handshake(&transport, &config, "test", Vec::new())
        .await
        .unwrap();
    let unknown = message("unknown-test", "future_operation", 1);
    transport.send(&unknown).await.unwrap();
    let response = transport.receive().await.unwrap();
    assert_eq!(response.kind, "nack");
    assert_eq!(response.payload["code"], "unknown_message_kind");
    transport
        .send(&message("unknown-test", "session_close", 2))
        .await
        .unwrap();
    assert_eq!(transport.receive().await.unwrap().kind, "session_closed");
    transport.close().await.unwrap();
}

fn message(session_id: &str, kind: &str, sequence: u64) -> MessageEnvelope {
    MessageEnvelope {
        protocol_version: PROTOCOL_VERSION.to_string(),
        message_id: format!("message-{sequence}"),
        session_id: session_id.to_string(),
        channel: "control".to_string(),
        kind: kind.to_string(),
        source: "test".to_string(),
        target: Some("rust-worker".to_string()),
        sequence,
        created_at: utc_now(),
        deadline: None,
        correlation_id: None,
        causation_id: None,
        idempotency_key: Some(format!("message-{sequence}")),
        attempt: 1,
        requires_ack: false,
        payload_type: "json".to_string(),
        payload: json!({}),
        metadata: HashMap::new(),
    }
}

fn test_artifact(name: &str) -> PathBuf {
    let directory = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/test-artifacts");
    std::fs::create_dir_all(&directory).unwrap();
    directory.join(format!("{}-{name}", std::process::id()))
}
