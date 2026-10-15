package worker

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"time"

	"github.com/DaosPath/handoffkit/go/contract"
)

const (
	SchedulerStateFormat        = "handoffkit.scheduler.state"
	SchedulerStateFormatVersion = 1
	defaultSchedulerStateBytes  = 16 * 1024 * 1024
	maxSchedulerSafeInteger     = uint64(9_007_199_254_740_991)
)

type SchedulerStateError struct {
	Code      string
	Message   string
	Details   map[string]any
	Committed bool
}

func (err *SchedulerStateError) Error() string { return err.Message }

func schedulerStateError(code, message string, details map[string]any) error {
	return &SchedulerStateError{Code: code, Message: message, Details: details}
}

func schedulerCommittedStateError(message string, details map[string]any) error {
	if details == nil {
		details = map[string]any{}
	}
	details["committed"] = true
	return &SchedulerStateError{
		Code: "scheduler_state_durability_uncertain", Message: message,
		Details: details, Committed: true,
	}
}

func schedulerCommitApplied(err error) bool {
	var stateError *SchedulerStateError
	return errors.As(err, &stateError) && stateError.Committed
}

type queuedSchedulerJob struct {
	Attempt uint32                  `json:"attempt"`
	Job     contract.DistributedJob `json:"job"`
}

type assignedSchedulerJob struct {
	Assignment contract.JobAssignment  `json:"assignment"`
	Job        contract.DistributedJob `json:"job"`
}

type interruptedSchedulerJob struct {
	Assignment contract.JobAssignment  `json:"assignment"`
	Job        contract.DistributedJob `json:"job"`
	Reason     string                  `json:"reason"`
}

type seenSchedulerJob struct {
	IdempotencyKey string `json:"idempotency_key"`
	JobID          string `json:"job_id"`
}

type schedulerState struct {
	Completed     int                       `json:"completed"`
	Failed        int                       `json:"failed"`
	Format        string                    `json:"format"`
	FormatVersion int                       `json:"format_version"`
	Generation    uint64                    `json:"generation"`
	Inflight      []assignedSchedulerJob    `json:"inflight"`
	Interrupted   []interruptedSchedulerJob `json:"interrupted"`
	Queued        []queuedSchedulerJob      `json:"queued"`
	Seen          []seenSchedulerJob        `json:"seen"`
}

type SchedulerStateStore interface {
	Load() ([]byte, error)
	Commit(payload []byte) error
	Quarantine(reason string) error
}

type FileSchedulerStateStore struct {
	path         string
	maxFileBytes int64
}

func NewFileSchedulerStateStore(path string, maxFileBytes int64) (*FileSchedulerStateStore, error) {
	if path == "" {
		return nil, schedulerStateError("security_state_path_unsafe", "scheduler state path is required", nil)
	}
	if maxFileBytes == 0 {
		maxFileBytes = defaultSchedulerStateBytes
	}
	if maxFileBytes < 1024 {
		return nil, schedulerStateError("security_state_limit", "scheduler state byte limit is invalid", nil)
	}
	absolute, err := filepath.Abs(path)
	if err != nil {
		return nil, schedulerStateError("security_state_path_unsafe", "scheduler state path is invalid", nil)
	}
	store := &FileSchedulerStateStore{path: absolute, maxFileBytes: maxFileBytes}
	if err := store.ensureParent(); err != nil {
		return nil, err
	}
	if _, err := os.Lstat(store.path); err == nil {
		if err := store.validateExisting(); err != nil {
			return nil, err
		}
	} else if !os.IsNotExist(err) {
		return nil, schedulerStateError("security_state_read_failed", "scheduler state cannot be inspected", nil)
	}
	return store, nil
}

func (store *FileSchedulerStateStore) Path() string { return store.path }

func (store *FileSchedulerStateStore) Load() ([]byte, error) {
	if _, err := os.Lstat(store.path); os.IsNotExist(err) {
		return nil, nil
	} else if err != nil {
		return nil, schedulerStateError("security_state_read_failed", "scheduler state cannot be inspected", nil)
	}
	if err := store.validateExisting(); err != nil {
		return nil, err
	}
	raw, err := os.ReadFile(store.path)
	if err != nil {
		return nil, store.Quarantine("state cannot be read")
	}
	var envelope map[string]any
	if err := decodeSchedulerJSON(raw, &envelope); err != nil {
		return nil, store.Quarantine("state cannot be decoded")
	}
	actual, ok := envelope["checksum"].(string)
	if !ok {
		return nil, store.Quarantine("state checksum is missing")
	}
	delete(envelope, "checksum")
	canonical, err := canonicalSchedulerJSON(envelope)
	if err != nil || actual != schedulerChecksum(canonical) {
		return nil, store.Quarantine("state checksum mismatch")
	}
	payload, err := canonicalSchedulerJSON(envelope)
	if err != nil {
		return nil, store.Quarantine("state cannot be encoded")
	}
	return payload, nil
}

func (store *FileSchedulerStateStore) Commit(payload []byte) error {
	var state map[string]any
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.UseNumber()
	if err := decodeSchedulerValue(decoder, &state); err != nil {
		return schedulerStateError("security_state_encode", "scheduler state cannot be encoded", nil)
	}
	canonical, err := canonicalSchedulerJSON(state)
	if err != nil {
		return schedulerStateError("security_state_encode", "scheduler state cannot be encoded", nil)
	}
	var envelope map[string]any
	if err := decodeSchedulerJSON(canonical, &envelope); err != nil {
		return schedulerStateError("security_state_encode", "scheduler state cannot be encoded", nil)
	}
	envelope["checksum"] = schedulerChecksum(canonical)
	encoded, err := canonicalSchedulerJSON(envelope)
	if err != nil {
		return schedulerStateError("security_state_encode", "scheduler state cannot be encoded", nil)
	}
	encoded = append(encoded, '\n')
	if int64(len(encoded)) > store.maxFileBytes {
		return schedulerStateError(
			"security_state_limit",
			"scheduler state exceeds configured byte limit",
			map[string]any{"limit_bytes": store.maxFileBytes},
		)
	}
	committed, err := atomicWriteSchedulerState(store.path, encoded, 0o600)
	if err != nil && committed {
		return schedulerCommittedStateError(
			"scheduler state committed but directory sync was uncertain",
			map[string]any{"reason": fmt.Sprintf("%T", err)},
		)
	}
	if err != nil {
		return schedulerStateError(
			"security_state_write_failed",
			"scheduler state write failed before commit",
			map[string]any{"reason": fmt.Sprintf("%T", err)},
		)
	}
	return nil
}

// Backup copies a validated state file to a private, atomically replaced path.
func (store *FileSchedulerStateStore) Backup(destination string) error {
	target, err := filepath.Abs(destination)
	if err != nil || target == store.path {
		return schedulerStateError("scheduler_state_backup_invalid", "scheduler state backup path is invalid", nil)
	}
	if _, err := store.Load(); err != nil {
		return err
	}
	raw, err := os.ReadFile(store.path)
	if err != nil {
		return schedulerStateError("scheduler_state_read_failed", "scheduler state backup source cannot be read", nil)
	}
	if int64(len(raw)) > store.maxFileBytes {
		return schedulerStateError("security_state_limit", "scheduler state exceeds configured byte limit", nil)
	}
	if _, err := NewFileSchedulerStateStore(target, store.maxFileBytes); err != nil {
		return err
	}
	committed, err := atomicWriteSchedulerState(target, raw, 0o600)
	if err != nil {
		return schedulerCopyError("scheduler_state_backup_failed", committed, err)
	}
	return nil
}

// Restore validates a backup and atomically replaces the primary state file.
// Call this before constructing the scheduler that owns the store.
func (store *FileSchedulerStateStore) Restore(source string) error {
	backupPath, err := filepath.Abs(source)
	if err != nil || backupPath == store.path {
		return schedulerStateError("scheduler_state_restore_invalid", "scheduler state restore path is invalid", nil)
	}
	backup, err := NewFileSchedulerStateStore(backupPath, store.maxFileBytes)
	if err != nil {
		return err
	}
	if _, err := backup.Load(); err != nil {
		return err
	}
	raw, err := os.ReadFile(backup.path)
	if err != nil {
		return schedulerStateError("scheduler_state_read_failed", "scheduler state backup cannot be read", nil)
	}
	committed, err := atomicWriteSchedulerState(store.path, raw, 0o600)
	if err != nil {
		return schedulerCopyError("scheduler_state_restore_failed", committed, err)
	}
	_, err = store.Load()
	return err
}

func schedulerCopyError(code string, committed bool, err error) error {
	if committed {
		return schedulerCommittedStateError(
			"scheduler state copy committed but directory sync was uncertain",
			map[string]any{"operation": code, "reason": fmt.Sprintf("%T", err)},
		)
	}
	return schedulerStateError(code, "scheduler state copy failed before commit", map[string]any{"reason": fmt.Sprintf("%T", err)})
}

func (store *FileSchedulerStateStore) Quarantine(reason string) error {
	target := fmt.Sprintf("%s.corrupt-%d-%d", store.path, time.Now().Unix(), os.Getpid())
	if err := os.Rename(store.path, target); err != nil {
		return schedulerStateError(
			"security_state_quarantine_failed",
			"invalid scheduler state could not be quarantined",
			map[string]any{"reason": fmt.Sprintf("%T", err)},
		)
	}
	return schedulerStateError(
		"security_state_corrupt",
		"invalid scheduler state was quarantined",
		map[string]any{"reason": reason, "quarantine": filepath.Base(target)},
	)
}

func (store *FileSchedulerStateStore) ensureParent() error {
	parent := filepath.Dir(store.path)
	if err := os.MkdirAll(parent, 0o700); err != nil {
		return schedulerStateError("security_state_path_unsafe", "scheduler state parent cannot be created", nil)
	}
	info, err := os.Lstat(parent)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return schedulerStateError("security_state_path_unsafe", "scheduler state parent must be a regular directory", nil)
	}
	return nil
}

func (store *FileSchedulerStateStore) validateExisting() error {
	info, err := os.Lstat(store.path)
	if err != nil {
		return schedulerStateError("security_state_read_failed", "scheduler state cannot be inspected", nil)
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return schedulerStateError("security_state_path_unsafe", "scheduler state must be a regular non-symlink file", nil)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm()&0o077 != 0 {
		return schedulerStateError("security_state_permissions", "scheduler state grants group or other permissions", nil)
	}
	if info.Size() > store.maxFileBytes {
		return store.Quarantine("state exceeds configured byte limit")
	}
	return nil
}

func canonicalSchedulerJSON(value any) ([]byte, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	var generic any
	if err := decodeSchedulerJSON(raw, &generic); err != nil {
		return nil, err
	}
	return json.Marshal(generic)
}

func decodeSchedulerJSON(raw []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	return decodeSchedulerValue(decoder, target)
}

func decodeSchedulerValue(decoder *json.Decoder, target any) error {
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var trailing any
	if err := decoder.Decode(&trailing); err == nil {
		return errors.New("scheduler state contains trailing JSON")
	} else if !errors.Is(err, io.EOF) {
		return err
	}
	return nil
}

func schedulerChecksum(canonical []byte) string {
	digest := sha256.Sum256(canonical)
	return "sha256:" + hex.EncodeToString(digest[:])
}
