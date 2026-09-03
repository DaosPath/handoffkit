//! Independent rustls TLS 1.3 + mTLS framed server for the C++ interop gate.

use rustls::pki_types::{CertificateDer, PrivateKeyDer};
use rustls::server::WebPkiClientVerifier;
use rustls::{RootCertStore, ServerConfig};
use serde_json::{json, Value};
use std::env;
use std::fs::File;
use std::io::BufReader;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio_rustls::TlsAcceptor;

fn option(name: &str, fallback: &str) -> String {
    let args: Vec<String> = env::args().collect();
    args.windows(2)
        .find(|pair| pair[0] == name)
        .map(|pair| pair[1].clone())
        .unwrap_or_else(|| fallback.to_string())
}

fn certificates(path: &str) -> Result<Vec<CertificateDer<'static>>, Box<dyn std::error::Error>> {
    let mut reader = BufReader::new(File::open(path)?);
    Ok(rustls_pemfile::certs(&mut reader).collect::<Result<Vec<_>, _>>()?)
}

fn private_key(path: &str) -> Result<PrivateKeyDer<'static>, Box<dyn std::error::Error>> {
    let mut reader = BufReader::new(File::open(path)?);
    Ok(rustls_pemfile::private_key(&mut reader)?.ok_or("private key PEM is empty")?)
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let host = option("--host", "127.0.0.1");
    let port: u16 = option("--port", "0").parse()?;
    let ca = option("--ca", "");
    let cert = option("--cert", "");
    let key = option("--key", "");
    if port == 0 || ca.is_empty() || cert.is_empty() || key.is_empty() {
        return Err("usage: cpp_tcp_server --port PORT --ca CA --cert CERT --key KEY".into());
    }

    let mut roots = RootCertStore::empty();
    for certificate in certificates(&ca)? {
        roots.add(certificate)?;
    }
    let verifier = WebPkiClientVerifier::builder(Arc::new(roots)).build()?;
    let config = ServerConfig::builder()
        .with_client_cert_verifier(verifier)
        .with_single_cert(certificates(&cert)?, private_key(&key)?)?;
    let listener = TcpListener::bind((host.as_str(), port)).await?;
    let (tcp, _) = listener.accept().await?;
    let acceptor = TlsAcceptor::from(Arc::new(config));
    let mut stream = acceptor.accept(tcp).await?;
    if stream.get_ref().1.protocol_version() != Some(rustls::ProtocolVersion::TLSv1_3) {
        return Err("Rust reverse interop did not negotiate TLS 1.3".into());
    }

    let size = stream.read_u32().await?;
    if size > 8 * 1024 * 1024 {
        return Err(format!("request frame too large: {size}").into());
    }
    let mut request_bytes = vec![0_u8; size as usize];
    stream.read_exact(&mut request_bytes).await?;
    let request: Value = serde_json::from_slice(&request_bytes)?;
    let response = json!({
        "protocol_version": "1.0", "message_id": "rust-reverse-response",
        "session_id": request["session_id"], "channel": "control", "kind": "interop_echo",
        "source": "rust-server", "target": request["source"], "sequence": 1,
        "created_at": chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Nanos, true), "deadline": Value::Null,
        "correlation_id": request["message_id"], "causation_id": request["message_id"],
        "idempotency_key": request["idempotency_key"], "attempt": 1, "requires_ack": false,
        "payload_type": "interop_echo", "payload": {"runtime": "rust", "request_kind": request["kind"]},
        "metadata": {"nonce": "rust-reverse-response"},
    });
    let encoded = serde_json::to_vec(&response)?;
    stream.write_u32(encoded.len() as u32).await?;
    stream.write_all(&encoded).await?;
    stream.flush().await?;
    println!(
        "{}",
        serde_json::to_string(&json!({
            "runtime": "rust", "protocol": "TLSv1.3", "authorized": true,
        }))?
    );
    Ok(())
}
