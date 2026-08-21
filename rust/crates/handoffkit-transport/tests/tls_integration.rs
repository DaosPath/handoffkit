use handoffkit_protocol::security::{
    CapabilityPolicy, PeerIdentity, ReplayProtection, SecurityConfig, SecurityProfile,
};
use handoffkit_protocol::{MessageEnvelope, PROTOCOL_VERSION};
use handoffkit_transport::{
    certificate_fingerprint, CertificateIdentityPolicy, NetworkConfig, SecureNetworkConfig,
    TcpTransport, TlsTcpListener, Transport,
};
use serde_json::json;
use std::collections::HashMap;
use std::env;
use std::fs::File;
use std::io::BufReader;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, OnceLock};
use std::time::Duration;
use tempfile::TempDir;

const TRUST_DOMAIN: &str = "handoffkit.internal";
const ISSUER: &str = "CN=HandoffKit Test CA";
const OPERATION: &str = "message:echo";

static TLS_FIXTURES: OnceLock<TempDir> = OnceLock::new();

fn fixture_root() -> &'static Path {
    TLS_FIXTURES
        .get_or_init(|| {
            let directory = tempfile::Builder::new()
                .prefix("handoffkit-rust-tls-")
                .tempdir()
                .unwrap();
            let generator = Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../../shared/contracts/test-fixtures/tls/generate.py");
            let mut candidates = Vec::new();
            if let Ok(value) = env::var("HANDOFFKIT_PYTHON_BIN") {
                candidates.push(value);
            }
            if cfg!(windows) {
                candidates.push("python".to_string());
            } else {
                candidates.push("python3".to_string());
                candidates.push("python".to_string());
            }
            for executable in candidates {
                match Command::new(&executable)
                    .arg(&generator)
                    .arg("--output")
                    .arg(directory.path())
                    .output()
                {
                    Ok(output) if output.status.success() => return directory,
                    Ok(output) => panic!(
                        "TLS fixture generation failed with {executable}: {}",
                        String::from_utf8_lossy(&output.stderr)
                    ),
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                    Err(error) => panic!("TLS fixture generation failed: {error}"),
                }
            }
            panic!("no Python interpreter could generate TLS fixtures")
        })
        .path()
}

fn fixture(name: &str) -> PathBuf {
    fixture_root().join(name)
}

fn certificate_der(name: &str) -> Vec<u8> {
    let file = File::open(fixture(&format!("{name}_cert.pem"))).unwrap();
    rustls_pemfile::certs(&mut BufReader::new(file))
        .next()
        .unwrap()
        .unwrap()
        .to_vec()
}

fn fixture_identity(name: &str) -> PeerIdentity {
    let (peer_id, node_id, worker_id) = match name {
        "client" => ("client-peer", "client-node", Some("client-worker")),
        "revoked_client" => ("revoked-peer", "revoked-node", Some("revoked-worker")),
        "server" | "wrong_host_server" | "expired_server" => ("server-peer", "server-node", None),
        "rogue_server" => ("rogue-peer", "rogue-node", None),
        _ => panic!("unknown fixture identity {name}"),
    };
    let der = certificate_der(name);
    let (_, certificate) = x509_parser::parse_x509_certificate(&der).unwrap();
    PeerIdentity {
        peer_id: peer_id.to_string(),
        node_id: node_id.to_string(),
        trust_domain: if name == "rogue_server" {
            "rogue.invalid".to_string()
        } else {
            TRUST_DOMAIN.to_string()
        },
        worker_id: worker_id.map(str::to_string),
        credential_fingerprint: certificate_fingerprint(&der),
        capabilities: vec![OPERATION.to_string()],
        issued_at: certificate.validity().not_before.timestamp().max(0) as u64,
        expires_at: certificate.validity().not_after.timestamp().max(0) as u64,
    }
}

fn secure_config(own_certificate: Option<&str>, accepted_peers: &[&str]) -> SecureNetworkConfig {
    let grants = accepted_peers
        .iter()
        .map(|name| {
            (
                certificate_fingerprint(&certificate_der(name)),
                vec![OPERATION.to_string()],
            )
        })
        .collect();
    let mut identity_policy = CertificateIdentityPolicy::new(TRUST_DOMAIN, grants);
    identity_policy
        .allowed_issuer_names
        .insert(ISSUER.to_string());
    let security = SecurityConfig {
        profile: SecurityProfile::Standard,
        require_mtls: true,
        trust_domain: TRUST_DOMAIN.to_string(),
        ca_cert_path: Some(fixture("ca_cert.pem").to_string_lossy().into_owned()),
        cert_path: own_certificate.map(|name| {
            fixture(&format!("{name}_cert.pem"))
                .to_string_lossy()
                .into_owned()
        }),
        key_path: own_certificate.map(|name| {
            fixture(&format!("{name}_key.pem"))
                .to_string_lossy()
                .into_owned()
        }),
        replay_window_seconds: 30,
        max_clock_skew_seconds: 3,
        ..SecurityConfig::default()
    };
    let mut config = SecureNetworkConfig::new(
        NetworkConfig {
            connect_timeout: Duration::from_secs(1),
            io_timeout: Duration::from_secs(1),
            ..NetworkConfig::default()
        },
        security,
        identity_policy,
        CapabilityPolicy::new(Some(vec![OPERATION.to_string()]), None),
    );
    config.server_name = Some("localhost".to_string());
    config
}

fn envelope(
    identity: &PeerIdentity,
    session_id: &str,
    sequence: u64,
    nonce: &str,
    operation: &str,
    created_at: chrono::DateTime<chrono::Utc>,
) -> MessageEnvelope {
    MessageEnvelope {
        protocol_version: PROTOCOL_VERSION.to_string(),
        message_id: format!("{session_id}-{sequence}-{nonce}"),
        session_id: session_id.to_string(),
        channel: "secure".to_string(),
        kind: "data".to_string(),
        source: identity.peer_id.clone(),
        target: None,
        sequence,
        created_at: created_at.to_rfc3339_opts(chrono::SecondsFormat::Nanos, true),
        deadline: None,
        correlation_id: None,
        causation_id: None,
        idempotency_key: None,
        attempt: 1,
        requires_ack: false,
        payload_type: "json".to_string(),
        payload: json!({"ok": true}),
        metadata: HashMap::from([
            ("peer_identity".to_string(), json!(identity)),
            ("security_nonce".to_string(), json!(nonce)),
            ("operation".to_string(), json!(operation)),
        ]),
    }
}

async fn submit_to(
    listener: Arc<TlsTcpListener>,
    address: &str,
    client_config: &SecureNetworkConfig,
    message: MessageEnvelope,
) -> Result<(), handoffkit_runtime::RuntimeError> {
    let server_listener = listener.clone();
    let server = tokio::spawn(async move {
        let transport = server_listener.accept().await?;
        let result = transport.receive().await.map(|_| ());
        let _ = transport.close().await;
        result
    });
    let client = TcpTransport::connect_tls(address, client_config).await?;
    client.send(&message).await?;
    let _ = client.close().await;
    server.await.unwrap()
}

#[tokio::test]
async fn rust_tls13_mtls_roundtrip_binds_certificate_identity() {
    let server_config = secure_config(Some("server"), &["client"]);
    let client_config = secure_config(Some("client"), &["server"]);
    let listener = Arc::new(
        TlsTcpListener::bind("127.0.0.1:0", server_config)
            .await
            .unwrap(),
    );
    let address = listener.local_addr().unwrap().to_string();
    let server_listener = listener.clone();
    let client_identity = fixture_identity("client");
    let expected_client = client_identity.clone();
    let server_identity = fixture_identity("server");
    let response_identity = server_identity.clone();
    let server = tokio::spawn(async move {
        let transport = server_listener.accept().await.unwrap();
        assert!(transport.is_tls());
        assert_eq!(transport.tls_version(), Some("TLSv1.3"));
        assert_eq!(transport.authenticated_peer(), Some(&expected_client));
        let request = transport.receive().await.unwrap();
        transport
            .send(&envelope(
                &response_identity,
                &request.session_id,
                1,
                "server-response",
                OPERATION,
                chrono::Utc::now(),
            ))
            .await
            .unwrap();
        transport.close().await.unwrap();
    });
    let client = TcpTransport::connect_tls(&address, &client_config)
        .await
        .unwrap();
    assert!(client.is_tls());
    assert_eq!(client.tls_version(), Some("TLSv1.3"));
    assert_eq!(client.authenticated_peer(), Some(&server_identity));
    client
        .send(&envelope(
            &client_identity,
            "roundtrip",
            1,
            "client-request",
            OPERATION,
            chrono::Utc::now(),
        ))
        .await
        .unwrap();
    assert_eq!(client.receive().await.unwrap().source, "server-peer");
    client.close().await.unwrap();
    server.await.unwrap();
}

#[tokio::test]
async fn rust_tls_rejects_invalid_server_certificates() {
    for (name, certificate, ca, server_name, expected) in [
        (
            "wrong hostname",
            "wrong_host_server",
            "ca_cert.pem",
            "localhost",
            "hostname_mismatch",
        ),
        (
            "expired",
            "expired_server",
            "ca_cert.pem",
            "localhost",
            "credential_expired",
        ),
        (
            "unknown CA",
            "server",
            "rogue_ca_cert.pem",
            "localhost",
            "unknown_ca",
        ),
        (
            "rogue issuer",
            "rogue_server",
            "ca_cert.pem",
            "localhost",
            "unknown_ca",
        ),
    ] {
        let server_config = secure_config(Some(certificate), &["client"]);
        let mut client_config = secure_config(Some("client"), &[certificate]);
        client_config.security.ca_cert_path = Some(fixture(ca).to_string_lossy().into_owned());
        client_config.server_name = Some(server_name.to_string());
        let listener = Arc::new(
            TlsTcpListener::bind("127.0.0.1:0", server_config)
                .await
                .unwrap(),
        );
        let address = listener.local_addr().unwrap().to_string();
        let server_listener = listener.clone();
        let server = tokio::spawn(async move { server_listener.accept().await.map(|_| ()) });
        let error = match TcpTransport::connect_tls(&address, &client_config).await {
            Ok(transport) => {
                let _ = transport.close().await;
                panic!("{name} certificate was accepted")
            }
            Err(error) => error,
        };
        assert_eq!(error.code, expected, "{name}: {error}");
        let _ = tokio::time::timeout(Duration::from_secs(1), server).await;
    }
}

#[tokio::test]
async fn rust_mtls_rejects_client_without_certificate() {
    let server_config = secure_config(Some("server"), &["client"]);
    let mut client_config = secure_config(None, &["server"]);
    client_config.security.require_mtls = false;
    let listener = Arc::new(
        TlsTcpListener::bind("127.0.0.1:0", server_config)
            .await
            .unwrap(),
    );
    let address = listener.local_addr().unwrap().to_string();
    let server_listener = listener.clone();
    let server = tokio::spawn(async move { server_listener.accept().await.map(|_| ()) });
    let client_result = TcpTransport::connect_tls(&address, &client_config).await;
    let server_error = server.await.unwrap().unwrap_err();
    assert_eq!(server_error.code, "client_certificate_missing");
    if let Ok(client) = client_result {
        let _ = client
            .send(&envelope(
                &fixture_identity("client"),
                "missing-client-cert",
                1,
                "missing-client-cert",
                OPERATION,
                chrono::Utc::now(),
            ))
            .await;
        assert!(client.receive().await.is_err());
        let _ = client.close().await;
    }
}

#[tokio::test]
async fn rust_secure_receive_rejects_identity_spoofing() {
    let client_identity = fixture_identity("client");
    for (field, value) in [
        ("peer_id", json!("spoofed-peer")),
        ("node_id", json!("spoofed-node")),
        ("worker_id", json!("spoofed-worker")),
        ("trust_domain", json!("evil.invalid")),
        ("credential_fingerprint", json!("sha256:00")),
        ("capabilities", json!(["*"])),
    ] {
        let listener = Arc::new(
            TlsTcpListener::bind("127.0.0.1:0", secure_config(Some("server"), &["client"]))
                .await
                .unwrap(),
        );
        let address = listener.local_addr().unwrap().to_string();
        let server_listener = listener.clone();
        let server = tokio::spawn(async move {
            let transport = server_listener.accept().await?;
            transport.receive().await.map(|_| ())
        });
        let client =
            TcpTransport::connect_tls(&address, &secure_config(Some("client"), &["server"]))
                .await
                .unwrap();
        let mut message = envelope(
            &client_identity,
            &format!("spoof-{field}"),
            1,
            &format!("nonce-{field}"),
            OPERATION,
            chrono::Utc::now(),
        );
        message
            .metadata
            .get_mut("peer_identity")
            .unwrap()
            .as_object_mut()
            .unwrap()
            .insert(field.to_string(), value);
        client.send(&message).await.unwrap();
        let _ = client.close().await;
        assert_eq!(
            server.await.unwrap().unwrap_err().code,
            "declared_identity_mismatch"
        );
    }
}

#[tokio::test]
async fn rust_secure_receive_integrates_replay_and_authorization() {
    let listener = Arc::new(
        TlsTcpListener::bind(
            "127.0.0.1:0",
            secure_config(Some("server"), &["client", "revoked_client"]),
        )
        .await
        .unwrap(),
    );
    let address = listener.local_addr().unwrap().to_string();
    let client_identity = fixture_identity("client");
    let second_identity = fixture_identity("revoked_client");
    let client_config = secure_config(Some("client"), &["server"]);
    let second_config = secure_config(Some("revoked_client"), &["server"]);
    let now = chrono::Utc::now();
    let first = envelope(&client_identity, "replay", 1, "same", OPERATION, now);
    submit_to(listener.clone(), &address, &client_config, first.clone())
        .await
        .unwrap();
    assert_eq!(
        submit_to(listener.clone(), &address, &client_config, first)
            .await
            .unwrap_err()
            .code,
        "replay_sequence"
    );
    assert_eq!(
        submit_to(
            listener.clone(),
            &address,
            &client_config,
            envelope(&client_identity, "replay", 2, "same", OPERATION, now),
        )
        .await
        .unwrap_err()
        .code,
        "replay_nonce"
    );
    submit_to(
        listener.clone(),
        &address,
        &client_config,
        envelope(&client_identity, "other-session", 1, "same", OPERATION, now),
    )
    .await
    .unwrap();
    submit_to(
        listener.clone(),
        &address,
        &second_config,
        envelope(&second_identity, "replay", 1, "same", OPERATION, now),
    )
    .await
    .unwrap();
    assert_eq!(
        submit_to(
            listener.clone(),
            &address,
            &client_config,
            envelope(
                &client_identity,
                "stale",
                1,
                "stale",
                OPERATION,
                now - chrono::Duration::seconds(60),
            ),
        )
        .await
        .unwrap_err()
        .code,
        "replay_timestamp_stale"
    );
    assert_eq!(
        submit_to(
            listener.clone(),
            &address,
            &client_config,
            envelope(
                &client_identity,
                "future",
                1,
                "future",
                OPERATION,
                now + chrono::Duration::seconds(10),
            ),
        )
        .await
        .unwrap_err()
        .code,
        "replay_timestamp_future"
    );
    submit_to(
        listener.clone(),
        &address,
        &client_config,
        envelope(
            &client_identity,
            "skew",
            1,
            "skew",
            OPERATION,
            now + chrono::Duration::seconds(1),
        ),
    )
    .await
    .unwrap();
    assert_eq!(
        submit_to(
            listener,
            &address,
            &client_config,
            envelope(&client_identity, "authz", 1, "authz", "job:admin", now),
        )
        .await
        .unwrap_err()
        .code,
        "authorization_denied"
    );

    // Secure replay state is deliberately process-local. A newly constructed
    // state (the current restart model) accepts the same authenticated scope.
    let mut restarted = ReplayProtection::new(30, 3, 1000);
    restarted
        .check_and_record(
            &format!("{}|{}", client_identity.credential_fingerprint, "replay"),
            1,
            Some("same"),
            Some(now.timestamp() as u64),
        )
        .unwrap();
}

#[tokio::test]
async fn rust_local_revocation_rejects_before_dispatch() {
    let mut server_config = secure_config(Some("server"), &["revoked_client"]);
    server_config
        .identity_policy
        .revoke(certificate_fingerprint(&certificate_der("revoked_client")));
    let listener = Arc::new(
        TlsTcpListener::bind("127.0.0.1:0", server_config)
            .await
            .unwrap(),
    );
    let address = listener.local_addr().unwrap().to_string();
    let server_listener = listener.clone();
    let server = tokio::spawn(async move { server_listener.accept().await.map(|_| ()) });
    let client = TcpTransport::connect_tls(
        &address,
        &secure_config(Some("revoked_client"), &["server"]),
    )
    .await
    .unwrap();
    let error = server.await.unwrap().unwrap_err();
    assert_eq!(error.code, "credential_revoked");
    client.close().await.unwrap();
}

#[test]
fn rust_hybrid_pq_is_unavailable_and_fails_closed() {
    let capabilities = handoffkit_transport::supported_crypto_capabilities();
    assert_eq!(capabilities["hybrid_pq_supported"], false);
    assert_eq!(capabilities["digest_algorithms"], json!(["sha256"]));
    assert_eq!(capabilities["signature_algorithms"], json!(["ed25519"]));
    let mut config = secure_config(Some("client"), &["server"]);
    config.security.profile = SecurityProfile::HybridPq;
    let runtime = tokio::runtime::Runtime::new().unwrap();
    let error = match runtime.block_on(TcpTransport::connect_tls("127.0.0.1:1", &config)) {
        Ok(_) => panic!("unavailable hybrid-pq profile was accepted"),
        Err(error) => error,
    };
    assert_eq!(error.code, "security_profile_unavailable");
}


