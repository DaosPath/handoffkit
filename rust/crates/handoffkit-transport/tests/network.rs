use handoffkit_protocol::{RetryPolicy, ValidationLimits};
use handoffkit_transport::{
    decode_length_delimited_payload, encode_length_delimited_frame, response_for, NetworkConfig,
    TcpTransport, Transport,
};
use serde_json::json;
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio::net::TcpListener;

fn direct_envelope() -> handoffkit_protocol::MessageEnvelope {
    handoffkit_protocol::MessageEnvelope {
        protocol_version: "1.0".to_string(),
        message_id: "network-message".to_string(),
        session_id: "network".to_string(),
        channel: "work".to_string(),
        kind: "request".to_string(),
        source: "client".to_string(),
        target: None,
        sequence: 1,
        created_at: "2026-01-01T00:00:00Z".to_string(),
        deadline: None,
        correlation_id: None,
        causation_id: None,
        idempotency_key: Some("network-operation".to_string()),
        attempt: 1,
        requires_ack: false,
        payload_type: "json".to_string(),
        payload: json!({"value": 42}),
        metadata: Default::default(),
    }
}

#[test]
fn length_delimited_codec_roundtrips() {
    let message = direct_envelope();
    let limits = ValidationLimits::default();
    let frame = encode_length_delimited_frame(&message, limits).unwrap();
    assert_eq!(
        u32::from_be_bytes(frame[..4].try_into().unwrap()) as usize,
        frame.len() - 4
    );
    assert_eq!(
        decode_length_delimited_payload(&frame[4..], limits).unwrap(),
        message
    );
}

#[tokio::test]
async fn tcp_transport_roundtrips_real_socket() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let config = NetworkConfig {
        io_timeout: Duration::from_secs(2),
        ..NetworkConfig::default()
    };
    let server = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let transport = TcpTransport::from_stream(stream, config).unwrap();
        let request = transport.receive().await.unwrap();
        let response = response_for(&request, "server", "response", "json", json!({"ok": true}));
        transport.send(&response).await.unwrap();
        transport.close().await.unwrap();
    });
    let client = TcpTransport::connect(&address.to_string(), config)
        .await
        .unwrap();
    let request = direct_envelope();
    client.send(&request).await.unwrap();
    let response = client.receive().await.unwrap();
    assert_eq!(
        response.correlation_id.as_deref(),
        Some(request.message_id.as_str())
    );
    assert_eq!(response.payload, json!({"ok": true}));
    client.close().await.unwrap();
    server.await.unwrap();
}

#[tokio::test]
async fn tcp_reconnect_policy_recovers_when_server_appears() {
    let reservation = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let address = reservation.local_addr().unwrap();
    drop(reservation);
    let server = tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(25)).await;
        let listener = TcpListener::bind(address).await.unwrap();
        let (stream, _) = listener.accept().await.unwrap();
        let transport = TcpTransport::from_stream(stream, NetworkConfig::default()).unwrap();
        let _ = transport.receive().await.unwrap();
    });
    let retry = RetryPolicy {
        max_attempts: 5,
        base_delay_ms: 10,
        max_delay_ms: 20,
    };
    let client =
        TcpTransport::connect_with_retry(&address.to_string(), NetworkConfig::default(), &retry)
            .await
            .unwrap();
    client.send(&direct_envelope()).await.unwrap();
    server.await.unwrap();
}

#[tokio::test]
async fn oversized_tcp_header_is_rejected_before_allocation() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let config = NetworkConfig {
        max_message_bytes: 1024,
        io_timeout: Duration::from_secs(1),
        ..NetworkConfig::default()
    };
    let server = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let transport = TcpTransport::from_stream(stream, config).unwrap();
        transport.receive().await.unwrap_err()
    });
    let mut raw = tokio::net::TcpStream::connect(address).await.unwrap();
    raw.write_all(&(2048_u32).to_be_bytes()).await.unwrap();
    let error = server.await.unwrap();
    assert_eq!(error.code, "message_too_large");
}

#[cfg(unix)]
#[tokio::test]
async fn unix_transport_roundtrips_real_socket() {
    use handoffkit_transport::UnixTransport;
    use tokio::net::UnixListener;

    let path = std::env::temp_dir().join(format!("handoffkit-{}.sock", std::process::id()));
    let _ = std::fs::remove_file(&path);
    let listener = UnixListener::bind(&path).unwrap();
    let server = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let transport = UnixTransport::from_stream(stream, NetworkConfig::default()).unwrap();
        assert_eq!(
            transport.receive().await.unwrap().message_id,
            "network-message"
        );
    });
    let client = UnixTransport::connect(&path, NetworkConfig::default())
        .await
        .unwrap();
    client.send(&direct_envelope()).await.unwrap();
    server.await.unwrap();
    let _ = std::fs::remove_file(path);
}

#[cfg(feature = "websocket")]
#[tokio::test]
async fn websocket_transport_roundtrips_real_socket() {
    use futures_util::{SinkExt, StreamExt};
    use handoffkit_transport::WebSocketTransport;

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let mut socket = tokio_tungstenite::accept_async(stream).await.unwrap();
        let message = socket.next().await.unwrap().unwrap();
        socket.send(message).await.unwrap();
    });
    let client = WebSocketTransport::connect(
        &format!("ws://{address}"),
        NetworkConfig {
            io_timeout: Duration::from_secs(2),
            ..NetworkConfig::default()
        },
    )
    .await
    .unwrap();
    let request = direct_envelope();
    client.send(&request).await.unwrap();
    assert_eq!(client.receive().await.unwrap(), request);
    client.close().await.unwrap();
    server.await.unwrap();
}
