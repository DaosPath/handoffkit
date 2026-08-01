use super::{LengthDelimitedTransport, NetworkConfig, TcpTransport};
use handoffkit_protocol::security::{
    CapabilityPolicy, PeerIdentity, ReplayProtection, SecurityConfig, SecurityProfile,
};
use handoffkit_protocol::MessageEnvelope;
use handoffkit_runtime::{RuntimeError, RuntimeResult};
use rustls::pki_types::{CertificateDer, PrivateKeyDer, ServerName};
use rustls::server::WebPkiClientVerifier;
use rustls::{ClientConfig, RootCertStore, ServerConfig};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::BufReader;
use std::net::SocketAddr;
use std::path::Path;
use std::sync::{Arc, Mutex as StdMutex};
use tokio::net::{TcpListener, TcpStream};
use tokio_rustls::{TlsAcceptor, TlsConnector};
use x509_parser::extensions::GeneralName;
use x509_parser::parse_x509_certificate;

#[derive(Debug, Clone)]
pub struct CertificateIdentityPolicy {
    pub trust_domain: String,
    pub capabilities_by_fingerprint: HashMap<String, Vec<String>>,
    pub revoked_fingerprints: HashSet<String>,
    pub expected_peer_id: Option<String>,
    pub expected_node_id: Option<String>,
    pub expected_worker_id: Option<String>,
    pub allowed_issuer_names: HashSet<String>,
    pub require_authorized_fingerprint: bool,
}

impl CertificateIdentityPolicy {
    pub fn new(
        trust_domain: impl Into<String>,
        capabilities_by_fingerprint: HashMap<String, Vec<String>>,
    ) -> Self {
        Self {
            trust_domain: trust_domain.into(),
            capabilities_by_fingerprint: capabilities_by_fingerprint
                .into_iter()
                .map(|(fingerprint, capabilities)| {
                    (normalize_fingerprint(&fingerprint), capabilities)
                })
                .collect(),
            revoked_fingerprints: HashSet::new(),
            expected_peer_id: None,
            expected_node_id: None,
            expected_worker_id: None,
            allowed_issuer_names: HashSet::new(),
            require_authorized_fingerprint: true,
        }
    }

    pub fn revoke(&mut self, fingerprint: impl AsRef<str>) {
        self.revoked_fingerprints
            .insert(normalize_fingerprint(fingerprint.as_ref()));
    }
}

#[derive(Debug, Clone)]
pub struct SecureNetworkConfig {
    pub network: NetworkConfig,
    pub security: SecurityConfig,
    pub identity_policy: CertificateIdentityPolicy,
    pub capability_policy: CapabilityPolicy,
    pub replay_protection: Arc<StdMutex<ReplayProtection>>,
    pub server_name: Option<String>,
}

impl SecureNetworkConfig {
    pub fn new(
        network: NetworkConfig,
        security: SecurityConfig,
        identity_policy: CertificateIdentityPolicy,
        capability_policy: CapabilityPolicy,
    ) -> Self {
        let replay_protection = Arc::new(StdMutex::new(ReplayProtection::new(
            security.replay_window_seconds,
            security.max_clock_skew_seconds,
            100_000,
        )));
        Self {
            network,
            security,
            identity_policy,
            capability_policy,
            replay_protection,
            server_name: None,
        }
    }

    fn validate(&self, is_server: bool) -> RuntimeResult<()> {
        self.network.validate()?;
        match self.security.profile {
            SecurityProfile::Standard => {}
            SecurityProfile::HybridPq => {
                return Err(RuntimeError::new(
                    "security_profile_unavailable",
                    "hybrid-pq is unavailable in the rustls ring provider",
                ));
            }
            SecurityProfile::Research => {
                return Err(RuntimeError::new(
                    "security_profile_unavailable",
                    "research profile has no production TLS provider",
                ));
            }
            SecurityProfile::Local => {
                return Err(RuntimeError::new(
                    "tls_profile_required",
                    "TLS transport requires the standard profile",
                ));
            }
        }
        if self.identity_policy.trust_domain != self.security.trust_domain {
            return Err(RuntimeError::new(
                "trust_domain_mismatch",
                "identity policy trust domain must match security config",
            ));
        }
        if self.security.cert_path.is_some() != self.security.key_path.is_some() {
            return Err(RuntimeError::new(
                "certificate_key_mismatch",
                "cert_path and key_path must be configured together",
            ));
        }
        if is_server && self.security.cert_path.is_none() {
            return Err(RuntimeError::new(
                "server_certificate_missing",
                "TLS server requires a certificate and private key",
            ));
        }
        if !is_server && self.server_name.as_deref().unwrap_or("").is_empty() {
            return Err(RuntimeError::new(
                "server_name_required",
                "TLS client requires a server name for hostname verification",
            ));
        }
        if !is_server && self.security.require_mtls && self.security.cert_path.is_none() {
            return Err(RuntimeError::new(
                "client_certificate_missing",
                "mTLS client requires a certificate and private key",
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone)]
pub(crate) struct SecureSession {
    pub(crate) config: Arc<SecureNetworkConfig>,
    pub(crate) peer: PeerIdentity,
    pub(crate) tls_version: &'static str,
}

pub fn supported_crypto_capabilities() -> Value {
    json!({
        "runtime": "rust",
        "contracts_only": false,
        "provider": "rustls 0.23 / ring",
        "tls13_supported": true,
        "profiles_supported": ["local", "standard"],
        "profiles_recognized": ["local", "standard", "hybrid-pq", "research"],
        "digest_algorithms": ["sha256"],
        "signature_algorithms": ["ed25519"],
        "hybrid_pq_group": null,
        "hybrid_pq_supported": false
    })
}

pub fn certificate_fingerprint(certificate_der: &[u8]) -> String {
    format!("sha256:{}", hex::encode(Sha256::digest(certificate_der)))
}

fn normalize_fingerprint(value: &str) -> String {
    let compact = value
        .trim()
        .to_ascii_lowercase()
        .strip_prefix("sha256:")
        .unwrap_or(value.trim())
        .replace(':', "");
    format!("sha256:{compact}")
}

fn provider() -> Arc<rustls::crypto::CryptoProvider> {
    Arc::new(rustls::crypto::ring::default_provider())
}

fn load_certificates(path: &Path) -> RuntimeResult<Vec<CertificateDer<'static>>> {
    let file = File::open(path).map_err(|error| {
        RuntimeError::new(
            "certificate_read_failed",
            format!("failed to read certificate file: {error}"),
        )
    })?;
    let certificates = rustls_pemfile::certs(&mut BufReader::new(file))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| RuntimeError::new("certificate_invalid", error.to_string()))?;
    if certificates.is_empty() {
        return Err(RuntimeError::new(
            "certificate_invalid",
            "certificate file contains no certificates",
        ));
    }
    Ok(certificates)
}

fn load_private_key(path: &Path) -> RuntimeResult<PrivateKeyDer<'static>> {
    let file = File::open(path).map_err(|error| {
        RuntimeError::new(
            "private_key_read_failed",
            format!("failed to read private key file: {error}"),
        )
    })?;
    rustls_pemfile::private_key(&mut BufReader::new(file))
        .map_err(|error| RuntimeError::new("private_key_invalid", error.to_string()))?
        .ok_or_else(|| {
            RuntimeError::new(
                "private_key_invalid",
                "private key file contains no supported key",
            )
        })
}

fn load_root_store(path: Option<&str>, include_system: bool) -> RuntimeResult<RootCertStore> {
    let mut roots = RootCertStore::empty();
    if include_system {
        for certificate in rustls_native_certs::load_native_certs().certs {
            let _ = roots.add(certificate);
        }
    }
    if let Some(path) = path {
        for certificate in load_certificates(Path::new(path))? {
            roots
                .add(certificate)
                .map_err(|error| RuntimeError::new("trust_anchor_invalid", error.to_string()))?;
        }
    }
    if roots.is_empty() {
        return Err(RuntimeError::new(
            "trust_anchor_missing",
            "no usable TLS trust anchors are available",
        ));
    }
    Ok(roots)
}

fn build_client_config(config: &SecureNetworkConfig) -> RuntimeResult<ClientConfig> {
    config.validate(false)?;
    let roots = load_root_store(config.security.ca_cert_path.as_deref(), true)?;
    let builder = ClientConfig::builder_with_provider(provider())
        .with_protocol_versions(&[&rustls::version::TLS13])
        .map_err(|error| RuntimeError::new("tls_provider_error", error.to_string()))?
        .with_root_certificates(roots);
    match (&config.security.cert_path, &config.security.key_path) {
        (Some(cert_path), Some(key_path)) => builder
            .with_client_auth_cert(
                load_certificates(Path::new(cert_path))?,
                load_private_key(Path::new(key_path))?,
            )
            .map_err(|error| RuntimeError::new("certificate_invalid", error.to_string())),
        _ => Ok(builder.with_no_client_auth()),
    }
}

fn build_server_config(config: &SecureNetworkConfig) -> RuntimeResult<ServerConfig> {
    config.validate(true)?;
    let verifier = if config.security.require_mtls {
        let roots = load_root_store(config.security.ca_cert_path.as_deref(), false)?;
        WebPkiClientVerifier::builder_with_provider(Arc::new(roots), provider())
            .build()
            .map_err(|error| RuntimeError::new("trust_anchor_invalid", error.to_string()))?
    } else {
        WebPkiClientVerifier::no_client_auth()
    };
    ServerConfig::builder_with_provider(provider())
        .with_protocol_versions(&[&rustls::version::TLS13])
        .map_err(|error| RuntimeError::new("tls_provider_error", error.to_string()))?
        .with_client_cert_verifier(verifier)
        .with_single_cert(
            load_certificates(Path::new(
                config.security.cert_path.as_deref().unwrap_or(""),
            ))?,
            load_private_key(Path::new(config.security.key_path.as_deref().unwrap_or("")))?,
        )
        .map_err(|error| RuntimeError::new("certificate_invalid", error.to_string()))
}

fn authenticate_peer(
    certificate_der: &[u8],
    policy: &CertificateIdentityPolicy,
) -> RuntimeResult<PeerIdentity> {
    let (_, certificate) = parse_x509_certificate(certificate_der)
        .map_err(|error| RuntimeError::new("certificate_invalid", error.to_string()))?;
    if !certificate.validity().is_valid() {
        return Err(RuntimeError::new(
            "credential_expired",
            "TLS peer certificate is outside its validity period",
        ));
    }
    let issuer = certificate.issuer().to_string();
    if !policy.allowed_issuer_names.is_empty() && !policy.allowed_issuer_names.contains(&issuer) {
        return Err(RuntimeError::new(
            "issuer_not_allowed",
            format!("TLS peer certificate issuer is not allowed: {issuer}"),
        ));
    }
    let subject_alt_name = certificate
        .subject_alternative_name()
        .map_err(|error| RuntimeError::new("identity_san_invalid", error.to_string()))?
        .ok_or_else(|| {
            RuntimeError::new(
                "identity_san_invalid",
                "TLS peer certificate has no subject alternative name",
            )
        })?;
    let identity_uris: Vec<&str> = subject_alt_name
        .value
        .general_names
        .iter()
        .filter_map(|name| match name {
            GeneralName::URI(value) if value.starts_with("spiffe://") => Some(*value),
            _ => None,
        })
        .collect();
    if identity_uris.len() != 1 {
        return Err(RuntimeError::new(
            "identity_san_invalid",
            "TLS peer certificate must contain exactly one HK-CSP identity URI SAN",
        ));
    }
    let (peer_id, node_id, worker_id, trust_domain) = parse_identity_uri(identity_uris[0])?;
    if trust_domain != policy.trust_domain {
        return Err(RuntimeError::new(
            "trust_domain_mismatch",
            "TLS peer trust domain does not match local policy",
        ));
    }
    for (name, expected, actual) in [
        (
            "peer_id",
            policy.expected_peer_id.as_deref(),
            Some(peer_id.as_str()),
        ),
        (
            "node_id",
            policy.expected_node_id.as_deref(),
            Some(node_id.as_str()),
        ),
        (
            "worker_id",
            policy.expected_worker_id.as_deref(),
            worker_id.as_deref(),
        ),
    ] {
        if expected.is_some() && expected != actual {
            return Err(RuntimeError::new(
                "certificate_identity_mismatch",
                format!("certificate {name} does not match local policy"),
            ));
        }
    }
    let fingerprint = certificate_fingerprint(certificate_der);
    if policy
        .revoked_fingerprints
        .contains(&normalize_fingerprint(&fingerprint))
    {
        return Err(RuntimeError::new(
            "credential_revoked",
            "TLS peer credential is revoked by local policy",
        ));
    }
    let capabilities = policy
        .capabilities_by_fingerprint
        .get(&normalize_fingerprint(&fingerprint));
    if capabilities.is_none() && policy.require_authorized_fingerprint {
        return Err(RuntimeError::new(
            "credential_not_authorized",
            "TLS peer credential is not authorized by local policy",
        ));
    }
    Ok(PeerIdentity {
        peer_id,
        node_id,
        trust_domain,
        worker_id,
        credential_fingerprint: fingerprint,
        capabilities: capabilities.cloned().unwrap_or_default(),
        issued_at: certificate.validity().not_before.timestamp().max(0) as u64,
        expires_at: certificate.validity().not_after.timestamp().max(0) as u64,
    })
}

fn parse_identity_uri(value: &str) -> RuntimeResult<(String, String, Option<String>, String)> {
    let without_scheme = value.strip_prefix("spiffe://").ok_or_else(|| {
        RuntimeError::new("identity_san_invalid", "identity URI must use spiffe://")
    })?;
    if without_scheme.contains('%') || without_scheme.contains('?') || without_scheme.contains('#')
    {
        return Err(RuntimeError::new(
            "identity_san_invalid",
            "identity URI contains ambiguous encoding or components",
        ));
    }
    let parts: Vec<&str> = without_scheme.split('/').collect();
    if !matches!(parts.len(), 5 | 7)
        || parts[0].is_empty()
        || parts[1] != "peer"
        || parts[2].is_empty()
        || parts[3] != "node"
        || parts[4].is_empty()
        || (parts.len() == 7 && (parts[5] != "worker" || parts[6].is_empty()))
    {
        return Err(RuntimeError::new(
            "identity_san_invalid",
            "TLS peer identity URI SAN has an invalid format",
        ));
    }
    Ok((
        parts[2].to_string(),
        parts[4].to_string(),
        (parts.len() == 7).then(|| parts[6].to_string()),
        parts[0].to_ascii_lowercase(),
    ))
}

fn validate_declared_identity(
    authenticated: &PeerIdentity,
    declared: &PeerIdentity,
) -> RuntimeResult<()> {
    let mut actual_capabilities = authenticated.capabilities.clone();
    let mut declared_capabilities = declared.capabilities.clone();
    actual_capabilities.sort();
    declared_capabilities.sort();
    let mut mismatches = Vec::new();
    if authenticated.peer_id != declared.peer_id {
        mismatches.push("peer_id");
    }
    if authenticated.node_id != declared.node_id {
        mismatches.push("node_id");
    }
    if authenticated.worker_id != declared.worker_id {
        mismatches.push("worker_id");
    }
    if authenticated.trust_domain != declared.trust_domain {
        mismatches.push("trust_domain");
    }
    if authenticated.credential_fingerprint
        != normalize_fingerprint(&declared.credential_fingerprint)
    {
        mismatches.push("credential_fingerprint");
    }
    if actual_capabilities != declared_capabilities {
        mismatches.push("capabilities");
    }
    if authenticated.issued_at != declared.issued_at {
        mismatches.push("issued_at");
    }
    if authenticated.expires_at != declared.expires_at {
        mismatches.push("expires_at");
    }
    if mismatches.is_empty() {
        Ok(())
    } else {
        Err(RuntimeError::new(
            "declared_identity_mismatch",
            format!(
                "declared peer identity fields do not match certificate: {}",
                mismatches.join(",")
            ),
        ))
    }
}

pub(crate) fn validate_secure_envelope(
    envelope: &MessageEnvelope,
    session: &SecureSession,
) -> RuntimeResult<()> {
    let declared: PeerIdentity =
        serde_json::from_value(envelope.metadata.get("peer_identity").cloned().ok_or_else(
            || {
                RuntimeError::new(
                    "declared_identity_missing",
                    "secure envelope requires peer_identity",
                )
            },
        )?)
        .map_err(|error| RuntimeError::new("declared_identity_invalid", error.to_string()))?;
    validate_declared_identity(&session.peer, &declared)?;
    if envelope.source != session.peer.peer_id {
        return Err(RuntimeError::new(
            "declared_identity_mismatch",
            "envelope source does not match authenticated peer_id",
        ));
    }
    let nonce = envelope
        .metadata
        .get("security_nonce")
        .and_then(Value::as_str)
        .filter(|nonce| !nonce.is_empty() && nonce.len() <= 256)
        .ok_or_else(|| {
            RuntimeError::new(
                "security_nonce_missing",
                "secure envelope requires a bounded security_nonce",
            )
        })?;
    let created_at = chrono::DateTime::parse_from_rfc3339(&envelope.created_at)
        .map_err(|error| RuntimeError::new("invalid_timestamp", error.to_string()))?
        .timestamp();
    if created_at < 0 {
        return Err(RuntimeError::new(
            "invalid_timestamp",
            "created_at predates the Unix epoch",
        ));
    }
    let scope = format!(
        "{}|{}",
        session.peer.credential_fingerprint, envelope.session_id
    );
    let replay_result = session
        .config
        .replay_protection
        .lock()
        .map_err(|_| {
            RuntimeError::new("replay_state_unavailable", "replay state lock is poisoned")
        })?
        .check_and_record(
            &scope,
            envelope.sequence,
            Some(nonce),
            Some(created_at as u64),
        );
    if let Err(error) = replay_result {
        return Err(RuntimeError::new(error.code, error.message));
    }
    let operation = envelope
        .metadata
        .get("operation")
        .and_then(Value::as_str)
        .filter(|operation| !operation.is_empty())
        .ok_or_else(|| {
            RuntimeError::new("operation_missing", "secure envelope requires an operation")
        })?;
    if !session
        .config
        .capability_policy
        .is_operation_authorized(operation, Some(&session.peer))
    {
        return Err(RuntimeError::new(
            "authorization_denied",
            "authenticated peer is not authorized for operation",
        ));
    }
    Ok(())
}

fn map_tls_error(error: impl std::fmt::Display) -> RuntimeError {
    let message = error.to_string();
    let lower = message.to_ascii_lowercase();
    let code = if lower.contains("not valid for name") || lower.contains("notvalidforname") {
        "hostname_mismatch"
    } else if lower.contains("expired") || lower.contains("not valid yet") {
        "credential_expired"
    } else if lower.contains("unknownissuer") || lower.contains("unknown issuer") {
        "unknown_ca"
    } else if lower.contains("certificate required") || lower.contains("no certificates") {
        "client_certificate_missing"
    } else {
        "tls_handshake_failed"
    };
    RuntimeError::new(code, format!("TLS handshake failed: {message}"))
}

impl TcpTransport {
    pub async fn connect_tls(address: &str, config: &SecureNetworkConfig) -> RuntimeResult<Self> {
        config.validate(false)?;
        let stream =
            tokio::time::timeout(config.network.connect_timeout, TcpStream::connect(address))
                .await
                .map_err(|_| RuntimeError::retryable("connect_timeout", "TCP connect timed out"))?
                .map_err(|error| RuntimeError::retryable("connect_failed", error.to_string()))?;
        stream
            .set_nodelay(true)
            .map_err(|error| RuntimeError::new("socket_config", error.to_string()))?;
        let server_name = ServerName::try_from(config.server_name.clone().unwrap_or_default())
            .map_err(|error| RuntimeError::new("server_name_invalid", error.to_string()))?;
        let connector = TlsConnector::from(Arc::new(build_client_config(config)?));
        let stream = tokio::time::timeout(
            config.network.connect_timeout,
            connector.connect(server_name, stream),
        )
        .await
        .map_err(|_| RuntimeError::retryable("connect_timeout", "TLS handshake timed out"))?
        .map_err(map_tls_error)?;
        if stream.get_ref().1.protocol_version() != Some(rustls::ProtocolVersion::TLSv1_3) {
            return Err(RuntimeError::new(
                "tls_version_mismatch",
                "TLS transport did not negotiate TLS 1.3",
            ));
        }
        let peer_certificate = stream
            .get_ref()
            .1
            .peer_certificates()
            .and_then(|certificates| certificates.first())
            .ok_or_else(|| {
                RuntimeError::new("peer_certificate_missing", "TLS server sent no certificate")
            })?;
        let peer = authenticate_peer(peer_certificate.as_ref(), &config.identity_policy)?;
        let peer_address = stream
            .get_ref()
            .0
            .peer_addr()
            .map(|address| address.to_string())
            .unwrap_or_else(|_| "unknown".to_string());
        let (reader, writer) = tokio::io::split(stream);
        Ok(Self {
            inner: LengthDelimitedTransport::new_secure(
                reader,
                writer,
                config.network,
                format!("tls:{peer_address}"),
                SecureSession {
                    config: Arc::new(config.clone()),
                    peer,
                    tls_version: "TLSv1.3",
                },
            )?,
        })
    }
}

pub struct TlsTcpListener {
    listener: TcpListener,
    acceptor: TlsAcceptor,
    config: Arc<SecureNetworkConfig>,
}

impl TlsTcpListener {
    pub async fn bind(address: &str, config: SecureNetworkConfig) -> RuntimeResult<Self> {
        config.validate(true)?;
        let parsed: SocketAddr = address.parse().map_err(|error: std::net::AddrParseError| {
            RuntimeError::new("listen_address_invalid", error.to_string())
        })?;
        config
            .security
            .validate_listen_address(&parsed.ip().to_string())?;
        let server_config = build_server_config(&config)?;
        let listener = TcpListener::bind(parsed)
            .await
            .map_err(|error| RuntimeError::new("listen_failed", error.to_string()))?;
        Ok(Self {
            listener,
            acceptor: TlsAcceptor::from(Arc::new(server_config)),
            config: Arc::new(config),
        })
    }

    pub fn local_addr(&self) -> RuntimeResult<SocketAddr> {
        self.listener
            .local_addr()
            .map_err(|error| RuntimeError::new("listen_address", error.to_string()))
    }

    pub async fn accept(&self) -> RuntimeResult<TcpTransport> {
        let (stream, address) = self
            .listener
            .accept()
            .await
            .map_err(|error| RuntimeError::new("accept_failed", error.to_string()))?;
        let stream = tokio::time::timeout(
            self.config.network.connect_timeout,
            self.acceptor.accept(stream),
        )
        .await
        .map_err(|_| RuntimeError::retryable("connect_timeout", "TLS handshake timed out"))?
        .map_err(map_tls_error)?;
        if stream.get_ref().1.protocol_version() != Some(rustls::ProtocolVersion::TLSv1_3) {
            return Err(RuntimeError::new(
                "tls_version_mismatch",
                "TLS transport did not negotiate TLS 1.3",
            ));
        }
        let peer_certificate = stream
            .get_ref()
            .1
            .peer_certificates()
            .and_then(|certificates| certificates.first())
            .ok_or_else(|| {
                RuntimeError::new("peer_certificate_missing", "TLS client sent no certificate")
            })?;
        let peer = authenticate_peer(peer_certificate.as_ref(), &self.config.identity_policy)?;
        let (reader, writer) = tokio::io::split(stream);
        Ok(TcpTransport {
            inner: LengthDelimitedTransport::new_secure(
                reader,
                writer,
                self.config.network,
                format!("tls:{address}"),
                SecureSession {
                    config: self.config.clone(),
                    peer,
                    tls_version: "TLSv1.3",
                },
            )?,
        })
    }
}
