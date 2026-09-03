package worker

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/DaosPath/handoffkit/go/contract"
	"github.com/DaosPath/handoffkit/go/security"
)

func TestSchedulerRejectsExactlyOnceRequestBeforeDeduplication(t *testing.T) {
	registry, err := NewRegistry(time.Second, 2*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	scheduler, err := NewScheduler(registry, 3, time.Second, 16, 16)
	if err != nil {
		t.Fatal(err)
	}
	job := contract.DistributedJob{
		JobID: "job-exactly-once", Operation: "evaluate", Payload: map[string]any{},
		IdempotencyKey: "key-exactly-once", Metadata: map[string]any{"require_exactly_once": true},
	}
	accepted, submitErr := scheduler.Submit(job)
	if accepted {
		t.Fatal("exactly-once request was accepted")
	}
	var structured *security.SecurityError
	if !errors.As(submitErr, &structured) || structured.Code != "exactly_once_unavailable" {
		t.Fatalf("unexpected exactly-once error: %#v", submitErr)
	}
	if scheduler.Snapshot().SeenJobs != 0 {
		t.Fatal("rejected exactly-once request polluted deduplication state")
	}
}

func TestRegistryAndSchedulerRecovery(t *testing.T) {
	registry, err := NewRegistry(time.Second, 2*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	_, err = registry.Register(contract.WorkerCapabilities{WorkerID: "go-1", Runtime: "go", OS: "linux", Architecture: "amd64", CPUCores: 4, Operations: []string{"evaluate"}, Metadata: map[string]any{}})
	if err != nil {
		t.Fatal(err)
	}
	scheduler, err := NewScheduler(registry, 2, time.Millisecond, 16, 16)
	if err != nil {
		t.Fatal(err)
	}
	job := contract.DistributedJob{JobID: "job-1", Operation: "evaluate", Payload: map[string]any{"input": 1}, RequestedCapabilities: []string{"evaluate"}, IdempotencyKey: "key-1", Metadata: map[string]any{}}
	if fresh, err := scheduler.Submit(job); err != nil || !fresh {
		t.Fatal("submit failed", err)
	}
	if fresh, _ := scheduler.Submit(job); fresh {
		t.Fatal("duplicate job accepted")
	}
	first, err := scheduler.Schedule()
	if err != nil || first == nil {
		t.Fatal("job was not scheduled", err)
	}
	if failed, err := scheduler.Fail(first.AssignmentID, true); err != nil || !failed {
		t.Fatal("assignment fail not recorded")
	}
	second, err := scheduler.Schedule()
	if err != nil || second.Attempt != 2 {
		t.Fatal("retry attempt missing", err)
	}
	if count, err := scheduler.RecoverExpired(time.Now().Add(time.Hour)); err != nil || count != 1 {
		t.Fatalf("expected one recovery, got %d", count)
	}
	if scheduler.Snapshot().Failed != 1 {
		t.Fatal("terminal failure not counted")
	}
}

func TestSchedulerRetryNeverExceedsQueueCapacity(t *testing.T) {
	registry, err := NewRegistry(time.Second, 2*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	_, err = registry.Register(contract.WorkerCapabilities{WorkerID: "go-1", Runtime: "go", OS: "linux", Architecture: "amd64", CPUCores: 4, Operations: []string{"evaluate"}, Metadata: map[string]any{}})
	if err != nil {
		t.Fatal(err)
	}
	scheduler, err := NewScheduler(registry, 3, time.Second, 1, 16)
	if err != nil {
		t.Fatal(err)
	}
	first := contract.DistributedJob{JobID: "job-1", Operation: "evaluate", Payload: map[string]any{}, RequestedCapabilities: []string{"evaluate"}, IdempotencyKey: "key-1", Metadata: map[string]any{}}
	second := contract.DistributedJob{JobID: "job-2", Operation: "evaluate", Payload: map[string]any{}, RequestedCapabilities: []string{"evaluate"}, IdempotencyKey: "key-2", Metadata: map[string]any{}}
	if accepted, err := scheduler.Submit(first); err != nil || !accepted {
		t.Fatal(err)
	}
	assignment, err := scheduler.Schedule()
	if err != nil || assignment == nil {
		t.Fatal("first job was not assigned", err)
	}
	if accepted, err := scheduler.Submit(second); err != nil || !accepted {
		t.Fatal(err)
	}
	if failed, err := scheduler.Fail(assignment.AssignmentID, true); err != nil || !failed {
		t.Fatal("assignment failure was not recorded")
	}
	snapshot := scheduler.Snapshot()
	if snapshot.Queued != 1 || snapshot.Failed != 1 {
		t.Fatalf("unbounded retry: %#v", snapshot)
	}
}

func TestDurableSchedulerMarksInflightInterruptedAndRequiresExplicitRetry(t *testing.T) {
	statePath := filepath.Join(t.TempDir(), "scheduler-state.json")
	firstStore, err := NewFileSchedulerStateStore(statePath, 0)
	if err != nil {
		t.Fatal(err)
	}
	firstRegistry := schedulerRegistry(t, "worker-first")
	first, err := NewSchedulerWithStore(firstRegistry, 3, time.Second, 16, 16, firstStore)
	if err != nil {
		t.Fatal(err)
	}
	job := schedulerJob("job-durable", "key-durable")
	if accepted, err := first.Submit(job); err != nil || !accepted {
		t.Fatal("durable submit failed", err)
	}
	initial, err := first.Schedule()
	if err != nil || initial == nil || initial.Attempt != 1 {
		t.Fatal("initial assignment failed", err)
	}

	secondStore, err := NewFileSchedulerStateStore(statePath, 0)
	if err != nil {
		t.Fatal(err)
	}
	second, err := NewSchedulerWithStore(
		schedulerRegistry(t, "worker-second"), 3, time.Second, 16, 16, secondStore,
	)
	if err != nil {
		t.Fatal(err)
	}
	snapshot := second.Snapshot()
	if snapshot.Assigned != 0 || snapshot.Interrupted != 1 || snapshot.SeenJobs != 1 {
		t.Fatalf("unexpected restart state: %#v", snapshot)
	}
	if accepted, err := second.Submit(job); err != nil || accepted {
		t.Fatal("durable scheduler accepted duplicate", err)
	}
	interrupted := second.ListInterrupted()
	if len(interrupted) != 1 || interrupted[0].AssignmentID != initial.AssignmentID {
		t.Fatalf("interrupted assignment missing: %#v", interrupted)
	}
	if retried, err := second.RetryInterrupted(initial.AssignmentID); err != nil || !retried {
		t.Fatal("explicit retry failed", err)
	}
	retry, err := second.Schedule()
	if err != nil || retry == nil || retry.Attempt != 2 {
		t.Fatal("retry assignment failed", err)
	}
	if completed, err := second.Complete(retry.AssignmentID); err != nil || !completed {
		t.Fatal("durable completion failed", err)
	}

	thirdStore, err := NewFileSchedulerStateStore(statePath, 0)
	if err != nil {
		t.Fatal(err)
	}
	third, err := NewSchedulerWithStore(
		schedulerRegistry(t, "worker-third"), 3, time.Second, 16, 16, thirdStore,
	)
	if err != nil {
		t.Fatal(err)
	}
	final := third.Snapshot()
	if final.Queued != 0 || final.Assigned != 0 || final.Interrupted != 0 || final.Completed != 1 {
		t.Fatalf("terminal state did not survive restart: %#v", final)
	}
}

func TestDurableSchedulerAutoResumeIsAtLeastOnce(t *testing.T) {
	statePath := filepath.Join(t.TempDir(), "scheduler-state.json")
	store, err := NewFileSchedulerStateStore(statePath, 0)
	if err != nil {
		t.Fatal(err)
	}
	first, err := NewSchedulerWithStore(schedulerRegistry(t, "worker-first"), 3, time.Second, 16, 16, store)
	if err != nil {
		t.Fatal(err)
	}
	if accepted, err := first.Submit(schedulerJob("job-auto", "key-auto")); err != nil || !accepted {
		t.Fatal(err)
	}
	if assignment, err := first.Schedule(); err != nil || assignment == nil {
		t.Fatal("initial assignment failed", err)
	}
	resumed, err := NewSchedulerWithStoreAutoResume(
		schedulerRegistry(t, "worker-second"), 3, time.Second, 16, 16, store,
	)
	if err != nil {
		t.Fatal(err)
	}
	if snapshot := resumed.Snapshot(); snapshot.Interrupted != 0 || snapshot.Queued != 1 {
		t.Fatalf("unexpected auto-resume state: %#v", snapshot)
	}
	assignment, err := resumed.Schedule()
	if err != nil || assignment == nil || assignment.Attempt != 2 {
		t.Fatal("auto-resume assignment failed", err)
	}
}

func TestDurableSchedulerMigratesSupportedV0Envelope(t *testing.T) {
	statePath := filepath.Join(t.TempDir(), "scheduler-state.json")
	store, err := NewFileSchedulerStateStore(statePath, 0)
	if err != nil {
		t.Fatal(err)
	}
	first, err := NewSchedulerWithStore(schedulerRegistry(t, "worker-first"), 3, time.Second, 16, 16, store)
	if err != nil {
		t.Fatal(err)
	}
	if accepted, err := first.Submit(schedulerJob("job-v0", "key-v0")); err != nil || !accepted {
		t.Fatal(err)
	}
	if assignment, err := first.Schedule(); err != nil || assignment == nil {
		t.Fatal("initial assignment failed", err)
	}
	payload, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	var legacy map[string]any
	if err := json.Unmarshal(payload, &legacy); err != nil {
		t.Fatal(err)
	}
	delete(legacy, "interrupted")
	legacy["format_version"] = float64(0)
	encoded, err := json.Marshal(legacy)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Commit(encoded); err != nil {
		t.Fatal(err)
	}
	migrated, err := NewSchedulerWithStore(schedulerRegistry(t, "worker-third"), 3, time.Second, 16, 16, store)
	if err != nil {
		t.Fatal(err)
	}
	if migrated.Snapshot().Interrupted != 1 {
		t.Fatalf("legacy state was not migrated: %#v", migrated.Snapshot())
	}
	migratedPayload, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	var current map[string]any
	if err := json.Unmarshal(migratedPayload, &current); err != nil {
		t.Fatal(err)
	}
	if current["format_version"] != float64(1) {
		t.Fatalf("unexpected migrated version: %#v", current["format_version"])
	}
}

func TestDurableSchedulerQuarantinesChecksumTamper(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "scheduler-state.json")
	store, err := NewFileSchedulerStateStore(statePath, 0)
	if err != nil {
		t.Fatal(err)
	}
	scheduler, err := NewSchedulerWithStore(
		schedulerRegistry(t, "worker"), 3, time.Second, 16, 16, store,
	)
	if err != nil {
		t.Fatal(err)
	}
	if accepted, err := scheduler.Submit(schedulerJob("job-1", "key-1")); err != nil || !accepted {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(statePath)
	if err != nil {
		t.Fatal(err)
	}
	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil {
		t.Fatal(err)
	}
	value["completed"] = float64(99)
	tampered, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(statePath, tampered, 0o600); err != nil {
		t.Fatal(err)
	}
	corruptStore, err := NewFileSchedulerStateStore(statePath, 0)
	if err != nil {
		t.Fatal(err)
	}
	_, err = NewSchedulerWithStore(
		schedulerRegistry(t, "worker"), 3, time.Second, 16, 16, corruptStore,
	)
	var stateError *SchedulerStateError
	if !errors.As(err, &stateError) || stateError.Code != "security_state_corrupt" {
		t.Fatalf("expected quarantined corruption, got %v", err)
	}
	matches, err := filepath.Glob(statePath + ".corrupt-*")
	if err != nil || len(matches) != 1 {
		t.Fatalf("quarantine file missing: %v %v", matches, err)
	}
}

type failingSchedulerStore struct {
	committed bool
	payload   []byte
}

func (store *failingSchedulerStore) Load() ([]byte, error) { return nil, nil }

func (store *failingSchedulerStore) Commit(payload []byte) error {
	store.payload = append([]byte(nil), payload...)
	if store.committed {
		return schedulerCommittedStateError("directory sync uncertain", nil)
	}
	return errors.New("storage unavailable")
}

func (store *failingSchedulerStore) Quarantine(string) error {
	return errors.New("unexpected quarantine")
}

func TestSchedulerCommitOutcomeControlsRollback(t *testing.T) {
	job := schedulerJob("job-commit", "key-commit")
	uncommitted, err := NewSchedulerWithStore(
		schedulerRegistry(t, "worker-uncommitted"), 3, time.Second, 16, 16,
		&failingSchedulerStore{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if accepted, err := uncommitted.Submit(job); err == nil || accepted {
		t.Fatal("pre-commit failure must reject and roll back")
	}
	if snapshot := uncommitted.Snapshot(); snapshot.Queued != 0 || snapshot.SeenJobs != 0 {
		t.Fatalf("pre-commit mutation survived: %#v", snapshot)
	}

	store := &failingSchedulerStore{committed: true}
	committed, err := NewSchedulerWithStore(
		schedulerRegistry(t, "worker-committed"), 3, time.Second, 16, 16, store,
	)
	if err != nil {
		t.Fatal(err)
	}
	accepted, err := committed.Submit(job)
	var stateError *SchedulerStateError
	if accepted || !errors.As(err, &stateError) || !stateError.Committed {
		t.Fatalf("expected committed durability error, got accepted=%v err=%v", accepted, err)
	}
	if snapshot := committed.Snapshot(); snapshot.Queued != 1 || snapshot.SeenJobs != 1 {
		t.Fatalf("committed mutation was rolled back: %#v", snapshot)
	}
	if committed.StateGeneration() != 1 || len(store.payload) == 0 {
		t.Fatal("committed generation or payload missing")
	}
	if accepted, err := committed.Submit(job); err != nil || accepted {
		t.Fatal("committed duplicate was accepted", err)
	}
}

func TestSchedulerNeverEvictsActiveDedupIdentity(t *testing.T) {
	scheduler, err := NewScheduler(schedulerRegistry(t, "worker"), 3, time.Second, 2, 1)
	if err != nil {
		t.Fatal(err)
	}
	if accepted, err := scheduler.Submit(schedulerJob("job-1", "key-1")); err != nil || !accepted {
		t.Fatal(err)
	}
	if accepted, err := scheduler.Submit(schedulerJob("job-1", "key-2")); err != nil || accepted {
		t.Fatal("duplicate job ID was accepted", err)
	}
	if accepted, err := scheduler.Submit(schedulerJob("job-2", "key-2")); err == nil || accepted {
		t.Fatal("active dedup identity was evicted")
	}
	if snapshot := scheduler.Snapshot(); snapshot.Queued != 1 || snapshot.SeenJobs != 1 {
		t.Fatalf("unexpected dedup state: %#v", snapshot)
	}
}

func TestGoLoadsSharedDurableSchedulerFixture(t *testing.T) {
	fixture := filepath.Join("..", "..", "..", "shared", "contracts", "test-fixtures", "runtime", "durable-scheduler-v1.json")
	raw, err := os.ReadFile(fixture)
	if err != nil {
		t.Fatal(err)
	}
	statePath := filepath.Join(t.TempDir(), "scheduler-state.json")
	if err := os.WriteFile(statePath, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	store, err := NewFileSchedulerStateStore(statePath, 0)
	if err != nil {
		t.Fatal(err)
	}
	scheduler, err := NewSchedulerWithStore(
		schedulerRegistry(t, "worker"), 3, time.Second, 16, 32, store,
	)
	if err != nil {
		t.Fatal(err)
	}
	snapshot := scheduler.Snapshot()
	if snapshot.Queued != 1 || snapshot.Assigned != 0 || snapshot.Interrupted != 1 ||
		snapshot.Completed != 2 || snapshot.Failed != 1 || snapshot.SeenJobs != 3 {
		t.Fatalf("shared scheduler fixture mismatch: %#v", snapshot)
	}
	if scheduler.StateGeneration() != 7 {
		t.Fatalf("unexpected generation %d", scheduler.StateGeneration())
	}
	interrupted := scheduler.ListInterrupted()
	if len(interrupted) != 1 || interrupted[0].AssignmentID != "assignment-scheduler-interrupted" {
		t.Fatalf("shared interrupted assignment missing: %#v", interrupted)
	}
}

func TestSchedulerStateBackupAndRestorePreserveValidatedState(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "scheduler-state.json")
	backupPath := filepath.Join(root, "backups", "scheduler-state.json")
	store, err := NewFileSchedulerStateStore(statePath, 0)
	if err != nil {
		t.Fatal(err)
	}
	scheduler, err := NewSchedulerWithStore(
		schedulerRegistry(t, "worker"), 3, time.Second, 16, 16, store,
	)
	if err != nil {
		t.Fatal(err)
	}
	if accepted, err := scheduler.Submit(schedulerJob("job-backup", "key-backup")); err != nil || !accepted {
		t.Fatal(err)
	}
	if err := store.Backup(backupPath); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(statePath); err != nil {
		t.Fatal(err)
	}
	if err := store.Restore(backupPath); err != nil {
		t.Fatal(err)
	}
	restoredStore, err := NewFileSchedulerStateStore(statePath, 0)
	if err != nil {
		t.Fatal(err)
	}
	restored, err := NewSchedulerWithStore(
		schedulerRegistry(t, "worker-restored"), 3, time.Second, 16, 16, restoredStore,
	)
	if err != nil {
		t.Fatal(err)
	}
	if snapshot := restored.Snapshot(); snapshot.Queued != 1 || snapshot.SeenJobs != 1 {
		t.Fatalf("restored state mismatch: %#v", snapshot)
	}
}

func schedulerRegistry(t *testing.T, workerID string) *Registry {
	t.Helper()
	registry, err := NewRegistry(time.Second, 2*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	_, err = registry.Register(contract.WorkerCapabilities{
		WorkerID: workerID, Runtime: "go", OS: "test", Architecture: "amd64",
		CPUCores: 4, Operations: []string{"evaluate"}, Metadata: map[string]any{},
	})
	if err != nil {
		t.Fatal(err)
	}
	return registry
}

func schedulerJob(jobID, key string) contract.DistributedJob {
	return contract.DistributedJob{
		JobID: jobID, Operation: "evaluate", Payload: map[string]any{"input": 1},
		RequestedCapabilities: []string{"evaluate"}, IdempotencyKey: key, Metadata: map[string]any{},
	}
}
