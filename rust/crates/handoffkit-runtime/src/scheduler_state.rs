use crate::{RuntimeError, RuntimeResult};
use serde_json::Value;
use sha2::{Digest, Sha256};
#[cfg(unix)]
use std::fs::File;
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub const SCHEDULER_STATE_FORMAT: &str = "handoffkit.scheduler.state";
pub const SCHEDULER_STATE_FORMAT_VERSION: u32 = 1;
pub const DEFAULT_SCHEDULER_STATE_BYTES: u64 = 16 * 1024 * 1024;

pub trait SchedulerStateStore: Send + Sync {
    fn load(&self) -> RuntimeResult<Option<Vec<u8>>>;
    fn commit(&self, payload: &[u8]) -> RuntimeResult<()>;
    fn quarantine(&self, reason: &str) -> RuntimeError;
}

#[derive(Debug, Clone)]
pub struct FileSchedulerStateStore {
    path: PathBuf,
    max_file_bytes: u64,
}

impl FileSchedulerStateStore {
    pub fn new(path: impl Into<PathBuf>, max_file_bytes: u64) -> RuntimeResult<Self> {
        let max_file_bytes = if max_file_bytes == 0 {
            DEFAULT_SCHEDULER_STATE_BYTES
        } else {
            max_file_bytes
        };
        if max_file_bytes < 1024 {
            return Err(state_error(
                "security_state_limit",
                "scheduler state byte limit is invalid",
            ));
        }
        let path = path.into();
        if path.as_os_str().is_empty() {
            return Err(state_error(
                "security_state_path_unsafe",
                "scheduler state path is required",
            ));
        }
        ensure_parent(&path)?;
        let store = Self {
            path,
            max_file_bytes,
        };
        match fs::symlink_metadata(&store.path) {
            Ok(_) => store.validate_existing()?,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(_) => {
                return Err(state_error(
                    "security_state_read_failed",
                    "scheduler state cannot be inspected",
                ))
            }
        }
        Ok(store)
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    fn validate_existing(&self) -> RuntimeResult<()> {
        let metadata = fs::symlink_metadata(&self.path).map_err(|_| {
            state_error(
                "security_state_read_failed",
                "scheduler state cannot be inspected",
            )
        })?;
        if !metadata.file_type().is_file() || metadata.file_type().is_symlink() {
            return Err(state_error(
                "security_state_path_unsafe",
                "scheduler state must be a regular non-symlink file",
            ));
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if metadata.permissions().mode() & 0o077 != 0 {
                return Err(state_error(
                    "security_state_permissions",
                    "scheduler state grants group or other permissions",
                ));
            }
        }
        if metadata.len() > self.max_file_bytes {
            return Err(self.quarantine("state exceeds configured byte limit"));
        }
        Ok(())
    }

    /// Copy a validated state file to a private, atomically replaced path.
    pub fn backup(&self, destination: impl AsRef<Path>) -> RuntimeResult<()> {
        let destination = destination.as_ref();
        if destination == self.path() {
            return Err(state_error(
                "scheduler_state_backup_invalid",
                "scheduler state backup path must differ from the primary",
            ));
        }
        let raw = self.validated_raw("scheduler_state_backup_missing")?;
        write_raw(
            destination,
            &raw,
            "scheduler_state_backup_failed",
            self.max_file_bytes,
        )
    }

    /// Restore a validated backup before constructing the owning scheduler.
    pub fn restore(&self, source: impl AsRef<Path>) -> RuntimeResult<()> {
        let source = source.as_ref();
        if source == self.path() {
            return Err(state_error(
                "scheduler_state_restore_invalid",
                "scheduler state restore path must differ from the primary",
            ));
        }
        let source_store = Self::new(source.to_path_buf(), self.max_file_bytes)?;
        let raw = source_store.validated_raw("scheduler_state_restore_missing")?;
        write_raw(
            &self.path,
            &raw,
            "scheduler_state_restore_failed",
            self.max_file_bytes,
        )?;
        self.load()?;
        Ok(())
    }

    fn validated_raw(&self, missing_code: &str) -> RuntimeResult<Vec<u8>> {
        if self.load()?.is_none() {
            return Err(state_error(
                missing_code,
                "durable scheduler state does not exist",
            ));
        }
        let raw = fs::read(&self.path).map_err(|_| {
            state_error(
                "security_state_read_failed",
                "scheduler state cannot be read",
            )
        })?;
        if raw.len() as u64 > self.max_file_bytes {
            return Err(state_error(
                "security_state_limit",
                "scheduler state exceeds configured byte limit",
            ));
        }
        Ok(raw)
    }
}

impl SchedulerStateStore for FileSchedulerStateStore {
    fn load(&self) -> RuntimeResult<Option<Vec<u8>>> {
        match fs::symlink_metadata(&self.path) {
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(_) => {
                return Err(state_error(
                    "security_state_read_failed",
                    "scheduler state cannot be inspected",
                ))
            }
        }
        self.validate_existing()?;
        let raw = fs::read(&self.path).map_err(|_| self.quarantine("state cannot be read"))?;
        let mut envelope: Value =
            serde_json::from_slice(&raw).map_err(|_| self.quarantine("state cannot be decoded"))?;
        let object = envelope
            .as_object_mut()
            .ok_or_else(|| self.quarantine("state root is not an object"))?;
        let actual = object
            .remove("checksum")
            .and_then(|value| value.as_str().map(ToOwned::to_owned))
            .ok_or_else(|| self.quarantine("state checksum is missing"))?;
        let payload = canonical_json(&envelope)
            .map_err(|_| self.quarantine("state cannot be canonicalized"))?;
        if actual != checksum(&payload) {
            return Err(self.quarantine("state checksum mismatch"));
        }
        Ok(Some(payload))
    }

    fn commit(&self, payload: &[u8]) -> RuntimeResult<()> {
        let mut value: Value = serde_json::from_slice(payload).map_err(|_| {
            state_error("security_state_encode", "scheduler state cannot be encoded")
        })?;
        let canonical = canonical_json(&value).map_err(|_| {
            state_error("security_state_encode", "scheduler state cannot be encoded")
        })?;
        value
            .as_object_mut()
            .ok_or_else(|| state_error("security_state_encode", "scheduler state root is invalid"))?
            .insert("checksum".to_string(), Value::String(checksum(&canonical)));
        let mut encoded = canonical_json(&value).map_err(|_| {
            state_error("security_state_encode", "scheduler state cannot be encoded")
        })?;
        encoded.push(b'\n');
        if encoded.len() as u64 > self.max_file_bytes {
            return Err(state_error(
                "security_state_limit",
                "scheduler state exceeds configured byte limit",
            ));
        }
        match atomic_write(&self.path, &encoded) {
            Ok(()) => Ok(()),
            Err(AtomicWriteError::BeforeCommit) => Err(state_error(
                "security_state_write_failed",
                "scheduler state write failed before commit",
            )),
            Err(AtomicWriteError::DurabilityUncertain) => Err(state_error(
                "scheduler_state_durability_uncertain",
                "scheduler state committed but directory sync was uncertain",
            )),
        }
    }

    fn quarantine(&self, reason: &str) -> RuntimeError {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let target = self.path.with_file_name(format!(
            "{}.corrupt-{suffix}-{}",
            self.path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("scheduler-state"),
            std::process::id()
        ));
        match fs::rename(&self.path, target) {
            Ok(()) => state_error(
                "security_state_corrupt",
                format!("invalid scheduler state was quarantined: {reason}"),
            ),
            Err(_) => state_error(
                "security_state_quarantine_failed",
                "invalid scheduler state could not be quarantined",
            ),
        }
    }
}

fn canonical_json(value: &Value) -> serde_json::Result<Vec<u8>> {
    serde_json::to_vec(value)
}

fn checksum(canonical: &[u8]) -> String {
    format!("sha256:{}", hex::encode(Sha256::digest(canonical)))
}

fn write_raw(path: &Path, encoded: &[u8], code: &str, max_file_bytes: u64) -> RuntimeResult<()> {
    if encoded.len() as u64 > max_file_bytes {
        return Err(state_error(
            code,
            "scheduler state copy exceeds the configured byte limit",
        ));
    }
    match atomic_write(path, encoded) {
        Ok(()) => Ok(()),
        Err(AtomicWriteError::BeforeCommit) => Err(state_error(
            code,
            "scheduler state copy failed before commit",
        )),
        Err(AtomicWriteError::DurabilityUncertain) => Err(state_error(
            "scheduler_state_durability_uncertain",
            "scheduler state copy committed but directory sync was uncertain",
        )),
    }
}

fn ensure_parent(path: &Path) -> RuntimeResult<()> {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent).map_err(|_| {
        state_error(
            "security_state_path_unsafe",
            "scheduler state parent cannot be created",
        )
    })?;
    let metadata = fs::symlink_metadata(parent).map_err(|_| {
        state_error(
            "security_state_path_unsafe",
            "scheduler state parent cannot be inspected",
        )
    })?;
    if !metadata.file_type().is_dir() || metadata.file_type().is_symlink() {
        return Err(state_error(
            "security_state_path_unsafe",
            "scheduler state parent must be a regular directory",
        ));
    }
    Ok(())
}

enum AtomicWriteError {
    BeforeCommit,
    DurabilityUncertain,
}

fn atomic_write(path: &Path, encoded: &[u8]) -> Result<(), AtomicWriteError> {
    ensure_parent(path).map_err(|_error| AtomicWriteError::BeforeCommit)?;
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let temporary = parent.join(format!(
        ".scheduler-state-{}-{}",
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
    let mut file = options
        .open(&temporary)
        .map_err(|_error| AtomicWriteError::BeforeCommit)?;
    let mut replaced = false;
    let result = (|| -> io::Result<()> {
        file.write_all(encoded)?;
        file.sync_all()?;
        drop(file);
        atomic_replace(&temporary, path)?;
        replaced = true;
        #[cfg(unix)]
        File::open(parent)?.sync_all()?;
        Ok(())
    })();
    match result {
        Ok(()) => Ok(()),
        Err(_error) => {
            let _ = fs::remove_file(&temporary);
            if replaced {
                Err(AtomicWriteError::DurabilityUncertain)
            } else {
                Err(AtomicWriteError::BeforeCommit)
            }
        }
    }
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

fn state_error(code: &str, message: impl AsRef<str>) -> RuntimeError {
    RuntimeError::new(code, message)
}
