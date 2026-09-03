use crate::security::SecurityPolicyError;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
#[cfg(unix)]
use std::fs::File;
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub const DURABLE_REPLAY_FORMAT: &str = "handoffkit.security.replay";
pub const DURABLE_REPLAY_FORMAT_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ReplayContext {
    pub peer_id: String,
    pub session_id: String,
    pub credential_fingerprint: String,
    pub security_profile: String,
}

impl ReplayContext {
    fn validate(&self) -> Result<(), SecurityPolicyError> {
        if self.peer_id.is_empty()
            || self.session_id.is_empty()
            || self.credential_fingerprint.is_empty()
            || self.security_profile.is_empty()
        {
            return Err(policy_error(
                "replay_context_missing",
                "durable replay state requires authenticated context",
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DurableReplayOptions {
    pub window_seconds: u64,
    pub max_clock_skew_seconds: u64,
    pub max_seen_nonces: usize,
    pub max_scopes: usize,
    pub state_ttl_seconds: u64,
    pub max_file_bytes: u64,
}

impl Default for DurableReplayOptions {
    fn default() -> Self {
        Self {
            window_seconds: 300,
            max_clock_skew_seconds: 10,
            max_seen_nonces: 10_000,
            max_scopes: 10_000,
            state_ttl_seconds: 86_400,
            max_file_bytes: 4 * 1024 * 1024,
        }
    }
}

impl DurableReplayOptions {
    pub(crate) fn validate(&self) -> Result<(), SecurityPolicyError> {
        if self.window_seconds == 0
            || self.max_seen_nonces == 0
            || self.max_scopes == 0
            || self.state_ttl_seconds < self.window_seconds
            || self.max_file_bytes < 1024
        {
            return Err(policy_error(
                "replay_state_bounds_invalid",
                "durable replay bounds are invalid",
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct DurableReplayNonce {
    seen_at: u64,
    value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct DurableReplayRecord {
    credential_fingerprint: String,
    expires_at: u64,
    last_sequence: u64,
    nonces: Vec<DurableReplayNonce>,
    peer_id: String,
    scope: String,
    security_profile: String,
    session_id: String,
    updated_at: u64,
}

#[derive(Debug, Serialize)]
struct DurableReplayPayload<'a> {
    format: &'a str,
    format_version: u32,
    generation: u64,
    records: &'a [DurableReplayRecord],
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct DurableReplayEnvelope {
    checksum: String,
    format: String,
    format_version: u32,
    generation: u64,
    records: Vec<DurableReplayRecord>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct DurableReplayStatus {
    pub format: &'static str,
    pub format_version: u32,
    pub generation: u64,
    pub scopes: usize,
    pub nonces: usize,
}

#[derive(Debug)]
pub(crate) struct DurableReplayState {
    path: PathBuf,
    max_file_bytes: u64,
    max_seen_nonces: usize,
    max_scopes: usize,
    state_ttl_seconds: u64,
    generation: u64,
    records: HashMap<String, DurableReplayRecord>,
}

#[derive(Debug)]
pub(crate) struct DurableCommitFailure {
    pub error: SecurityPolicyError,
    pub committed: bool,
}

pub(crate) type LoadedReplayMaps = (HashMap<String, u64>, HashMap<String, u64>);

impl DurableReplayState {
    pub(crate) fn load(
        path: impl Into<PathBuf>,
        options: &DurableReplayOptions,
    ) -> Result<(Self, LoadedReplayMaps), SecurityPolicyError> {
        options.validate()?;
        let mut state = Self {
            path: path.into(),
            max_file_bytes: options.max_file_bytes,
            max_seen_nonces: options.max_seen_nonces,
            max_scopes: options.max_scopes,
            state_ttl_seconds: options.state_ttl_seconds,
            generation: 0,
            records: HashMap::new(),
        };
        ensure_state_parent(&state.path)?;
        let metadata = match fs::symlink_metadata(&state.path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                return Ok((state, (HashMap::new(), HashMap::new())))
            }
            Err(_) => {
                return Err(policy_error(
                    "security_state_read_failed",
                    "durable security state cannot be inspected",
                ))
            }
        };
        if !metadata.file_type().is_file() || metadata.file_type().is_symlink() {
            return Err(policy_error(
                "security_state_path_unsafe",
                "durable security state must be a regular non-symlink file",
            ));
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if metadata.permissions().mode() & 0o077 != 0 {
                return Err(policy_error(
                    "security_state_permissions",
                    "durable security state grants group or other permissions",
                ));
            }
        }
        if metadata.len() > state.max_file_bytes {
            return Err(state.quarantine("state exceeds configured byte limit"));
        }
        let raw = fs::read(&state.path).map_err(|_| state.quarantine("state cannot be read"))?;
        let envelope: DurableReplayEnvelope = serde_json::from_slice(&raw)
            .map_err(|_| state.quarantine("state cannot be decoded"))?;
        if envelope.format != DURABLE_REPLAY_FORMAT
            || envelope.format_version != DURABLE_REPLAY_FORMAT_VERSION
        {
            return Err(state.quarantine("unsupported state format"));
        }
        let payload = DurableReplayPayload {
            format: &envelope.format,
            format_version: envelope.format_version,
            generation: envelope.generation,
            records: &envelope.records,
        };
        let canonical = serde_json::to_vec(&payload)
            .map_err(|_| state.quarantine("state cannot be canonicalized"))?;
        let expected = format!("sha256:{}", hex::encode(Sha256::digest(canonical)));
        if envelope.checksum != expected {
            return Err(state.quarantine("state checksum mismatch"));
        }
        if envelope.records.len() > state.max_scopes {
            return Err(state.quarantine("state exceeds configured scope capacity"));
        }
        let mut sequences = HashMap::new();
        let mut nonces = HashMap::new();
        for record in envelope.records {
            if record.scope.is_empty()
                || record.peer_id.is_empty()
                || record.session_id.is_empty()
                || record.credential_fingerprint.is_empty()
                || record.security_profile.is_empty()
            {
                return Err(state.quarantine("record context is invalid"));
            }
            if state.records.contains_key(&record.scope) {
                return Err(state.quarantine("record scope is duplicated"));
            }
            for nonce in &record.nonces {
                if nonce.value.is_empty() {
                    return Err(state.quarantine("nonce entry is invalid"));
                }
                let key = nonce_key(&record.scope, &nonce.value);
                if nonces.insert(key, nonce.seen_at).is_some() {
                    return Err(state.quarantine("nonce entry is duplicated"));
                }
            }
            if nonces.len() > state.max_seen_nonces {
                return Err(state.quarantine("state exceeds configured nonce capacity"));
            }
            sequences.insert(record.scope.clone(), record.last_sequence);
            state.records.insert(record.scope.clone(), record);
        }
        state.generation = envelope.generation;
        Ok((state, (sequences, nonces)))
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn commit_candidate(
        &mut self,
        scope: &str,
        sequence: u64,
        sequences: &HashMap<String, u64>,
        nonces: &HashMap<String, u64>,
        context: Option<&ReplayContext>,
        now: u64,
    ) -> Result<(), DurableCommitFailure> {
        let mut records = self.records.clone();
        records.retain(|_, record| record.expires_at > now);
        let existing = records.get(scope).cloned();
        if existing.is_none() && records.len() >= self.max_scopes {
            return Err(DurableCommitFailure {
                error: policy_error(
                    "replay_state_capacity",
                    "durable replay scope capacity is exhausted",
                ),
                committed: false,
            });
        }
        let resolved = context.cloned().or_else(|| {
            existing.as_ref().map(|record| ReplayContext {
                peer_id: record.peer_id.clone(),
                session_id: record.session_id.clone(),
                credential_fingerprint: record.credential_fingerprint.clone(),
                security_profile: record.security_profile.clone(),
            })
        });
        let resolved = resolved.ok_or_else(|| DurableCommitFailure {
            error: policy_error(
                "replay_context_missing",
                "durable replay state requires authenticated context",
            ),
            committed: false,
        })?;
        resolved.validate().map_err(|error| DurableCommitFailure {
            error,
            committed: false,
        })?;
        if sequences.get(scope) != Some(&sequence) {
            return Err(DurableCommitFailure {
                error: policy_error(
                    "replay_state_invalid",
                    "candidate replay sequence is inconsistent",
                ),
                committed: false,
            });
        }
        records.insert(
            scope.to_string(),
            DurableReplayRecord {
                credential_fingerprint: resolved.credential_fingerprint,
                expires_at: now.saturating_add(self.state_ttl_seconds),
                last_sequence: sequence,
                nonces: nonce_entries(scope, nonces),
                peer_id: resolved.peer_id,
                scope: scope.to_string(),
                security_profile: resolved.security_profile,
                session_id: resolved.session_id,
                updated_at: now,
            },
        );
        self.commit(records, self.generation.saturating_add(1))
    }

    pub(crate) fn expired_scopes(&self, now: u64) -> Vec<String> {
        self.records
            .iter()
            .filter(|(_, record)| record.expires_at <= now)
            .map(|(scope, _)| scope.clone())
            .collect()
    }

    pub(crate) fn commit_compaction(
        &mut self,
        nonces: &HashMap<String, u64>,
        expired_scopes: &HashSet<String>,
    ) -> Result<(), DurableCommitFailure> {
        let mut records = self.records.clone();
        records.retain(|scope, _| !expired_scopes.contains(scope));
        for (scope, record) in &mut records {
            record.nonces = nonce_entries(scope, nonces);
        }
        self.commit(records, self.generation.saturating_add(1))
    }

    pub(crate) fn status(&self, nonces: usize) -> DurableReplayStatus {
        DurableReplayStatus {
            format: DURABLE_REPLAY_FORMAT,
            format_version: DURABLE_REPLAY_FORMAT_VERSION,
            generation: self.generation,
            scopes: self.records.len(),
            nonces,
        }
    }

    fn commit(
        &mut self,
        records: HashMap<String, DurableReplayRecord>,
        generation: u64,
    ) -> Result<(), DurableCommitFailure> {
        let sorted = sorted_records(&records);
        let payload = DurableReplayPayload {
            format: DURABLE_REPLAY_FORMAT,
            format_version: DURABLE_REPLAY_FORMAT_VERSION,
            generation,
            records: &sorted,
        };
        let canonical = serde_json::to_vec(&payload).map_err(|_| DurableCommitFailure {
            error: policy_error(
                "security_state_encode",
                "durable security state cannot be encoded",
            ),
            committed: false,
        })?;
        let envelope = DurableReplayEnvelope {
            checksum: format!("sha256:{}", hex::encode(Sha256::digest(canonical))),
            format: DURABLE_REPLAY_FORMAT.to_string(),
            format_version: DURABLE_REPLAY_FORMAT_VERSION,
            generation,
            records: sorted,
        };
        let mut encoded = serde_json::to_vec(&envelope).map_err(|_| DurableCommitFailure {
            error: policy_error(
                "security_state_encode",
                "durable security state cannot be encoded",
            ),
            committed: false,
        })?;
        encoded.push(b'\n');
        if encoded.len() as u64 > self.max_file_bytes {
            return Err(DurableCommitFailure {
                error: policy_error(
                    "security_state_limit",
                    "durable security state exceeds configured byte limit",
                ),
                committed: false,
            });
        }
        match atomic_write_state(&self.path, &encoded) {
            Ok(()) => {
                self.records = records;
                self.generation = generation;
                Ok(())
            }
            Err(failure) => {
                if failure.committed {
                    self.records = records;
                    self.generation = generation;
                }
                Err(failure)
            }
        }
    }

    fn quarantine(&self, reason: &str) -> SecurityPolicyError {
        let now = unix_now();
        let target = self.path.with_extension(format!(
            "{}corrupt-{now}-{}",
            self.path
                .extension()
                .map(|extension| format!("{}.", extension.to_string_lossy()))
                .unwrap_or_default(),
            std::process::id()
        ));
        match fs::rename(&self.path, target) {
            Ok(()) => policy_error(
                "security_state_corrupt",
                format!("durable security state is invalid and was quarantined: {reason}"),
            ),
            Err(_) => policy_error(
                "security_state_quarantine_failed",
                "durable security state is invalid and could not be quarantined",
            ),
        }
    }
}

fn sorted_records(records: &HashMap<String, DurableReplayRecord>) -> Vec<DurableReplayRecord> {
    let mut values: Vec<_> = records.values().cloned().collect();
    values.sort_by(|left, right| left.scope.cmp(&right.scope));
    values
}

fn nonce_entries(scope: &str, nonces: &HashMap<String, u64>) -> Vec<DurableReplayNonce> {
    let prefix = format!("{scope}\0");
    let mut entries: Vec<_> = nonces
        .iter()
        .filter_map(|(key, seen_at)| {
            key.strip_prefix(&prefix).map(|value| DurableReplayNonce {
                seen_at: *seen_at,
                value: value.to_string(),
            })
        })
        .collect();
    entries.sort_by(|left, right| {
        left.seen_at
            .cmp(&right.seen_at)
            .then_with(|| left.value.cmp(&right.value))
    });
    entries
}

pub(crate) fn nonce_key(scope: &str, nonce: &str) -> String {
    format!("{scope}\0{nonce}")
}

fn ensure_state_parent(path: &Path) -> Result<(), SecurityPolicyError> {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent).map_err(|_| {
        policy_error(
            "security_state_path_unsafe",
            "durable security state parent cannot be created",
        )
    })?;
    let metadata = fs::symlink_metadata(parent).map_err(|_| {
        policy_error(
            "security_state_path_unsafe",
            "durable security state parent cannot be inspected",
        )
    })?;
    if !metadata.file_type().is_dir() || metadata.file_type().is_symlink() {
        return Err(policy_error(
            "security_state_path_unsafe",
            "durable security state parent must be a regular directory",
        ));
    }
    #[cfg(unix)]
    if metadata.permissions().readonly() {
        return Err(policy_error(
            "security_state_path_unsafe",
            "durable security state parent is read-only",
        ));
    }
    Ok(())
}

fn atomic_write_state(path: &Path, encoded: &[u8]) -> Result<(), DurableCommitFailure> {
    ensure_state_parent(path).map_err(|error| DurableCommitFailure {
        error,
        committed: false,
    })?;
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("replay-state");
    let temporary = parent.join(format!(
        ".{file_name}.tmp-{}-{}",
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
    let mut file = options.open(&temporary).map_err(|_| DurableCommitFailure {
        error: policy_error(
            "security_state_write_failed",
            "durable security state write failed before commit",
        ),
        committed: false,
    })?;
    let before_commit = (|| -> io::Result<()> {
        file.write_all(encoded)?;
        file.sync_all()?;
        drop(file);
        atomic_replace(&temporary, path)
    })();
    if before_commit.is_err() {
        let _ = fs::remove_file(&temporary);
        return Err(DurableCommitFailure {
            error: policy_error(
                "security_state_write_failed",
                "durable security state write failed before commit",
            ),
            committed: false,
        });
    }
    #[cfg(unix)]
    {
        if File::open(parent)
            .and_then(|directory| directory.sync_all())
            .is_err()
        {
            return Err(DurableCommitFailure {
                error: policy_error(
                    "replay_state_durability_uncertain",
                    "durable replay state committed but directory sync was uncertain",
                ),
                committed: true,
            });
        }
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

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn policy_error(code: &'static str, message: impl Into<String>) -> SecurityPolicyError {
    SecurityPolicyError {
        code,
        message: message.into(),
    }
}
