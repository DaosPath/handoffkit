use handoffkit_runtime::{RuntimeError, RuntimeResult};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
#[cfg(unix)]
use std::fs::File;
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

pub const DURABLE_REVOCATION_FORMAT_VERSION: u32 = 1;
pub const DURABLE_REVOCATION_FORMAT: &str = "handoffkit.security.revocations";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum RevocationKind {
    CertificateFingerprint,
    SignerFingerprint,
    PeerId,
    Issuer,
    TrustDomain,
}

impl RevocationKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::CertificateFingerprint => "certificate_fingerprint",
            Self::SignerFingerprint => "signer_fingerprint",
            Self::PeerId => "peer_id",
            Self::Issuer => "issuer",
            Self::TrustDomain => "trust_domain",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RevocationEntry {
    pub effective_at: u64,
    pub expires_at: u64,
    pub kind: RevocationKind,
    pub reason: String,
    pub revoked_at: u64,
    pub value: String,
}

impl RevocationEntry {
    pub fn new(
        kind: RevocationKind,
        value: impl Into<String>,
        reason: impl Into<String>,
        revoked_at: u64,
        effective_at: Option<u64>,
        expires_at: u64,
    ) -> RuntimeResult<Self> {
        let mut entry = Self {
            effective_at: effective_at.unwrap_or(revoked_at),
            expires_at,
            kind,
            reason: reason.into(),
            revoked_at,
            value: value.into(),
        };
        entry.normalize_and_validate()?;
        Ok(entry)
    }

    fn normalize_and_validate(&mut self) -> RuntimeResult<()> {
        self.value = normalize_revocation_value(self.kind, &self.value)?;
        self.reason = self.reason.trim().to_string();
        if self.reason.is_empty() {
            return Err(RuntimeError::new(
                "revocation_entry_invalid",
                "revocation reason must not be empty",
            ));
        }
        if self.expires_at > 0 && self.expires_at <= self.effective_at {
            return Err(RuntimeError::new(
                "revocation_entry_invalid",
                "expires_at must be later than effective_at",
            ));
        }
        Ok(())
    }
}

pub fn normalize_revocation_value(kind: RevocationKind, value: &str) -> RuntimeResult<String> {
    let mut normalized = value.trim().to_string();
    if normalized.is_empty() {
        return Err(RuntimeError::new(
            "revocation_entry_invalid",
            "revocation value must not be empty",
        ));
    }
    match kind {
        RevocationKind::CertificateFingerprint | RevocationKind::SignerFingerprint => {
            normalized = normalized.to_ascii_lowercase().replace(':', "");
            if let Some(value) = normalized.strip_prefix("sha256") {
                normalized = value.to_string();
            }
            if normalized.len() != 64 || !normalized.bytes().all(|byte| byte.is_ascii_hexdigit()) {
                return Err(RuntimeError::new(
                    "revocation_entry_invalid",
                    "revocation fingerprint must be a SHA-256 fingerprint",
                ));
            }
            Ok(format!("sha256:{normalized}"))
        }
        RevocationKind::TrustDomain => Ok(normalized.to_ascii_lowercase()),
        RevocationKind::PeerId | RevocationKind::Issuer => Ok(normalized),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DurableRevocationOptions {
    pub max_entries: usize,
    pub max_file_bytes: u64,
}

impl Default for DurableRevocationOptions {
    fn default() -> Self {
        Self {
            max_entries: 10_000,
            max_file_bytes: 4 * 1024 * 1024,
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct DurableRevocationStatus {
    pub active: usize,
    pub entries: usize,
    pub format: &'static str,
    pub format_version: u32,
    pub generation: u64,
}

#[derive(Debug, Serialize)]
struct RevocationPayload<'a> {
    entries: &'a [RevocationEntry],
    format: &'a str,
    format_version: u32,
    generation: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct RevocationEnvelope {
    checksum: String,
    entries: Vec<RevocationEntry>,
    format: String,
    format_version: u32,
    generation: u64,
}

#[derive(Debug)]
struct RevocationState {
    generation: u64,
    entries: BTreeMap<String, RevocationEntry>,
}

#[derive(Debug, Clone)]
pub struct DurableRevocationPolicy {
    path: PathBuf,
    options: DurableRevocationOptions,
    state: Arc<RwLock<RevocationState>>,
}

impl DurableRevocationPolicy {
    pub fn open(
        path: impl Into<PathBuf>,
        options: DurableRevocationOptions,
    ) -> RuntimeResult<Self> {
        if options.max_entries == 0 || options.max_file_bytes < 1024 {
            return Err(RuntimeError::new(
                "revocation_state_bounds_invalid",
                "durable revocation bounds are invalid",
            ));
        }
        let policy = Self {
            path: path.into(),
            options,
            state: Arc::new(RwLock::new(RevocationState {
                generation: 0,
                entries: BTreeMap::new(),
            })),
        };
        policy.reload()?;
        Ok(policy)
    }

    pub fn revoke(&self, mut entry: RevocationEntry) -> RuntimeResult<()> {
        entry.normalize_and_validate()?;
        let mut state = self
            .state
            .write()
            .map_err(|_| lock_error("revocation state lock is poisoned"))?;
        let mut entries = state.entries.clone();
        entries.insert(entry_key(entry.kind, &entry.value), entry);
        if entries.len() > self.options.max_entries {
            return Err(RuntimeError::new(
                "revocation_state_capacity",
                "durable revocation capacity is exhausted",
            ));
        }
        let generation = state.generation.saturating_add(1);
        match self.persist(&entries, generation) {
            Ok(()) => {}
            Err(error) if error.code == "revocation_state_durability_uncertain" => {
                state.entries = entries;
                state.generation = generation;
                return Err(error);
            }
            Err(error) => return Err(error),
        }
        state.entries = entries;
        state.generation = generation;
        Ok(())
    }

    pub fn remove(&self, kind: RevocationKind, value: &str) -> RuntimeResult<bool> {
        let value = normalize_revocation_value(kind, value)?;
        let mut state = self
            .state
            .write()
            .map_err(|_| lock_error("revocation state lock is poisoned"))?;
        let key = entry_key(kind, &value);
        if !state.entries.contains_key(&key) {
            return Ok(false);
        }
        let mut entries = state.entries.clone();
        entries.remove(&key);
        let generation = state.generation.saturating_add(1);
        self.persist(&entries, generation)?;
        state.entries = entries;
        state.generation = generation;
        Ok(true)
    }

    pub fn is_revoked(&self, kind: RevocationKind, value: &str, now: u64) -> RuntimeResult<bool> {
        let value = normalize_revocation_value(kind, value)?;
        let now = if now == 0 { unix_now() } else { now };
        let state = self
            .state
            .read()
            .map_err(|_| lock_error("revocation state lock is poisoned"))?;
        Ok(state
            .entries
            .get(&entry_key(kind, &value))
            .is_some_and(|entry| {
                entry.effective_at <= now && (entry.expires_at == 0 || now < entry.expires_at)
            }))
    }

    pub fn status(&self, now: u64) -> RuntimeResult<DurableRevocationStatus> {
        let now = if now == 0 { unix_now() } else { now };
        let state = self
            .state
            .read()
            .map_err(|_| lock_error("revocation state lock is poisoned"))?;
        let active = state
            .entries
            .values()
            .filter(|entry| {
                entry.effective_at <= now && (entry.expires_at == 0 || now < entry.expires_at)
            })
            .count();
        Ok(DurableRevocationStatus {
            active,
            entries: state.entries.len(),
            format: DURABLE_REVOCATION_FORMAT,
            format_version: DURABLE_REVOCATION_FORMAT_VERSION,
            generation: state.generation,
        })
    }

    pub fn reload(&self) -> RuntimeResult<()> {
        let (entries, generation) = self.load()?;
        let mut state = self
            .state
            .write()
            .map_err(|_| lock_error("revocation state lock is poisoned"))?;
        state.entries = entries;
        state.generation = generation;
        Ok(())
    }

    fn persist(
        &self,
        entries: &BTreeMap<String, RevocationEntry>,
        generation: u64,
    ) -> RuntimeResult<()> {
        let sorted: Vec<_> = entries.values().cloned().collect();
        let payload = RevocationPayload {
            entries: &sorted,
            format: DURABLE_REVOCATION_FORMAT,
            format_version: DURABLE_REVOCATION_FORMAT_VERSION,
            generation,
        };
        let canonical = serde_json::to_vec(&payload).map_err(|_| {
            RuntimeError::new(
                "security_state_encode",
                "durable security state cannot be encoded",
            )
        })?;
        let envelope = RevocationEnvelope {
            checksum: format!("sha256:{}", hex::encode(Sha256::digest(canonical))),
            entries: sorted,
            format: DURABLE_REVOCATION_FORMAT.to_string(),
            format_version: DURABLE_REVOCATION_FORMAT_VERSION,
            generation,
        };
        let mut encoded = serde_json::to_vec(&envelope).map_err(|_| {
            RuntimeError::new(
                "security_state_encode",
                "durable security state cannot be encoded",
            )
        })?;
        encoded.push(b'\n');
        if encoded.len() as u64 > self.options.max_file_bytes {
            return Err(RuntimeError::new(
                "security_state_limit",
                "durable security state exceeds configured byte limit",
            ));
        }
        atomic_write_state(&self.path, &encoded)
    }

    fn load(&self) -> RuntimeResult<(BTreeMap<String, RevocationEntry>, u64)> {
        ensure_parent(&self.path)?;
        let metadata = match fs::symlink_metadata(&self.path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                return Ok((BTreeMap::new(), 0));
            }
            Err(_) => {
                return Err(RuntimeError::new(
                    "security_state_read_failed",
                    "durable security state cannot be inspected",
                ));
            }
        };
        if !metadata.file_type().is_file() || metadata.file_type().is_symlink() {
            return Err(RuntimeError::new(
                "security_state_path_unsafe",
                "durable security state must be a regular non-symlink file",
            ));
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if metadata.permissions().mode() & 0o077 != 0 {
                return Err(RuntimeError::new(
                    "security_state_permissions",
                    "durable security state grants group or other permissions",
                ));
            }
        }
        if metadata.len() > self.options.max_file_bytes {
            return Err(self.quarantine("state exceeds configured byte limit"));
        }
        let raw = fs::read(&self.path).map_err(|_| self.quarantine("state cannot be read"))?;
        let envelope: RevocationEnvelope =
            serde_json::from_slice(&raw).map_err(|_| self.quarantine("state cannot be decoded"))?;
        if envelope.format != DURABLE_REVOCATION_FORMAT
            || envelope.format_version != DURABLE_REVOCATION_FORMAT_VERSION
        {
            return Err(self.quarantine("unsupported state format"));
        }
        let payload = RevocationPayload {
            entries: &envelope.entries,
            format: &envelope.format,
            format_version: envelope.format_version,
            generation: envelope.generation,
        };
        let canonical = serde_json::to_vec(&payload)
            .map_err(|_| self.quarantine("state cannot be canonicalized"))?;
        let expected = format!("sha256:{}", hex::encode(Sha256::digest(canonical)));
        if envelope.checksum != expected {
            return Err(self.quarantine("state checksum mismatch"));
        }
        if envelope.entries.len() > self.options.max_entries {
            return Err(self.quarantine("state exceeds configured entry capacity"));
        }
        let mut entries = BTreeMap::new();
        for mut entry in envelope.entries {
            entry
                .normalize_and_validate()
                .map_err(|_| self.quarantine("revocation entry is invalid"))?;
            let key = entry_key(entry.kind, &entry.value);
            if entries.insert(key, entry).is_some() {
                return Err(self.quarantine("revocation entry is duplicated"));
            }
        }
        Ok((entries, envelope.generation))
    }

    fn quarantine(&self, reason: &str) -> RuntimeError {
        let target = self.path.with_extension(format!(
            "{}corrupt-{}-{}",
            self.path
                .extension()
                .map(|extension| format!("{}.", extension.to_string_lossy()))
                .unwrap_or_default(),
            unix_now(),
            std::process::id()
        ));
        match fs::rename(&self.path, target) {
            Ok(()) => RuntimeError::new(
                "security_state_corrupt",
                format!("durable security state is invalid and was quarantined: {reason}"),
            ),
            Err(_) => RuntimeError::new(
                "security_state_quarantine_failed",
                "durable security state is invalid and could not be quarantined",
            ),
        }
    }
}

fn entry_key(kind: RevocationKind, value: &str) -> String {
    format!("{}\0{value}", kind.as_str())
}

fn ensure_parent(path: &Path) -> RuntimeResult<()> {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent).map_err(|_| {
        RuntimeError::new(
            "security_state_path_unsafe",
            "durable security state parent cannot be created",
        )
    })?;
    let metadata = fs::symlink_metadata(parent).map_err(|_| {
        RuntimeError::new(
            "security_state_path_unsafe",
            "durable security state parent cannot be inspected",
        )
    })?;
    if !metadata.file_type().is_dir() || metadata.file_type().is_symlink() {
        return Err(RuntimeError::new(
            "security_state_path_unsafe",
            "durable security state parent must be a regular directory",
        ));
    }
    Ok(())
}

fn atomic_write_state(path: &Path, encoded: &[u8]) -> RuntimeResult<()> {
    ensure_parent(path)?;
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("revocations");
    let temporary = parent.join(format!(
        ".{name}.tmp-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0)
    ));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temporary).map_err(|_| {
        RuntimeError::new(
            "security_state_write_failed",
            "durable security state write failed before commit",
        )
    })?;
    let result = (|| -> io::Result<()> {
        file.write_all(encoded)?;
        file.sync_all()?;
        drop(file);
        atomic_replace(&temporary, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
        return Err(RuntimeError::new(
            "security_state_write_failed",
            "durable security state write failed before commit",
        ));
    }
    #[cfg(unix)]
    if File::open(parent)
        .and_then(|directory| directory.sync_all())
        .is_err()
    {
        return Err(RuntimeError::new(
            "revocation_state_durability_uncertain",
            "durable revocation state committed but directory sync was uncertain",
        ));
    }
    Ok(())
}

#[cfg(not(windows))]
fn atomic_replace(source: &Path, target: &Path) -> io::Result<()> {
    fs::rename(source, target)
}

#[cfg(windows)]
fn atomic_replace(source: &Path, target: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    const MOVEFILE_REPLACE_EXISTING: u32 = 0x1;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x8;
    #[link(name = "kernel32")]
    extern "system" {
        fn MoveFileExW(existing: *const u16, replacement: *const u16, flags: u32) -> i32;
    }
    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let target: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
    // SAFETY: both pointers reference NUL-terminated UTF-16 buffers for this call.
    let result = unsafe {
        MoveFileExW(
            source.as_ptr(),
            target.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

fn lock_error(message: &str) -> RuntimeError {
    RuntimeError::new("revocation_state_unavailable", message)
}

pub(crate) fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}
