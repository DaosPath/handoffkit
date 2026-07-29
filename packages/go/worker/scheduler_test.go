package worker

import (
	"testing"
	"time"

	"github.com/DaosPath/handoffkit/go/contract"
)

func TestRegistryAndSchedulerRecovery(t *testing.T) {
	registry, err := NewRegistry(time.Second, 2*time.Second)
	if err != nil { t.Fatal(err) }
	_, err = registry.Register(contract.WorkerCapabilities{WorkerID: "go-1", Runtime: "go", OS: "linux", Architecture: "amd64", CPUCores: 4, Operations: []string{"evaluate"}, Metadata: map[string]any{}})
	if err != nil { t.Fatal(err) }
	scheduler, err := NewScheduler(registry, 2, time.Millisecond, 16, 16)
	if err != nil { t.Fatal(err) }
	job := contract.DistributedJob{JobID: "job-1", Operation: "evaluate", Payload: map[string]any{"input": 1}, RequestedCapabilities: []string{"evaluate"}, IdempotencyKey: "key-1", Metadata: map[string]any{}}
	if fresh, err := scheduler.Submit(job); err != nil || !fresh { t.Fatal("submit failed", err) }
	if fresh, _ := scheduler.Submit(job); fresh { t.Fatal("duplicate job accepted") }
	first, err := scheduler.Schedule()
	if err != nil || first == nil { t.Fatal("job was not scheduled", err) }
	if !scheduler.Fail(first.AssignmentID, true) { t.Fatal("assignment fail not recorded") }
	second, err := scheduler.Schedule()
	if err != nil || second.Attempt != 2 { t.Fatal("retry attempt missing", err) }
	if count := scheduler.RecoverExpired(time.Now().Add(time.Hour)); count != 1 { t.Fatalf("expected one recovery, got %d", count) }
	if scheduler.Snapshot().Failed != 1 { t.Fatal("terminal failure not counted") }
}

func TestSchedulerRetryNeverExceedsQueueCapacity(t *testing.T) {
	registry, err := NewRegistry(time.Second, 2*time.Second)
	if err != nil { t.Fatal(err) }
	_, err = registry.Register(contract.WorkerCapabilities{WorkerID: "go-1", Runtime: "go", OS: "linux", Architecture: "amd64", CPUCores: 4, Operations: []string{"evaluate"}, Metadata: map[string]any{}})
	if err != nil { t.Fatal(err) }
	scheduler, err := NewScheduler(registry, 3, time.Second, 1, 16)
	if err != nil { t.Fatal(err) }
	first := contract.DistributedJob{JobID: "job-1", Operation: "evaluate", Payload: map[string]any{}, RequestedCapabilities: []string{"evaluate"}, IdempotencyKey: "key-1", Metadata: map[string]any{}}
	second := contract.DistributedJob{JobID: "job-2", Operation: "evaluate", Payload: map[string]any{}, RequestedCapabilities: []string{"evaluate"}, IdempotencyKey: "key-2", Metadata: map[string]any{}}
	if accepted, err := scheduler.Submit(first); err != nil || !accepted { t.Fatal(err) }
	assignment, err := scheduler.Schedule()
	if err != nil || assignment == nil { t.Fatal("first job was not assigned", err) }
	if accepted, err := scheduler.Submit(second); err != nil || !accepted { t.Fatal(err) }
	if !scheduler.Fail(assignment.AssignmentID, true) { t.Fatal("assignment failure was not recorded") }
	snapshot := scheduler.Snapshot()
	if snapshot.Queued != 1 || snapshot.Failed != 1 { t.Fatalf("unbounded retry: %#v", snapshot) }
}
