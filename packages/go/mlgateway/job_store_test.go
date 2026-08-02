package mlgateway

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/DaosPath/handoffkit/go/security"
)

func requireGatewayCode(t *testing.T, err error, code string) {
	t.Helper()
	var value *security.SecurityError
	if !errors.As(err, &value) || value.Code != code {
		t.Fatalf("expected %s, got %#v", code, err)
	}
}

func TestJobStorePersistsIdempotencyAndTerminalResult(t *testing.T) {
	path := filepath.Join(t.TempDir(), "jobs.json")
	options := DefaultJobStoreOptions()
	store, err := NewJobStore(path, options)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().Unix()
	record, found, err := store.LookupOrBegin("sha256:peer", "idem-1", "sha256:request", "job-1", now)
	if err != nil || found || record.State != JobActive {
		t.Fatalf("begin failed: %#v, %v, %v", record, found, err)
	}
	duplicate, found, err := store.LookupOrBegin("sha256:peer", "idem-1", "sha256:request", "job-1", now+1)
	if err != nil || !found || duplicate.IdempotencyHash != record.IdempotencyHash {
		t.Fatalf("lookup failed: %#v, %v, %v", duplicate, found, err)
	}
	_, _, err = store.LookupOrBegin("sha256:peer", "idem-1", "sha256:different", "job-1", now+1)
	requireGatewayCode(t, err, "idempotency_conflict")
	response := StoredResponse{
		Kind: "job_result", PayloadType: "artifact_ref",
		Payload: map[string]any{"artifact_id": "checkpoint-1"},
	}
	if err := store.Complete(record.IdempotencyHash, JobCompleted, response, now+2); err != nil {
		t.Fatal(err)
	}
	reloaded, err := NewJobStore(path, options)
	if err != nil {
		t.Fatal(err)
	}
	stored, ok := reloaded.Record(record.IdempotencyHash)
	if !ok || stored.State != JobCompleted || stored.Response == nil || stored.Response.Kind != "job_result" {
		t.Fatalf("terminal result did not persist: %#v", stored)
	}
}

func TestJobStoreMarksActiveJobInterruptedAfterRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "jobs.json")
	options := DefaultJobStoreOptions()
	store, err := NewJobStore(path, options)
	if err != nil {
		t.Fatal(err)
	}
	record, _, err := store.LookupOrBegin("sha256:peer", "idem-active", "sha256:request", "job-active", time.Now().Unix())
	if err != nil {
		t.Fatal(err)
	}
	reloaded, err := NewJobStore(path, options)
	if err != nil {
		t.Fatal(err)
	}
	interrupted, ok := reloaded.Record(record.IdempotencyHash)
	if !ok || interrupted.State != JobInterrupted || interrupted.Response == nil || interrupted.Response.Payload["code"] != "worker_interrupted" {
		t.Fatalf("active job was not safely interrupted: %#v", interrupted)
	}
}

func TestJobStoreQuarantinesCorruptionAndIgnoresOrphanTemp(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "jobs.json")
	if err := os.WriteFile(path, []byte("{\"truncated\":"), 0o600); err != nil {
		t.Fatal(err)
	}
	_, err := NewJobStore(path, DefaultJobStoreOptions())
	requireGatewayCode(t, err, "job_state_corrupt")
	matches, err := filepath.Glob(path + ".corrupt-*")
	if err != nil || len(matches) != 1 {
		t.Fatalf("corrupt state was not quarantined: %v, %v", matches, err)
	}
	if err := os.WriteFile(filepath.Join(directory, ".handoffkit-job-state-orphan.tmp"), []byte("partial"), 0o600); err != nil {
		t.Fatal(err)
	}
	store, err := NewJobStore(path, DefaultJobStoreOptions())
	if err != nil || store.Status()["records"] != 0 {
		t.Fatalf("orphan temp affected empty recovery: %v, %#v", err, store.Status())
	}

	record, _, err := store.LookupOrBegin("sha256:peer", "idem", "sha256:req", "job", time.Now().Unix())
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil {
		t.Fatal(err)
	}
	value["checksum"] = "sha256:" + string(make([]byte, 64))
	raw, _ = json.Marshal(value)
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	_, err = NewJobStore(path, DefaultJobStoreOptions())
	requireGatewayCode(t, err, "job_state_corrupt")
	_ = record
}

func TestJobStoreFailsClosedOnCapacityAndWriteFailure(t *testing.T) {
	options := DefaultJobStoreOptions()
	options.MaxRecords = 1
	path := filepath.Join(t.TempDir(), "jobs.json")
	store, err := NewJobStore(path, options)
	if err != nil {
		t.Fatal(err)
	}
	_, _, err = store.LookupOrBegin("peer", "one", "request-one", "job-one", time.Now().Unix())
	if err != nil {
		t.Fatal(err)
	}
	_, _, err = store.LookupOrBegin("peer", "two", "request-two", "job-two", time.Now().Unix())
	requireGatewayCode(t, err, "job_state_capacity")

	failing, err := NewJobStore(filepath.Join(t.TempDir(), "jobs.json"), DefaultJobStoreOptions())
	if err != nil {
		t.Fatal(err)
	}
	failing.writeFailure = func() error { return errors.New("simulated disk full") }
	_, _, err = failing.LookupOrBegin("peer", "fail", "request", "job", time.Now().Unix())
	requireGatewayCode(t, err, "job_state_write_failed")
	if failing.Status()["records"] != 0 {
		t.Fatal("failed durable write advanced in-memory state")
	}
}
