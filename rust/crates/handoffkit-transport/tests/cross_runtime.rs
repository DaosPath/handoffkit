use handoffkit_protocol::{
    utc_now, MessageEnvelope, RetryPolicy, RuntimeMode, SessionConfig, DEFAULT_MAX_MESSAGE_BYTES,
    PROTOCOL_VERSION,
};
use handoffkit_transport::{client_handshake, SubprocessTransport, Transport};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

fn repository_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(3)
        .expect("repository root")
        .to_path_buf()
}

fn config(id: &str) -> SessionConfig {
    SessionConfig {
        session_id: id.to_string(),
        runtime_mode: RuntimeMode::Session,
        channel_capacity: 64,
        max_message_bytes: DEFAULT_MAX_MESSAGE_BYTES,
        ack_timeout_ms: 2_000,
        dedup_capacity: 128,
        retry_policy: RetryPolicy::default(),
        deadline: None,
        metadata: HashMap::new(),
    }
}

fn envelope(session_id: &str, kind: &str, channel: &str, payload: Value) -> MessageEnvelope {
    let message_id = format!("rust-{kind}");
    MessageEnvelope {
        protocol_version: PROTOCOL_VERSION.to_string(),
        message_id: message_id.clone(),
        session_id: session_id.to_string(),
        channel: channel.to_string(),
        kind: kind.to_string(),
        source: "rust-test".to_string(),
        target: Some("worker".to_string()),
        sequence: if kind == "session_close" { 2 } else { 1 },
        created_at: utc_now(),
        deadline: None,
        correlation_id: None,
        causation_id: None,
        idempotency_key: Some(message_id),
        attempt: 1,
        requires_ack: false,
        payload_type: "handoff_state".to_string(),
        payload,
        metadata: HashMap::new(),
    }
}

async fn exercise_worker(program: &Path, args: &[String], runtime_name: &str, session_id: &str) {
    let root = repository_root();
    let fixture: Value = serde_json::from_str(
        &std::fs::read_to_string(root.join("shared/contracts/fixtures/handoff_state.json"))
            .unwrap(),
    )
    .unwrap();
    let transport =
        SubprocessTransport::spawn(program, args, Some(&root), DEFAULT_MAX_MESSAGE_BYTES)
            .await
            .unwrap();
    let ready = client_handshake(
        &transport,
        &config(session_id),
        "rust-test",
        vec!["handoff_state".to_string()],
    )
    .await
    .unwrap();
    assert_eq!(ready.peer_runtime, runtime_name);
    transport
        .send(&envelope(
            session_id,
            "request",
            "requests",
            fixture.clone(),
        ))
        .await
        .unwrap();
    let response = transport.receive().await.unwrap();
    assert_eq!(response.kind, "result");
    assert_eq!(response.correlation_id.as_deref(), Some("rust-request"));
    assert_eq!(response.payload["runtime"], runtime_name);
    assert_eq!(response.payload["handoff_state"], fixture);
    let mut closing = envelope(session_id, "session_close", "control", json!({}));
    closing.payload_type = "json".to_string();
    transport.send(&closing).await.unwrap();
    let closed = transport.receive().await.unwrap();
    assert_eq!(closed.kind, "session_closed");
    assert_eq!(closed.correlation_id.as_deref(), Some("rust-session_close"));
    transport.close().await.unwrap();
}

#[tokio::test]
async fn rust_starts_python_worker_over_stdio() {
    if std::env::var("HANDOFFKIT_RUN_INTEROP_TESTS").as_deref() != Ok("1") {
        return;
    }
    let root = repository_root();
    let script = root.join("python/packages/handoffkit/examples/csp_rust_worker.py");
    exercise_worker(
        Path::new("python"),
        &[script.to_string_lossy().into_owned()],
        "python",
        "rust-python-test",
    )
    .await;
}

#[tokio::test]
async fn rust_starts_javascript_worker_over_stdio() {
    if std::env::var("HANDOFFKIT_RUN_INTEROP_TESTS").as_deref() != Ok("1") {
        return;
    }
    let root = repository_root();
    let script = root.join("js/packages/node/examples/csp_worker.mjs");
    exercise_worker(
        Path::new("node"),
        &[script.to_string_lossy().into_owned()],
        "javascript",
        "rust-javascript-test",
    )
    .await;
}

#[tokio::test]
async fn rust_starts_go_worker_over_stdio() {
    if std::env::var("HANDOFFKIT_RUN_INTEROP_TESTS").as_deref() != Ok("1") {
        return;
    }
    let root = repository_root();
    let default = root.join(".local-tests/bin").join(if cfg!(windows) {
        "handoffkit-worker.exe"
    } else {
        "handoffkit-worker"
    });
    let binary = std::env::var_os("HANDOFFKIT_GO_BIN")
        .map(PathBuf::from)
        .unwrap_or(default);
    exercise_worker(&binary, &[], "go", "rust-go-test").await;
}
