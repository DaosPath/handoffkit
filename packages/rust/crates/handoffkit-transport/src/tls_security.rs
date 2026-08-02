use super::{
    DurableRevocationPolicy, LengthDelimitedTransport, NetworkConfig, RevocationKind, TcpTransport,
};
use handoffkit_protocol::security::{
    build_security_transcript, verify_security_transcript, CapabilityPolicy, PeerIdentity,
    ReplayContext, ReplayProtection, SecurityConfig, SecurityProfile, SecurityTranscriptInput,
};
use handoffkit_protocol::{EdgeRuntimeProfile, MessageEnvelope};
use handoffkit_runtime::{RuntimeError, RuntimeResult};
use rustls::pki_types::{CertificateDer, PrivateKeyDer, ServerName};
use rustls::server::WebPkiClientVerifier;
use rustls::{ClientConfig, RootCertStore, ServerConfig};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::BufReader;
use std::net::SocketAddr;
use std::path::Path;
use std::sync::{Arc, Mutex as StdMutex, RwLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
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
    pub revocation_policy: Option<DurableRevocationPolicy>,
    pub rotation_policy: Option<CredentialRotationPolicy>,
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
            revocation_policy: None,
            rotation_policy: None,
        }
    }

    pub fn revoke(&mut self, fingerprint: impl AsRef<str>) {
        self.revoked_fingerprints
            .insert(normalize_fingerprint(fingerprint.as_ref()));
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CredentialRotationStatus {
    pub current_fingerprint: String,
    pub previous_fingerprint: Option<String>,
    pub transition_until: u64,
    pub previous_accepted: bool,
}

#[derive(Debug)]
struct CredentialRotationState {
    current: String,
    previous: Option<String>,
    transition_until: u64,
}

#[derive(Debug, Clone)]
pub struct CredentialRotationPolicy {
    state: Arc<RwLock<CredentialRotationState>>,
    max_clock_skew_seconds: u64,
}

impl CredentialRotationPolicy {
    pub fn new(
        current_fingerprint: impl AsRef<str>,
        max_clock_skew_seconds: u64,
    ) -> RuntimeResult<Self> {
        if current_fingerprint.as_ref().trim().is_empty() {
            return Err(RuntimeError::new(
                "credential_rotation_invalid",
                "current fingerprint must not be empty",
            ));
        }
        Ok(Self {
            state: Arc::new(RwLock::new(CredentialRotationState {
                current: normalize_fingerprint(current_fingerprint.as_ref()),
                previous: None,
                transition_until: 0,
            })),
            max_clock_skew_seconds,
        })
    }

    pub fn rotate(
        &self,
        new_fingerprint: impl AsRef<str>,
        transition_until: u64,
    ) -> RuntimeResult<()> {
        if new_fingerprint.as_ref().trim().is_empty() {
            return Err(RuntimeError::new(
                "credential_rotation_invalid",
                "new fingerprint must not be empty",
            ));
        }
        let mut state = self.state.write().map_err(|_| {
            RuntimeError::new(
                "credential_rotation_unavailable",
                "credential rotation lock is poisoned",
            )
        })?;
        state.previous = Some(state.current.clone());
        state.current = normalize_fingerprint(new_fingerprint.as_ref());
        state.transition_until = transition_until;
        Ok(())
    }

    pub fn is_allowed(&self, fingerprint: &str, now: u64) -> RuntimeResult<bool> {
        let timestamp = if now == 0 { unix_now() } else { now };
        let normalized = normalize_fingerprint(fingerprint);
        let state = self.state.read().map_err(|_| {
            RuntimeError::new(
                "credential_rotation_unavailable",
                "credential rotation lock is poisoned",
            )
        })?;
        Ok(normalized == state.current
            || (state.previous.as_deref() == Some(normalized.as_str())
                && timestamp
                    <= state
                        .transition_until
                        .saturating_add(self.max_clock_skew_seconds)))
    }

    pub fn set_transition_until(&self, transition_until: u64) -> RuntimeResult<()> {
        self.state
            .write()
            .map_err(|_| {
                RuntimeError::new(
                    "credential_rotation_unavailable",
                    "credential rotation lock is poisoned",
                )
            })?
            .transition_until = transition_until;
        Ok(())
    }

    pub fn status(&self, now: u64) -> RuntimeResult<CredentialRotationStatus> {
        let timestamp = if now == 0 { unix_now() } else { now };
        let state = self.state.read().map_err(|_| {
            RuntimeError::new(
                "credential_rotation_unavailable",
                "credential rotation lock is poisoned",
            )
        })?;
        Ok(CredentialRotationStatus {
            current_fingerprint: state.current.clone(),
            previous_fingerprint: state.previous.clone(),
            transition_until: state.transition_until,
            previous_accepted: state.previous.is_some()
                && timestamp
                    <= state
                        .transition_until
                        .saturating_add(self.max_clock_skew_seconds),
        })
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
    pub tls_provider: Option<ReloadableTlsConfig>,
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
            tls_provider: None,
        }
    }

    pub fn for_edge_profile(
        profile: &EdgeRuntimeProfile,
        security: SecurityConfig,
        identity_policy: CertificateIdentityPolicy,
        capability_policy: CapabilityPolicy,
    ) -> RuntimeResult<Self> {
        profile
            .validate()
            .map_err(|error| RuntimeError::new("edge_profile_invalid", error.to_string()))?;
        if profile.security_profile != "standard" || security.profile != SecurityProfile::Standard {
            return Err(RuntimeError::new(
                "edge_security_profile_mismatch",
                "edge runtime profiles require the exact standard security profile",
            ));
        }
        Ok(Self::new(
            NetworkConfig::from_edge_profile(profile)?,
            security,
            identity_policy,
            capability_policy,
        ))
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
    pub(crate) local_identity: Option<PeerIdentity>,
    pub(crate) tls_version: &'static str,
    pub(crate) negotiated_group: Option<String>,
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TlsReloadStatus {
    pub generation: u64,
    pub role: &'static str,
    pub security_profile: SecurityProfile,
    pub current_fingerprint: Option<String>,
    pub previous_fingerprint: Option<String>,
    pub transition_until: u64,
    pub previous_accepted: bool,
    pub trust_anchor_hash: Option<String>,
    pub previous_trust_anchor_hash: Option<String>,
    pub certificate_expires_at: u64,
    pub provider: &'static str,
}

enum ReloadableTlsSnapshot {
    Client(Arc<ClientConfig>),
    Server(Arc<ServerConfig>),
}

struct ReloadableTlsState {
    current: ReloadableTlsSnapshot,
    current_fingerprint: Option<String>,
    previous_fingerprint: Option<String>,
    trust_anchor_hash: Option<String>,
    previous_trust_anchor_hash: Option<String>,
    certificate_expires_at: u64,
    current_identity: Option<PeerIdentity>,
    transition_until: u64,
    generation: u64,
}

#[derive(Clone)]
pub struct ReloadableTlsConfig {
    state: Arc<RwLock<ReloadableTlsState>>,
    is_server: bool,
    profile: SecurityProfile,
    trust_domain: String,
}

impl std::fmt::Debug for ReloadableTlsConfig {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ReloadableTlsConfig")
            .field("is_server", &self.is_server)
            .field("profile", &self.profile)
            .field("trust_domain", &self.trust_domain)
            .finish_non_exhaustive()
    }
}

impl ReloadableTlsConfig {
    pub fn new(config: &SecureNetworkConfig, is_server: bool) -> RuntimeResult<Self> {
        let current = if is_server {
            ReloadableTlsSnapshot::Server(Arc::new(build_server_config(config)?))
        } else {
            ReloadableTlsSnapshot::Client(Arc::new(build_client_config(config)?))
        };
        let (fingerprint, certificate_expires_at, current_identity) =
            certificate_metadata(config.security.cert_path.as_deref())?;
        let trust_anchor_hash = file_sha256(config.security.ca_cert_path.as_deref())?;
        Ok(Self {
            state: Arc::new(RwLock::new(ReloadableTlsState {
                current,
                current_fingerprint: fingerprint,
                previous_fingerprint: None,
                trust_anchor_hash,
                previous_trust_anchor_hash: None,
                certificate_expires_at,
                current_identity,
                transition_until: 0,
                generation: 1,
            })),
            is_server,
            profile: config.security.profile,
            trust_domain: config.security.trust_domain.clone(),
        })
    }

    pub fn client_config(&self) -> RuntimeResult<Arc<ClientConfig>> {
        self.client_snapshot().map(|(config, _)| config)
    }

    pub fn client_snapshot(&self) -> RuntimeResult<(Arc<ClientConfig>, Option<PeerIdentity>)> {
        if self.is_server {
            return Err(RuntimeError::new(
                "tls_reload_role_mismatch",
                "TLS reload provider role does not match transport role",
            ));
        }
        let state = self.state.read().map_err(tls_reload_lock_error)?;
        match &state.current {
            ReloadableTlsSnapshot::Client(config) => {
                Ok((config.clone(), state.current_identity.clone()))
            }
            ReloadableTlsSnapshot::Server(_) => unreachable!(),
        }
    }

    pub fn server_config(&self) -> RuntimeResult<Arc<ServerConfig>> {
        self.server_snapshot().map(|(config, _)| config)
    }

    pub fn server_snapshot(&self) -> RuntimeResult<(Arc<ServerConfig>, Option<PeerIdentity>)> {
        if !self.is_server {
            return Err(RuntimeError::new(
                "tls_reload_role_mismatch",
                "TLS reload provider role does not match transport role",
            ));
        }
        let state = self.state.read().map_err(tls_reload_lock_error)?;
        match &state.current {
            ReloadableTlsSnapshot::Server(config) => {
                Ok((config.clone(), state.current_identity.clone()))
            }
            ReloadableTlsSnapshot::Client(_) => unreachable!(),
        }
    }

    pub fn reload(
        &self,
        config: &SecureNetworkConfig,
        transition: Duration,
        now: u64,
    ) -> RuntimeResult<TlsReloadStatus> {
        if config.security.profile != self.profile
            || config.security.trust_domain != self.trust_domain
        {
            return Err(RuntimeError::new(
                "tls_reload_policy_mismatch",
                "TLS reload cannot change security profile or trust domain",
            ));
        }
        let candidate = if self.is_server {
            ReloadableTlsSnapshot::Server(Arc::new(build_server_config(config)?))
        } else {
            ReloadableTlsSnapshot::Client(Arc::new(build_client_config(config)?))
        };
        let (fingerprint, certificate_expires_at, current_identity) =
            certificate_metadata(config.security.cert_path.as_deref())?;
        let trust_anchor_hash = file_sha256(config.security.ca_cert_path.as_deref())?;
        let timestamp = if now == 0 { unix_now() } else { now };
        {
            let mut state = self.state.write().map_err(tls_reload_lock_error)?;
            state.previous_fingerprint = state.current_fingerprint.clone();
            state.previous_trust_anchor_hash = state.trust_anchor_hash.clone();
            state.current = candidate;
            state.current_fingerprint = fingerprint;
            state.trust_anchor_hash = trust_anchor_hash;
            state.certificate_expires_at = certificate_expires_at;
            state.current_identity = current_identity;
            state.transition_until = timestamp.saturating_add(transition.as_secs());
            state.generation = state.generation.saturating_add(1);
        }
        self.status(timestamp)
    }

    pub fn status(&self, now: u64) -> RuntimeResult<TlsReloadStatus> {
        let timestamp = if now == 0 { unix_now() } else { now };
        let state = self.state.read().map_err(tls_reload_lock_error)?;
        Ok(TlsReloadStatus {
            generation: state.generation,
            role: if self.is_server { "server" } else { "client" },
            security_profile: self.profile,
            current_fingerprint: state.current_fingerprint.clone(),
            previous_fingerprint: state.previous_fingerprint.clone(),
            transition_until: state.transition_until,
            previous_accepted: state.previous_fingerprint.is_some()
                && timestamp <= state.transition_until,
            trust_anchor_hash: state.trust_anchor_hash.clone(),
            previous_trust_anchor_hash: state.previous_trust_anchor_hash.clone(),
            certificate_expires_at: state.certificate_expires_at,
            provider: "rustls 0.23 / ring",
        })
    }
}

fn tls_reload_lock_error<T>(_error: std::sync::PoisonError<T>) -> RuntimeError {
    RuntimeError::new(
        "tls_reload_unavailable",
        "TLS reload state lock is poisoned",
    )
}

fn certificate_metadata(
    path: Option<&str>,
) -> RuntimeResult<(Option<String>, u64, Option<PeerIdentity>)> {
    let Some(path) = path else {
        return Ok((None, 0, None));
    };
    let certificate = load_certificates(Path::new(path))?
        .into_iter()
        .next()
        .ok_or_else(|| RuntimeError::new("certificate_invalid", "certificate is empty"))?;
    let (_, parsed) = parse_x509_certificate(certificate.as_ref())
        .map_err(|error| RuntimeError::new("certificate_invalid", error.to_string()))?;
    let identity = peer_identity_from_certificate(certificate.as_ref(), Vec::new())?;
    Ok((
        Some(certificate_fingerprint(certificate.as_ref())),
        parsed.validity().not_after.timestamp().max(0) as u64,
        Some(identity),
    ))
}

fn file_sha256(path: Option<&str>) -> RuntimeResult<Option<String>> {
    let Some(path) = path else {
        return Ok(None);
    };
    let data = fs::read(path).map_err(|error| {
        RuntimeError::new(
            "trust_anchor_read_failed",
            format!("failed to read trust anchor file: {error}"),
        )
    })?;
    Ok(Some(format!(
        "sha256:{}",
        hex::encode(Sha256::digest(data))
    )))
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn peer_identity_from_certificate(
    certificate_der: &[u8],
    capabilities: Vec<String>,
) -> RuntimeResult<PeerIdentity> {
    let (_, certificate) = parse_x509_certificate(certificate_der)
        .map_err(|error| RuntimeError::new("certificate_invalid", error.to_string()))?;
    let subject_alt_name = certificate
        .subject_alternative_name()
        .map_err(|error| RuntimeError::new("identity_san_invalid", error.to_string()))?
        .ok_or_else(|| {
            RuntimeError::new(
                "identity_san_invalid",
                "TLS certificate has no subject alternative name",
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
            "TLS certificate must contain exactly one HK-CSP identity URI SAN",
        ));
    }
    let (peer_id, node_id, worker_id, trust_domain) = parse_identity_uri(identity_uris[0])?;
    Ok(PeerIdentity {
        peer_id,
        node_id,
        trust_domain,
        worker_id,
        credential_fingerprint: certificate_fingerprint(certificate_der),
        capabilities,
        issued_at: certificate.validity().not_before.timestamp().max(0) as u64,
        expires_at: certificate.validity().not_after.timestamp().max(0) as u64,
    })
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
    let mut durable_revoked = false;
    if let Some(revocations) = &policy.revocation_policy {
        for (kind, value) in [
            (RevocationKind::CertificateFingerprint, fingerprint.as_str()),
            (RevocationKind::PeerId, peer_id.as_str()),
            (RevocationKind::Issuer, issuer.as_str()),
            (RevocationKind::TrustDomain, trust_domain.as_str()),
        ] {
            if revocations.is_revoked(kind, value, 0)? {
                durable_revoked = true;
                break;
            }
        }
    }
    if durable_revoked
        || policy
            .revoked_fingerprints
            .contains(&normalize_fingerprint(&fingerprint))
    {
        return Err(RuntimeError::new(
            "credential_revoked",
            "TLS peer credential is revoked by local policy",
        ));
    }
    if let Some(rotation) = &policy.rotation_policy {
        if !rotation.is_allowed(&fingerprint, unix_now())? {
            return Err(RuntimeError::new(
                "credential_rotation_rejected",
                "TLS peer credential is outside the configured rotation window",
            ));
        }
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

pub(crate) fn attach_security_transcript(
    envelope: &MessageEnvelope,
    session: &SecureSession,
) -> RuntimeResult<MessageEnvelope> {
    let Some(local_identity) = &session.local_identity else {
        return Ok(envelope.clone());
    };
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
    let mut sender = local_identity.clone();
    sender.capabilities = declared.capabilities;
    let transcript = build_security_transcript(SecurityTranscriptInput {
        protocol_version: &envelope.protocol_version,
        requested_profile: session.config.security.profile,
        selected_profile: session.config.security.profile,
        sender: &sender,
        receiver: &session.peer,
        tls_version: session.tls_version,
        negotiated_group: session.negotiated_group.as_deref(),
        session_id: &envelope.session_id,
        handshake_nonce: nonce,
        timestamp: &envelope.created_at,
    })
    .map_err(|error| RuntimeError::new(error.code, error.message))?;
    let mut secured = envelope.clone();
    secured.metadata.insert(
        "security_transcript".to_string(),
        serde_json::to_value(transcript)
            .map_err(|error| RuntimeError::new("security_transcript_invalid", error.to_string()))?,
    );
    Ok(secured)
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
    let local_identity = session.local_identity.as_ref().ok_or_else(|| {
        RuntimeError::new(
            "security_transcript_unavailable",
            "secure transcript requires authenticated TLS endpoints",
        )
    })?;
    let transcript = envelope
        .metadata
        .get("security_transcript")
        .cloned()
        .ok_or_else(|| {
            RuntimeError::new(
                "security_transcript_missing",
                "secure envelope requires an authenticated security_transcript extension",
            )
        })?;
    verify_security_transcript(
        transcript,
        SecurityTranscriptInput {
            protocol_version: &envelope.protocol_version,
            requested_profile: session.config.security.profile,
            selected_profile: session.config.security.profile,
            sender: &session.peer,
            receiver: local_identity,
            tls_version: session.tls_version,
            negotiated_group: session.negotiated_group.as_deref(),
            session_id: &envelope.session_id,
            handshake_nonce: nonce,
            timestamp: &envelope.created_at,
        },
    )
    .map_err(|error| RuntimeError::new(error.code, error.message))?;
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
        .check_and_record_context(
            &scope,
            envelope.sequence,
            Some(nonce),
            Some(created_at as u64),
            Some(&ReplayContext {
                peer_id: session.peer.peer_id.clone(),
                session_id: envelope.session_id.clone(),
                credential_fingerprint: session.peer.credential_fingerprint.clone(),
                security_profile: session.config.security.profile.as_str().to_string(),
            }),
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
        let (client_config, local_identity) = match &config.tls_provider {
            Some(provider) => provider.client_snapshot()?,
            None => (
                Arc::new(build_client_config(config)?),
                certificate_metadata(config.security.cert_path.as_deref())?.2,
            ),
        };
        let connector = TlsConnector::from(client_config);
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
                    local_identity,
                    tls_version: "TLSv1.3",
                    negotiated_group: None,
                },
            )?,
        })
    }
}

pub struct TlsTcpListener {
    listener: TcpListener,
    server_config: Arc<ServerConfig>,
    local_identity: Option<PeerIdentity>,
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
        let (server_config, local_identity) = match &config.tls_provider {
            Some(provider) => provider.server_snapshot()?,
            None => (
                Arc::new(build_server_config(&config)?),
                certificate_metadata(config.security.cert_path.as_deref())?.2,
            ),
        };
        let listener = TcpListener::bind(parsed)
            .await
            .map_err(|error| RuntimeError::new("listen_failed", error.to_string()))?;
        Ok(Self {
            listener,
            server_config,
            local_identity,
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
        let (current_server_config, local_identity) = match &self.config.tls_provider {
            Some(provider) => provider.server_snapshot()?,
            None => (self.server_config.clone(), self.local_identity.clone()),
        };
        let stream = tokio::time::timeout(
            self.config.network.connect_timeout,
            TlsAcceptor::from(current_server_config).accept(stream),
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
                    local_identity,
                    tls_version: "TLSv1.3",
                    negotiated_group: None,
                },
            )?,
        })
    }
}
