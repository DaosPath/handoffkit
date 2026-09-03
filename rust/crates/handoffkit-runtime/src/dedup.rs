use crate::{RuntimeError, RuntimeResult};
use handoffkit_protocol::sanitize_error_message;
use serde::{Deserialize, Serialize};
use std::collections::{HashSet, VecDeque};
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const MAX_DEDUP_KEY_BYTES: usize = 1_024;
const DEFAULT_MAX_LOG_BYTES: u64 = 16 * 1024 * 1024;

pub trait DedupStore: Send + Sync {
    fn claim(&self, key: &str) -> RuntimeResult<bool>;
    fn release(&self, key: &str) -> RuntimeResult<bool>;
    fn len(&self) -> usize;
    fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct DedupLogEntry {
    op: String,
    key: String,
}

struct FileDedupState {
    file: File,
    keys: HashSet<String>,
    order: VecDeque<String>,
    bytes: u64,
}

pub struct FileDedupStore {
    path: PathBuf,
    capacity: usize,
    max_log_bytes: u64,
    state: Mutex<FileDedupState>,
}

impl std::fmt::Debug for FileDedupStore {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("FileDedupStore")
            .field("path", &self.path)
            .field("capacity", &self.capacity)
            .field("max_log_bytes", &self.max_log_bytes)
            .finish()
    }
}

impl FileDedupStore {
    pub fn open(path: impl AsRef<Path>, capacity: usize) -> RuntimeResult<Self> {
        Self::open_with_limit(path, capacity, DEFAULT_MAX_LOG_BYTES)
    }

    pub fn open_with_limit(
        path: impl AsRef<Path>,
        capacity: usize,
        max_log_bytes: u64,
    ) -> RuntimeResult<Self> {
        if capacity == 0 {
            return Err(RuntimeError::new(
                "invalid_dedup_capacity",
                "persistent dedup capacity must be at least 1",
            ));
        }
        if max_log_bytes < 4_096 {
            return Err(RuntimeError::new(
                "invalid_dedup_limit",
                "persistent dedup log limit must be at least 4096 bytes",
            ));
        }
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(io_error("dedup_directory"))?;
        }
        let file = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .truncate(false)
            .open(&path)
            .map_err(io_error("dedup_open"))?;
        let bytes = file.metadata().map_err(io_error("dedup_metadata"))?.len();
        if bytes > max_log_bytes {
            return Err(RuntimeError::new(
                "dedup_log_too_large",
                format!("persistent dedup log exceeds {max_log_bytes} bytes"),
            ));
        }
        let mut keys = HashSet::new();
        let mut order = VecDeque::new();
        let reader = BufReader::new(file.try_clone().map_err(io_error("dedup_open"))?);
        for line in reader.lines() {
            let line = line.map_err(io_error("dedup_read"))?;
            if line.len() > MAX_DEDUP_KEY_BYTES + 64 {
                return Err(RuntimeError::new(
                    "invalid_dedup_log",
                    "persistent dedup entry exceeds safe limit",
                ));
            }
            let entry: DedupLogEntry = serde_json::from_str(&line).map_err(|error| {
                RuntimeError::new(
                    "invalid_dedup_log",
                    sanitize_error_message(error.to_string()),
                )
            })?;
            validate_key(&entry.key)?;
            match entry.op.as_str() {
                "claim" => {
                    if keys.insert(entry.key.clone()) {
                        order.push_back(entry.key);
                    }
                }
                "release" => {
                    keys.remove(&entry.key);
                    order.retain(|item| item != &entry.key);
                }
                _ => {
                    return Err(RuntimeError::new(
                        "invalid_dedup_log",
                        "persistent dedup operation is unknown",
                    ));
                }
            }
            while order.len() > capacity {
                if let Some(expired) = order.pop_front() {
                    keys.remove(&expired);
                }
            }
        }
        Ok(Self {
            path,
            capacity,
            max_log_bytes,
            state: Mutex::new(FileDedupState {
                file,
                keys,
                order,
                bytes,
            }),
        })
    }

    pub fn compact(&self) -> RuntimeResult<()> {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        self.compact_locked(&mut state)
    }

    fn append_locked(
        &self,
        state: &mut FileDedupState,
        entry: &DedupLogEntry,
    ) -> RuntimeResult<()> {
        let mut encoded = serde_json::to_vec(entry)?;
        encoded.push(b'\n');
        if state.bytes.saturating_add(encoded.len() as u64) > self.max_log_bytes {
            self.compact_locked(state)?;
        }
        if state.bytes.saturating_add(encoded.len() as u64) > self.max_log_bytes {
            return Err(RuntimeError::new(
                "dedup_log_full",
                "persistent dedup log cannot fit another safe entry",
            ));
        }
        state
            .file
            .seek(SeekFrom::End(0))
            .map_err(io_error("dedup_write"))?;
        state
            .file
            .write_all(&encoded)
            .map_err(io_error("dedup_write"))?;
        state.file.flush().map_err(io_error("dedup_flush"))?;
        state.bytes += encoded.len() as u64;
        Ok(())
    }

    fn compact_locked(&self, state: &mut FileDedupState) -> RuntimeResult<()> {
        state.file.set_len(0).map_err(io_error("dedup_compact"))?;
        state
            .file
            .seek(SeekFrom::Start(0))
            .map_err(io_error("dedup_compact"))?;
        let mut bytes = 0_u64;
        for key in &state.order {
            let mut encoded = serde_json::to_vec(&DedupLogEntry {
                op: "claim".to_string(),
                key: key.clone(),
            })?;
            encoded.push(b'\n');
            state
                .file
                .write_all(&encoded)
                .map_err(io_error("dedup_compact"))?;
            bytes += encoded.len() as u64;
        }
        state.file.flush().map_err(io_error("dedup_flush"))?;
        state.bytes = bytes;
        Ok(())
    }
}

impl DedupStore for FileDedupStore {
    fn claim(&self, key: &str) -> RuntimeResult<bool> {
        validate_key(key)?;
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if state.keys.contains(key) {
            return Ok(false);
        }
        self.append_locked(
            &mut state,
            &DedupLogEntry {
                op: "claim".to_string(),
                key: key.to_string(),
            },
        )?;
        state.keys.insert(key.to_string());
        state.order.push_back(key.to_string());
        while state.order.len() > self.capacity {
            if let Some(expired) = state.order.pop_front() {
                state.keys.remove(&expired);
            }
        }
        Ok(true)
    }

    fn release(&self, key: &str) -> RuntimeResult<bool> {
        validate_key(key)?;
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if !state.keys.contains(key) {
            return Ok(false);
        }
        self.append_locked(
            &mut state,
            &DedupLogEntry {
                op: "release".to_string(),
                key: key.to_string(),
            },
        )?;
        state.keys.remove(key);
        state.order.retain(|item| item != key);
        Ok(true)
    }

    fn len(&self) -> usize {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .keys
            .len()
    }
}

fn validate_key(key: &str) -> RuntimeResult<()> {
    if key.trim().is_empty() {
        return Err(RuntimeError::new(
            "invalid_dedup_key",
            "deduplication key must not be empty",
        ));
    }
    if key.len() > MAX_DEDUP_KEY_BYTES {
        return Err(RuntimeError::new(
            "invalid_dedup_key",
            format!("deduplication key exceeds {MAX_DEDUP_KEY_BYTES} bytes"),
        ));
    }
    Ok(())
}

fn io_error(code: &'static str) -> impl FnOnce(std::io::Error) -> RuntimeError {
    move |error| RuntimeError::new(code, sanitize_error_message(error.to_string()))
}
