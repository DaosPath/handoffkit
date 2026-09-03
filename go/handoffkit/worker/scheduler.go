package worker

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"sync"
	"sync/atomic"
	"time"

	"github.com/DaosPath/handoffkit/go/contract"
	"github.com/DaosPath/handoffkit/go/security"
)

var assignmentSequence atomic.Uint64

type Snapshot struct {
	Queued      int `json:"queued"`
	Assigned    int `json:"assigned"`
	Interrupted int `json:"interrupted"`
	Completed   int `json:"completed"`
	Failed      int `json:"failed"`
	SeenJobs    int `json:"seen_jobs"`
}

type Scheduler struct {
	mu            sync.Mutex
	registry      *Registry
	maxAttempts   uint32
	lease         time.Duration
	queueCapacity int
	dedupCapacity int
	queue         []queuedSchedulerJob
	assignments   map[string]assignedSchedulerJob
	interrupted   map[string]interruptedSchedulerJob
	seen          map[string]string
	seenOrder     []string
	completed     int
	failed        int
	generation    uint64
	stateStore    SchedulerStateStore
}

func NewScheduler(registry *Registry, maxAttempts uint32, lease time.Duration, queueCapacity, dedupCapacity int) (*Scheduler, error) {
	return newScheduler(registry, maxAttempts, lease, queueCapacity, dedupCapacity, nil, false)
}

func NewSchedulerWithStore(
	registry *Registry,
	maxAttempts uint32,
	lease time.Duration,
	queueCapacity int,
	dedupCapacity int,
	stateStore SchedulerStateStore,
) (*Scheduler, error) {
	if stateStore == nil {
		return nil, errors.New("scheduler state store is required")
	}
	return newScheduler(registry, maxAttempts, lease, queueCapacity, dedupCapacity, stateStore, false)
}

// NewSchedulerWithStoreAutoResume opts into at-least-once restart recovery.
// It never provides an exactly-once side-effect guarantee.
func NewSchedulerWithStoreAutoResume(
	registry *Registry,
	maxAttempts uint32,
	lease time.Duration,
	queueCapacity int,
	dedupCapacity int,
	stateStore SchedulerStateStore,
) (*Scheduler, error) {
	if stateStore == nil {
		return nil, errors.New("scheduler state store is required")
	}
	return newScheduler(registry, maxAttempts, lease, queueCapacity, dedupCapacity, stateStore, true)
}

func newScheduler(
	registry *Registry,
	maxAttempts uint32,
	lease time.Duration,
	queueCapacity int,
	dedupCapacity int,
	stateStore SchedulerStateStore,
	autoResume bool,
) (*Scheduler, error) {
	if registry == nil || maxAttempts < 1 || lease <= 0 || queueCapacity < 1 || dedupCapacity < 1 {
		return nil, errors.New("scheduler configuration is invalid")
	}
	scheduler := &Scheduler{
		registry: registry, maxAttempts: maxAttempts, lease: lease,
		queueCapacity: queueCapacity, dedupCapacity: dedupCapacity,
		assignments: map[string]assignedSchedulerJob{}, interrupted: map[string]interruptedSchedulerJob{},
		seen: map[string]string{}, stateStore: stateStore,
	}
	if stateStore != nil {
		if err := scheduler.loadState(); err != nil {
			return nil, err
		}
		if autoResume {
			if err := scheduler.AutoResumeInterrupted(); err != nil {
				return nil, err
			}
		}
	}
	return scheduler, nil
}

func (s *Scheduler) Submit(job contract.DistributedJob) (bool, error) {
	if err := job.Validate(); err != nil {
		return false, err
	}
	if requested, present := job.Metadata["require_exactly_once"]; present {
		if requestedBool, ok := requested.(bool); !ok || requestedBool {
			return false, &security.SecurityError{
				Code:    "exactly_once_unavailable",
				Message: "Exactly-once external effects are unavailable; refusing fallback to at-least-once.",
				Details: map[string]any{"runtime": "go"},
			}
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.isDuplicateLocked(job) {
		return false, nil
	}
	if len(s.queue) >= s.queueCapacity {
		return false, errors.New("distributed scheduler queue is at capacity")
	}
	previous := s.stateLocked(s.generation)
	if err := s.claimSeenLocked(job); err != nil {
		s.restoreLocked(previous)
		return false, err
	}
	s.queue = append(s.queue, queuedSchedulerJob{Attempt: 1, Job: job})
	if err := s.persistLocked(); err != nil {
		if !schedulerCommitApplied(err) {
			s.restoreLocked(previous)
		}
		return false, err
	}
	return true, nil
}

func (s *Scheduler) Schedule() (*contract.JobAssignment, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.assignments)+len(s.interrupted) >= s.queueCapacity {
		return nil, nil
	}
	queued := len(s.queue)
	for index := 0; index < queued; index++ {
		previous := s.stateLocked(s.generation)
		queuedJob := s.queue[0]
		s.queue = s.queue[1:]
		job := queuedJob.Job
		worker, ok := s.registry.Reserve(job.RequestedCapabilities)
		if !ok {
			s.queue = append(s.queue, queuedJob)
			continue
		}
		now := time.Now().UTC()
		assignment := contract.JobAssignment{
			AssignmentID: fmt.Sprintf("assignment-%d", assignmentSequence.Add(1)),
			JobID:        job.JobID, WorkerID: worker.Capabilities.WorkerID, Attempt: queuedJob.Attempt,
			AssignedAt: now.Format(time.RFC3339Nano), LeaseDeadline: now.Add(s.lease).Format(time.RFC3339Nano),
			Payload: job.Payload, Metadata: cloneMap(job.Metadata),
		}
		assignment.Metadata["operation"] = job.Operation
		assignment.Metadata["idempotency_key"] = job.IdempotencyKey
		if err := assignment.Validate(); err != nil {
			s.restoreLocked(previous)
			_ = s.registry.Release(worker.Capabilities.WorkerID)
			return nil, err
		}
		s.assignments[assignment.AssignmentID] = assignedSchedulerJob{Assignment: assignment, Job: job}
		if err := s.persistLocked(); err != nil {
			if !schedulerCommitApplied(err) {
				s.restoreLocked(previous)
				_ = s.registry.Release(worker.Capabilities.WorkerID)
			}
			return nil, err
		}
		return &assignment, nil
	}
	return nil, nil
}

func (s *Scheduler) Complete(assignmentID string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	state, exists := s.assignments[assignmentID]
	if !exists {
		return false, nil
	}
	previous := s.stateLocked(s.generation)
	delete(s.assignments, assignmentID)
	s.completed++
	if err := s.persistLocked(); err != nil {
		if schedulerCommitApplied(err) {
			_ = s.registry.Release(state.Assignment.WorkerID)
		} else {
			s.restoreLocked(previous)
		}
		return false, err
	}
	_ = s.registry.Release(state.Assignment.WorkerID)
	return true, nil
}

func (s *Scheduler) Fail(assignmentID string, retryable bool) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	state, exists := s.assignments[assignmentID]
	if !exists {
		return false, nil
	}
	previous := s.stateLocked(s.generation)
	s.failLocked(assignmentID, retryable)
	if err := s.persistLocked(); err != nil {
		if schedulerCommitApplied(err) {
			_ = s.registry.Release(state.Assignment.WorkerID)
		} else {
			s.restoreLocked(previous)
		}
		return false, err
	}
	_ = s.registry.Release(state.Assignment.WorkerID)
	return true, nil
}

func (s *Scheduler) failLocked(assignmentID string, retryable bool) bool {
	state, exists := s.assignments[assignmentID]
	if !exists {
		return false
	}
	delete(s.assignments, assignmentID)
	nextAttempt := state.Assignment.Attempt + 1
	if retryable && nextAttempt <= s.maxAttempts && len(s.queue) < s.queueCapacity {
		s.queue = append([]queuedSchedulerJob{{Attempt: nextAttempt, Job: state.Job}}, s.queue...)
	} else {
		s.failed++
	}
	return true
}

func (s *Scheduler) RecoverWorker(workerID string) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	identifiers := []string{}
	states := []assignedSchedulerJob{}
	for assignmentID, state := range s.assignments {
		if state.Assignment.WorkerID == workerID {
			identifiers = append(identifiers, assignmentID)
			states = append(states, state)
		}
	}
	if len(identifiers) == 0 {
		return 0, nil
	}
	previous := s.stateLocked(s.generation)
	for _, assignmentID := range identifiers {
		s.failLocked(assignmentID, true)
	}
	if err := s.persistLocked(); err != nil {
		if schedulerCommitApplied(err) {
			for _, state := range states {
				_ = s.registry.Release(state.Assignment.WorkerID)
			}
		} else {
			s.restoreLocked(previous)
		}
		return 0, err
	}
	for _, state := range states {
		_ = s.registry.Release(state.Assignment.WorkerID)
	}
	return len(identifiers), nil
}

func (s *Scheduler) RecoverExpired(now time.Time) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	identifiers := []string{}
	states := []assignedSchedulerJob{}
	for assignmentID, state := range s.assignments {
		deadline, err := time.Parse(time.RFC3339Nano, state.Assignment.LeaseDeadline)
		if err == nil && !deadline.After(now) {
			identifiers = append(identifiers, assignmentID)
			states = append(states, state)
		}
	}
	if len(identifiers) == 0 {
		return 0, nil
	}
	previous := s.stateLocked(s.generation)
	for _, assignmentID := range identifiers {
		s.failLocked(assignmentID, true)
	}
	if err := s.persistLocked(); err != nil {
		if schedulerCommitApplied(err) {
			for _, state := range states {
				_ = s.registry.Release(state.Assignment.WorkerID)
			}
		} else {
			s.restoreLocked(previous)
		}
		return 0, err
	}
	for _, state := range states {
		_ = s.registry.Release(state.Assignment.WorkerID)
	}
	return len(identifiers), nil
}

func (s *Scheduler) ListInterrupted() []contract.JobAssignment {
	s.mu.Lock()
	defer s.mu.Unlock()
	identifiers := make([]string, 0, len(s.interrupted))
	for assignmentID := range s.interrupted {
		identifiers = append(identifiers, assignmentID)
	}
	sort.Strings(identifiers)
	result := make([]contract.JobAssignment, 0, len(identifiers))
	for _, assignmentID := range identifiers {
		result = append(result, s.interrupted[assignmentID].Assignment)
	}
	return result
}

func (s *Scheduler) RetryInterrupted(assignmentID string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	state, exists := s.interrupted[assignmentID]
	if !exists {
		return false, nil
	}
	if len(s.queue) >= s.queueCapacity {
		return false, errors.New("distributed scheduler queue is at capacity")
	}
	previous := s.stateLocked(s.generation)
	delete(s.interrupted, assignmentID)
	nextAttempt := state.Assignment.Attempt + 1
	if nextAttempt <= s.maxAttempts {
		s.queue = append([]queuedSchedulerJob{{Attempt: nextAttempt, Job: state.Job}}, s.queue...)
	} else {
		s.failed++
	}
	if err := s.persistLocked(); err != nil {
		if !schedulerCommitApplied(err) {
			s.restoreLocked(previous)
		}
		return false, err
	}
	return true, nil
}

// AutoResumeInterrupted requeues every restart-interrupted assignment in a
// deterministic order. This is explicitly at-least-once recovery.
func (s *Scheduler) AutoResumeInterrupted() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.interrupted) == 0 {
		return nil
	}
	previous := s.stateLocked(s.generation)
	identifiers := make([]string, 0, len(s.interrupted))
	for assignmentID := range s.interrupted {
		identifiers = append(identifiers, assignmentID)
	}
	sort.Strings(identifiers)
	for _, assignmentID := range identifiers {
		if len(s.queue) >= s.queueCapacity {
			s.restoreLocked(previous)
			return errors.New("distributed scheduler queue is at capacity")
		}
		state := s.interrupted[assignmentID]
		delete(s.interrupted, assignmentID)
		nextAttempt := state.Assignment.Attempt + 1
		if nextAttempt <= s.maxAttempts {
			s.queue = append([]queuedSchedulerJob{{Attempt: nextAttempt, Job: state.Job}}, s.queue...)
		} else {
			s.failed++
		}
	}
	if err := s.persistLocked(); err != nil {
		if !schedulerCommitApplied(err) {
			s.restoreLocked(previous)
		}
		return err
	}
	return nil
}

func (s *Scheduler) FailInterrupted(assignmentID string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.interrupted[assignmentID]; !exists {
		return false, nil
	}
	previous := s.stateLocked(s.generation)
	delete(s.interrupted, assignmentID)
	s.failed++
	if err := s.persistLocked(); err != nil {
		if !schedulerCommitApplied(err) {
			s.restoreLocked(previous)
		}
		return false, err
	}
	return true, nil
}

func (s *Scheduler) Snapshot() Snapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	return Snapshot{
		Queued: len(s.queue), Assigned: len(s.assignments), Interrupted: len(s.interrupted),
		Completed: s.completed, Failed: s.failed, SeenJobs: len(s.seen),
	}
}

func (s *Scheduler) StateGeneration() uint64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.generation
}

func (s *Scheduler) persistLocked() error {
	if s.stateStore == nil {
		return nil
	}
	if s.generation >= maxSchedulerSafeInteger || s.completed < 0 || s.failed < 0 ||
		uint64(s.completed) > maxSchedulerSafeInteger || uint64(s.failed) > maxSchedulerSafeInteger {
		return schedulerStateError("scheduler_state_invalid", "scheduler state counters exceed the interoperable integer range", nil)
	}
	generation := s.generation + 1
	state := s.stateLocked(generation)
	payload, err := canonicalSchedulerJSON(state)
	if err != nil {
		return schedulerStateError("security_state_encode", "scheduler state cannot be encoded", nil)
	}
	if err := s.stateStore.Commit(payload); err != nil {
		if schedulerCommitApplied(err) {
			s.generation = generation
		}
		return err
	}
	s.generation = generation
	return nil
}

func (s *Scheduler) stateLocked(generation uint64) schedulerState {
	inflightKeys := make([]string, 0, len(s.assignments))
	for assignmentID := range s.assignments {
		inflightKeys = append(inflightKeys, assignmentID)
	}
	sort.Strings(inflightKeys)
	inflight := make([]assignedSchedulerJob, 0, len(inflightKeys))
	for _, assignmentID := range inflightKeys {
		inflight = append(inflight, s.assignments[assignmentID])
	}
	interruptedKeys := make([]string, 0, len(s.interrupted))
	for assignmentID := range s.interrupted {
		interruptedKeys = append(interruptedKeys, assignmentID)
	}
	sort.Strings(interruptedKeys)
	interrupted := make([]interruptedSchedulerJob, 0, len(interruptedKeys))
	for _, assignmentID := range interruptedKeys {
		interrupted = append(interrupted, s.interrupted[assignmentID])
	}
	seen := make([]seenSchedulerJob, 0, len(s.seenOrder))
	for _, key := range s.seenOrder {
		if jobID, exists := s.seen[key]; exists {
			seen = append(seen, seenSchedulerJob{IdempotencyKey: key, JobID: jobID})
		}
	}
	return schedulerState{
		Completed: s.completed, Failed: s.failed, Format: SchedulerStateFormat,
		FormatVersion: SchedulerStateFormatVersion, Generation: generation,
		Inflight: inflight, Interrupted: interrupted,
		Queued: append([]queuedSchedulerJob(nil), s.queue...), Seen: seen,
	}
}

func (s *Scheduler) activeJobIDsLocked() map[string]struct{} {
	active := make(map[string]struct{}, len(s.queue)+len(s.assignments)+len(s.interrupted))
	for _, item := range s.queue {
		active[item.Job.JobID] = struct{}{}
	}
	for _, item := range s.assignments {
		active[item.Job.JobID] = struct{}{}
	}
	for _, item := range s.interrupted {
		active[item.Job.JobID] = struct{}{}
	}
	return active
}

func (s *Scheduler) isDuplicateLocked(job contract.DistributedJob) bool {
	if _, exists := s.seen[job.IdempotencyKey]; exists {
		return true
	}
	for _, jobID := range s.seen {
		if jobID == job.JobID {
			return true
		}
	}
	_, active := s.activeJobIDsLocked()[job.JobID]
	return active
}

func (s *Scheduler) claimSeenLocked(job contract.DistributedJob) error {
	if len(s.seen) >= s.dedupCapacity {
		active := s.activeJobIDsLocked()
		evictIndex := -1
		for index, key := range s.seenOrder {
			if _, isActive := active[s.seen[key]]; !isActive {
				evictIndex = index
				break
			}
		}
		if evictIndex < 0 {
			return errors.New("distributed scheduler deduplication state is at capacity")
		}
		delete(s.seen, s.seenOrder[evictIndex])
		s.seenOrder = append(s.seenOrder[:evictIndex], s.seenOrder[evictIndex+1:]...)
	}
	s.seen[job.IdempotencyKey] = job.JobID
	s.seenOrder = append(s.seenOrder, job.IdempotencyKey)
	return nil
}

func (s *Scheduler) restoreLocked(state schedulerState) {
	s.queue = append([]queuedSchedulerJob(nil), state.Queued...)
	s.assignments = map[string]assignedSchedulerJob{}
	for _, item := range state.Inflight {
		s.assignments[item.Assignment.AssignmentID] = item
	}
	s.interrupted = map[string]interruptedSchedulerJob{}
	for _, item := range state.Interrupted {
		s.interrupted[item.Assignment.AssignmentID] = item
	}
	s.seen = map[string]string{}
	s.seenOrder = nil
	for _, item := range state.Seen {
		s.seen[item.IdempotencyKey] = item.JobID
		s.seenOrder = append(s.seenOrder, item.IdempotencyKey)
	}
	s.completed = state.Completed
	s.failed = state.Failed
	s.generation = state.Generation
}

func (s *Scheduler) loadState() error {
	payload, err := s.stateStore.Load()
	if err != nil || payload == nil {
		return err
	}
	if migrated, changed, migrateErr := migrateSchedulerStatePayload(payload); migrateErr != nil {
		return s.stateStore.Quarantine(migrateErr.Error())
	} else if changed {
		if err := s.stateStore.Commit(migrated); err != nil {
			return err
		}
		payload = migrated
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	var state schedulerState
	if err := decodeSchedulerValue(decoder, &state); err != nil {
		return s.stateStore.Quarantine("scheduler state fields are invalid")
	}
	if err := s.validateState(state); err != nil {
		return s.stateStore.Quarantine(err.Error())
	}
	s.restoreLocked(state)
	if len(s.assignments) > 0 {
		for assignmentID, item := range s.assignments {
			s.interrupted[assignmentID] = interruptedSchedulerJob{
				Assignment: item.Assignment, Job: item.Job, Reason: "scheduler_restart",
			}
		}
		s.assignments = map[string]assignedSchedulerJob{}
		if err := s.persistLocked(); err != nil {
			return err
		}
	}
	return nil
}

func migrateSchedulerStatePayload(payload []byte) ([]byte, bool, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(payload, &fields); err != nil {
		return nil, false, errors.New("scheduler state fields are invalid")
	}
	var version int
	if raw, ok := fields["format_version"]; !ok || json.Unmarshal(raw, &version) != nil {
		return nil, false, nil
	}
	if version == SchedulerStateFormatVersion {
		return payload, false, nil
	}
	if version != 0 {
		return nil, false, errors.New("scheduler state format is unsupported")
	}
	expected := map[string]struct{}{
		"completed": {}, "failed": {}, "format": {}, "format_version": {},
		"generation": {}, "inflight": {}, "queued": {}, "seen": {},
	}
	if len(fields) != len(expected) {
		return nil, false, errors.New("scheduler v0 state fields are invalid")
	}
	for key := range fields {
		if _, ok := expected[key]; !ok {
			return nil, false, errors.New("scheduler v0 state fields are invalid")
		}
	}
	var format string
	if json.Unmarshal(fields["format"], &format) != nil || format != SchedulerStateFormat {
		return nil, false, errors.New("scheduler state format is unsupported")
	}
	fields["format_version"] = json.RawMessage("1")
	fields["interrupted"] = json.RawMessage("[]")
	migrated, err := json.Marshal(fields)
	if err != nil {
		return nil, false, errors.New("scheduler v0 state cannot be migrated")
	}
	return migrated, true, nil
}

func (s *Scheduler) validateState(state schedulerState) error {
	if state.Format != SchedulerStateFormat || state.FormatVersion != SchedulerStateFormatVersion {
		return errors.New("scheduler state format is unsupported")
	}
	if state.Completed < 0 || state.Failed < 0 {
		return errors.New("scheduler state counters are invalid")
	}
	if state.Generation > maxSchedulerSafeInteger || uint64(state.Completed) > maxSchedulerSafeInteger || uint64(state.Failed) > maxSchedulerSafeInteger {
		return errors.New("scheduler state counters exceed the interoperable integer range")
	}
	if len(state.Queued) > s.queueCapacity || len(state.Inflight)+len(state.Interrupted) > s.queueCapacity {
		return errors.New("scheduler state exceeds configured job capacity")
	}
	if len(state.Seen) > s.dedupCapacity {
		return errors.New("scheduler state exceeds configured dedup capacity")
	}
	jobIDs := map[string]struct{}{}
	activeIdentities := map[string]string{}
	assignmentIDs := map[string]struct{}{}
	recordActive := func(job contract.DistributedJob) error {
		if _, exists := jobIDs[job.JobID]; exists {
			return errors.New("scheduler job is duplicated")
		}
		if _, exists := activeIdentities[job.IdempotencyKey]; exists {
			return errors.New("scheduler job is duplicated")
		}
		jobIDs[job.JobID] = struct{}{}
		activeIdentities[job.IdempotencyKey] = job.JobID
		return nil
	}
	for _, item := range state.Queued {
		if item.Attempt < 1 || item.Attempt > s.maxAttempts {
			return errors.New("scheduler queued attempt is invalid")
		}
		if err := item.Job.Validate(); err != nil {
			return err
		}
		if err := recordActive(item.Job); err != nil {
			return err
		}
	}
	validateAssignment := func(assignment contract.JobAssignment, job contract.DistributedJob) error {
		if err := assignment.Validate(); err != nil {
			return err
		}
		if err := job.Validate(); err != nil {
			return err
		}
		if assignment.JobID != job.JobID {
			return errors.New("scheduler assignment job identity is inconsistent")
		}
		if _, exists := assignmentIDs[assignment.AssignmentID]; exists {
			return errors.New("scheduler assignment is duplicated")
		}
		assignmentIDs[assignment.AssignmentID] = struct{}{}
		return recordActive(job)
	}
	for _, item := range state.Inflight {
		if err := validateAssignment(item.Assignment, item.Job); err != nil {
			return err
		}
	}
	for _, item := range state.Interrupted {
		if item.Reason != "scheduler_restart" {
			return errors.New("scheduler interrupted reason is invalid")
		}
		if err := validateAssignment(item.Assignment, item.Job); err != nil {
			return err
		}
	}
	seen := map[string]struct{}{}
	seenJobIDs := map[string]struct{}{}
	for _, item := range state.Seen {
		if item.IdempotencyKey == "" || item.JobID == "" {
			return errors.New("scheduler dedup identity is invalid")
		}
		if _, exists := seen[item.IdempotencyKey]; exists {
			return errors.New("scheduler dedup identity is duplicated")
		}
		if _, exists := seenJobIDs[item.JobID]; exists {
			return errors.New("scheduler dedup identity is duplicated")
		}
		seen[item.IdempotencyKey] = struct{}{}
		seenJobIDs[item.JobID] = struct{}{}
	}
	for key, jobID := range activeIdentities {
		matched := false
		for _, item := range state.Seen {
			if item.IdempotencyKey == key && item.JobID == jobID {
				matched = true
				break
			}
		}
		if !matched {
			return errors.New("scheduler active job is missing its dedup identity")
		}
	}
	return nil
}
