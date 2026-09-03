use handoffkit_protocol::{RetryPolicy, RuntimeMode, SessionConfig, DEFAULT_MAX_MESSAGE_BYTES};
use handoffkit_transport::{
    client_handshake, server_handshake, NdjsonTransport, SubprocessTransport, Transport,
};
use serde_json::json;
use std::collections::HashMap;
use std::path::Path;
use std::time::Duration;
use tokio::io::{split, AsyncWriteExt};

fn config(id: &str) -> SessionConfig {
    SessionConfig {
        session_id: id.to_string(),
        runtime_mode: RuntimeMode::Session,
        channel_capacity: 64,
        max_message_bytes: DEFAULT_MAX_MESSAGE_BYTES,
        ack_timeout_ms: 1_000,
        dedup_capacity: 64,
        retry_policy: RetryPolicy::default(),
        deadline: None,
        metadata: HashMap::new(),
    }
}

fn pair(max: usize) -> (NdjsonTransport, NdjsonTransport) {
    let (left, right) = tokio::io::duplex(max * 4);
    let (left_reader, left_writer) = split(left);
    let (right_reader, right_writer) = split(right);
    (
        NdjsonTransport::new(left_reader, left_writer, max, "left").unwrap(),
        NdjsonTransport::new(right_reader, right_writer, max, "right").unwrap(),
    )
}

#[tokio::test]
async fn ndjson_round_trip_validates_envelopes() {
    let (left, right) = pair(DEFAULT_MAX_MESSAGE_BYTES);
    let session = handoffkit_runtime::CspSession::new(config("round-trip")).unwrap();
    let envelope = session.envelope("work", "data", "left", "json", json!({"ok": true}));
    left.send(&envelope).await.unwrap();
    assert_eq!(right.receive().await.unwrap(), envelope);
}

#[tokio::test]
async fn malformed_ndjson_is_rejected() {
    let (stream, mut peer) = tokio::io::duplex(128);
    let (reader, writer) = split(stream);
    let transport = NdjsonTransport::new(reader, writer, 128, "test").unwrap();
    peer.write_all(b"{bad-json}\n").await.unwrap();
    let error = transport.receive().await.unwrap_err();
    assert_eq!(error.code, "invalid_ndjson");
}

#[tokio::test]
async fn oversized_line_is_rejected_before_unbounded_allocation() {
    let (stream, mut peer) = tokio::io::duplex(256);
    let (reader, writer) = split(stream);
    let transport = NdjsonTransport::new(reader, writer, 64, "test").unwrap();
    peer.write_all(&[b'x'; 65]).await.unwrap();
    let error = transport.receive().await.unwrap_err();
    assert_eq!(error.code, "message_too_large");
}

#[tokio::test]
async fn client_and_server_negotiate_before_data() {
    let (client, server) = pair(DEFAULT_MAX_MESSAGE_BYTES);
    let server_task = tokio::spawn(async move {
        server_handshake(&server, "rust-server", vec!["echo".to_string()])
            .await
            .unwrap()
    });
    let result = client_handshake(
        &client,
        &config("handshake"),
        "rust-client",
        vec!["request_response".to_string()],
    )
    .await
    .unwrap();
    assert_eq!(result.peer_runtime, "rust-server");
    assert_eq!(server_task.await.unwrap().runtime, "rust-client");
}

#[tokio::test]
async fn server_rejects_data_before_handshake() {
    let (client, server) = pair(DEFAULT_MAX_MESSAGE_BYTES);
    let session = handoffkit_runtime::CspSession::new(config("bad-handshake")).unwrap();
    let envelope = session.envelope("work", "data", "client", "json", json!({}));
    client.send(&envelope).await.unwrap();
    let error = server_handshake(&server, "server", Vec::new())
        .await
        .unwrap_err();
    assert_eq!(error.code, "handshake_required");
    assert_eq!(client.receive().await.unwrap().kind, "session_reject");
}

#[tokio::test]
async fn server_rejects_malformed_handshake_payload() {
    let (client, server) = pair(DEFAULT_MAX_MESSAGE_BYTES);
    let session = handoffkit_runtime::CspSession::new(config("bad-payload")).unwrap();
    let envelope = session.envelope(
        "control",
        "session_open",
        "client",
        "json",
        json!({"runtime": "client"}),
    );
    client.send(&envelope).await.unwrap();
    let error = server_handshake(&server, "server", Vec::new())
        .await
        .unwrap_err();
    assert_eq!(error.code, "invalid_handshake");
    let rejection = client.receive().await.unwrap();
    assert_eq!(rejection.kind, "session_reject");
    assert_eq!(rejection.payload["code"], "invalid_handshake");
    assert_eq!(
        rejection.correlation_id.as_deref(),
        Some(envelope.message_id.as_str())
    );
}

#[tokio::test]
async fn client_rejects_empty_runtime_before_sending() {
    let (client, _server) = pair(DEFAULT_MAX_MESSAGE_BYTES);
    let error = client_handshake(&client, &config("runtime-name"), " ", Vec::new())
        .await
        .unwrap_err();
    assert_eq!(error.code, "invalid_runtime");
}

#[tokio::test]
async fn failed_subprocess_is_reported() {
    #[cfg(windows)]
    let (program, args) = (
        Path::new("cmd.exe"),
        vec!["/C".to_string(), "exit".to_string(), "7".to_string()],
    );
    #[cfg(not(windows))]
    let (program, args) = (
        Path::new("/bin/sh"),
        vec!["-c".to_string(), "exit 7".to_string()],
    );

    let transport = SubprocessTransport::spawn(program, &args, None, DEFAULT_MAX_MESSAGE_BYTES)
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(50)).await;
    let error = transport.receive().await.unwrap_err();
    assert_eq!(error.code, "subprocess_failed");
    transport.close().await.unwrap();
}
