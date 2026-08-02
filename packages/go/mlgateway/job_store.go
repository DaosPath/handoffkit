package mlgateway

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/DaosPath/handoffkit/go/security"
)

const (
	jobStoreFormat        = "handoffkit.ml-gateway.jobs"
	jobStoreFormatVersion = 1
)

type JobState string

const (
	JobActive      JobState = "active"
	JobCompleted   JobState = "completed"
	JobFailed      JobState = "failed"
	JobInterrupted JobState = "interrupted"
)

type StoredResponse struct {
	Kind        string         `json:"kind"`
	Payload     map[string]any `json:"payload"`
	PayloadType string         `json:"payload_type"`
}

type JobRecord struct {
	ExpiresAt       int64           `json:"expires_at"`
	IdempotencyHash string          `json:"idempotency_hash"`
	JobID           string          `json:"job_id"`
	PeerFingerprint string          `json:"peer_fingerprint"`
	RequestHash     string          `json:"request_hash"`
	Response        *StoredResponse `json:"response"`
	State           JobState        `json:"state"`
	UpdatedAt       int64           `json:"updated_at"`
}

type JobStoreOptions struct {
	MaxRecords   int
	MaxFileBytes int64
	TTLSeconds   int64
}

func DefaultJobStoreOptions() JobStoreOptions {
	return JobStoreOptions{MaxRecords: 10_000, MaxFileBytes: 8 * 1024 * 1024, TTLSeconds: 7 * 24 * 60 * 60}
}

type jobStorePayload struct {
	Format        string      `json:"format"`
	FormatVersion int         `json:"format_version"`
	Generation    uint64      `json:"generation"`
	Records       []JobRecord `json:"records"`
}

type jobStoreEnvelope struct {
	Checksum      string      `json:"checksum"`
	Format        string      `json:"format"`
	FormatVersion int         `json:"format_version"`
	Generation    uint64      `json:"generation"`
	Records       []JobRecord `json:"records"`
}

type JobStore struct {
	path         string
	options      JobStoreOptions
	generation   uint64
	records      map[string]JobRecord
	mu           sync.Mutex
	writeFailure func() error
}

func NewJobStore(path string, options JobStoreOptions) (*JobStore, error) {
	if strings.TrimSpace(path) == "" || options.MaxRecords < 1 || options.MaxFileBytes < 1024 || options.TTLSeconds < 60 {
		return nil, gatewayError("job_state_policy_invalid", "durable job store bounds are invalid")
	}
	store := &JobStore{
		path: filepath.Clean(path), options: options, records: map[string]JobRecord{},
	}
	changed, err := store.load(time.Now().Unix())
	if err != nil {
		return nil, err
	}
	if changed {
		if err := store.saveLocked(); err != nil {
			return nil, err
		}
	}
	return store, nil
}

func (store *JobStore) LookupOrBegin(
	peerFingerprint, idempotencyKey, requestHash, jobID string,
	now int64,
) (JobRecord, bool, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	if peerFingerprint == "" || idempotencyKey == "" || requestHash == "" || jobID == "" {
		return JobRecord{}, false, gatewayError("job_context_missing", "durable job context is incomplete")
	}
	store.compactLocked(now)
	key := idempotencyHash(peerFingerprint, idempotencyKey)
	if existing, ok := store.records[key]; ok {
		if existing.RequestHash != requestHash || existing.JobID != jobID {
			return JobRecord{}, false, gatewayError("idempotency_conflict", "idempotency key was reused for a different job")
		}
		return cloneJobRecord(existing), true, nil
	}
	if len(store.records) >= store.options.MaxRecords {
		return JobRecord{}, false, gatewayError("job_state_capacity", "durable job store reached its configured capacity")
	}
	record := JobRecord{
		ExpiresAt: now + store.options.TTLSeconds, IdempotencyHash: key, JobID: jobID,
		PeerFingerprint: peerFingerprint, RequestHash: requestHash, State: JobActive, UpdatedAt: now,
	}
	store.records[key] = record
	if err := store.saveLocked(); err != nil {
		delete(store.records, key)
		return JobRecord{}, false, err
	}
	return cloneJobRecord(record), false, nil
}

func (store *JobStore) Complete(
	idempotencyHash string,
	state JobState,
	response StoredResponse,
	now int64,
) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	if state != JobCompleted && state != JobFailed && state != JobInterrupted {
		return gatewayError("job_state_invalid", "terminal job state is invalid")
	}
	record, ok := store.records[idempotencyHash]
	if !ok {
		return gatewayError("job_state_missing", "durable job record does not exist")
	}
	record.State = state
	record.Response = &response
	record.UpdatedAt = now
	record.ExpiresAt = now + store.options.TTLSeconds
	previous := cloneJobRecord(store.records[idempotencyHash])
	store.records[idempotencyHash] = record
	if err := store.saveLocked(); err != nil {
		store.records[idempotencyHash] = previous
		return err
	}
	return nil
}

func (store *JobStore) Record(idempotencyHash string) (JobRecord, bool) {
	store.mu.Lock()
	defer store.mu.Unlock()
	record, ok := store.records[idempotencyHash]
	return cloneJobRecord(record), ok
}

func (store *JobStore) Status() map[string]any {
	store.mu.Lock()
	defer store.mu.Unlock()
	states := map[string]int{}
	for _, record := range store.records {
		states[string(record.State)]++
	}
	return map[string]any{
		"format": jobStoreFormat, "format_version": jobStoreFormatVersion,
		"generation": store.generation, "records": len(store.records), "states": states,
	}
}

func (store *JobStore) Options() JobStoreOptions {
	store.mu.Lock()
	defer store.mu.Unlock()
	return store.options
}

func (store *JobStore) load(now int64) (bool, error) {
	info, err := os.Stat(store.path)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil || info.Size() > store.options.MaxFileBytes {
		return false, store.quarantine("state cannot be read within configured bounds")
	}
	raw, err := os.ReadFile(store.path)
	if err != nil {
		return false, store.quarantine("state cannot be read")
	}
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	var envelope jobStoreEnvelope
	if err := decoder.Decode(&envelope); err != nil {
		return false, store.quarantine("state cannot be decoded")
	}
	var trailing any
	if trailingErr := decoder.Decode(&trailing); !errors.Is(trailingErr, io.EOF) {
		if trailingErr == nil {
			return false, store.quarantine("state contains trailing data")
		}
		return false, store.quarantine("state contains trailing data")
	}
	if envelope.Format != jobStoreFormat || envelope.FormatVersion != jobStoreFormatVersion {
		return false, store.quarantine("unsupported state format")
	}
	payload := jobStorePayload{
		Format: envelope.Format, FormatVersion: envelope.FormatVersion,
		Generation: envelope.Generation, Records: envelope.Records,
	}
	checksum, err := checksumPayload(payload)
	if err != nil || checksum != envelope.Checksum {
		return false, store.quarantine("state checksum mismatch")
	}
	if len(envelope.Records) > store.options.MaxRecords {
		return false, store.quarantine("state exceeds configured record capacity")
	}
	changed := false
	for _, record := range envelope.Records {
		if err := validateJobRecord(record); err != nil {
			return false, store.quarantine("state record is invalid")
		}
		if record.ExpiresAt <= now {
			changed = true
			continue
		}
		if _, duplicate := store.records[record.IdempotencyHash]; duplicate {
			return false, store.quarantine("state record is duplicated")
		}
		if record.State == JobActive {
			record.State = JobInterrupted
			record.Response = &StoredResponse{
				Kind: "delivery_nack", PayloadType: "delivery_nack",
				Payload: map[string]any{
					"code": "worker_interrupted", "message": "Gateway restarted before job completion.",
					"retryable": true, "metadata": map[string]any{"job_id": record.JobID},
				},
			}
			record.UpdatedAt = now
			changed = true
		}
		store.records[record.IdempotencyHash] = record
	}
	store.generation = envelope.Generation
	return changed, nil
}

func (store *JobStore) compactLocked(now int64) {
	for key, record := range store.records {
		if record.ExpiresAt <= now {
			delete(store.records, key)
		}
	}
}

func (store *JobStore) saveLocked() error {
	if store.writeFailure != nil {
		if err := store.writeFailure(); err != nil {
			return gatewayError("job_state_write_failed", "durable job state could not be committed")
		}
	}
	records := make([]JobRecord, 0, len(store.records))
	for _, record := range store.records {
		records = append(records, cloneJobRecord(record))
	}
	sort.Slice(records, func(left, right int) bool {
		return records[left].IdempotencyHash < records[right].IdempotencyHash
	})
	payload := jobStorePayload{
		Format: jobStoreFormat, FormatVersion: jobStoreFormatVersion,
		Generation: store.generation + 1, Records: records,
	}
	checksum, err := checksumPayload(payload)
	if err != nil {
		return gatewayError("job_state_write_failed", "durable job state cannot be encoded")
	}
	envelope := jobStoreEnvelope{
		Checksum: checksum, Format: payload.Format, FormatVersion: payload.FormatVersion,
		Generation: payload.Generation, Records: payload.Records,
	}
	data, err := json.Marshal(envelope)
	if err != nil || int64(len(data)) > store.options.MaxFileBytes {
		return gatewayError("job_state_capacity", "durable job state exceeds configured file capacity")
	}
	if err := atomicWriteJobState(store.path, data, 0o600); err != nil {
		return gatewayError("job_state_write_failed", "durable job state could not be committed")
	}
	store.generation = payload.Generation
	return nil
}

func (store *JobStore) quarantine(reason string) error {
	target := fmt.Sprintf("%s.corrupt-%d", store.path, time.Now().UnixNano())
	if err := os.Rename(store.path, target); err != nil {
		return gatewayError("job_state_quarantine_failed", "invalid durable job state could not be quarantined")
	}
	return &security.SecurityError{
		Code: "job_state_corrupt", Message: "durable job state is invalid and was quarantined",
		Details: map[string]any{"reason": reason, "quarantine": filepath.Base(target)},
	}
}

func validateJobRecord(record JobRecord) error {
	if record.IdempotencyHash == "" || record.JobID == "" || record.PeerFingerprint == "" || record.RequestHash == "" || record.UpdatedAt < 0 || record.ExpiresAt <= record.UpdatedAt {
		return errors.New("job record fields are invalid")
	}
	if record.State != JobActive && record.State != JobCompleted && record.State != JobFailed && record.State != JobInterrupted {
		return errors.New("job record state is invalid")
	}
	if record.State == JobActive && record.Response != nil {
		return errors.New("active job cannot have a terminal response")
	}
	if record.State != JobActive && record.Response == nil {
		return errors.New("terminal job requires a response")
	}
	return nil
}

func checksumPayload(payload jobStorePayload) (string, error) {
	data, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(data)
	return "sha256:" + hex.EncodeToString(digest[:]), nil
}

func idempotencyHash(peerFingerprint, key string) string {
	digest := sha256.Sum256([]byte(peerFingerprint + "\x00" + key))
	return "sha256:" + hex.EncodeToString(digest[:])
}

func cloneJobRecord(record JobRecord) JobRecord {
	if record.Response == nil {
		return record
	}
	encoded, _ := json.Marshal(record.Response)
	var response StoredResponse
	_ = json.Unmarshal(encoded, &response)
	record.Response = &response
	return record
}

func gatewayError(code, message string) error {
	return &security.SecurityError{Code: code, Message: message, Details: map[string]any{}}
}
