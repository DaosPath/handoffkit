package worker

import (
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/DaosPath/handoffkit/go/contract"
)

var assignmentSequence atomic.Uint64

type Snapshot struct {
	Queued    int `json:"queued"`
	Assigned  int `json:"assigned"`
	Completed int `json:"completed"`
	Failed    int `json:"failed"`
	SeenJobs  int `json:"seen_jobs"`
}

type assignmentState struct {
	assignment contract.JobAssignment
	job        contract.DistributedJob
}

type Scheduler struct {
	mu            sync.Mutex
	registry      *Registry
	maxAttempts   uint32
	lease         time.Duration
	queueCapacity int
	dedupCapacity int
	queue         []contract.DistributedJob
	assignments   map[string]assignmentState
	attempts      map[string]uint32
	seen          map[string]string
	seenOrder     []string
	completed     int
	failed        int
}

func NewScheduler(registry *Registry, maxAttempts uint32, lease time.Duration, queueCapacity, dedupCapacity int) (*Scheduler, error) {
	if registry == nil || maxAttempts < 1 || lease <= 0 || queueCapacity < 1 || dedupCapacity < 1 {
		return nil, errors.New("scheduler configuration is invalid")
	
	
	}
	return &Scheduler{
		registry: registry, maxAttempts: maxAttempts, lease: lease,
		queueCapacity: queueCapacity, dedupCapacity: dedupCapacity,
		assignments: map[string]assignmentState{}, attempts: map[string]uint32{}, seen: map[string]string{},
	}, nil
}

func (s *Scheduler) Submit(job contract.DistributedJob) (bool, error) {
	if err := job.Validate(); err != nil {
		return false, err
	
	
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.seen[job.IdempotencyKey]; exists {
		return false, nil
	
	
	}
	if len(s.queue) >= s.queueCapacity {
		return false, errors.New("distributed scheduler queue is at capacity")
	
	
	}
	s.seen[job.IdempotencyKey] = job.JobID
	s.seenOrder = append(s.seenOrder, job.IdempotencyKey)
	for len(s.seenOrder) > s.dedupCapacity {
		delete(s.seen, s.seenOrder[0])
		s.seenOrder = s.seenOrder[1:]
	}
	s.queue = append(s.queue, job)
	return true, nil
}

func (s *Scheduler) Schedule() (*contract.JobAssignment, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	queued := len(s.queue)
	for index := 0; index < queued; index++ {
		job := s.queue[0]
		s.queue = s.queue[1:]
		worker, ok := s.registry.Reserve(job.RequestedCapabilities)
		if !ok {
			s.queue = append(s.queue, job)
			continue
		}
		attempt := s.attempts[job.JobID] + 1
		s.attempts[job.JobID] = attempt
		now := time.Now().UTC()
		assignment := contract.JobAssignment{
			AssignmentID: fmt.Sprintf("assignment-%d", assignmentSequence.Add(1)),
			JobID: job.JobID, WorkerID: worker.Capabilities.WorkerID, Attempt: attempt,
			AssignedAt: now.Format(time.RFC3339Nano), LeaseDeadline: now.Add(s.lease).Format(time.RFC3339Nano),
			Payload: job.Payload, Metadata: cloneMap(job.Metadata),
		}
		assignment.Metadata["operation"] = job.Operation
		assignment.Metadata["idempotency_key"] = job.IdempotencyKey
		s.assignments[assignment.AssignmentID] = assignmentState{assignment: assignment, job: job}
		return &assignment, nil
	}
	return nil, nil
}

func (s *Scheduler) Complete(assignmentID string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	state, exists := s.assignments[assignmentID]
	if !exists {
		return false
	
	
	}
	delete(s.assignments, assignmentID)
	_ = s.registry.Release(state.assignment.WorkerID)
	s.completed++
	return true
}

func (s *Scheduler) Fail(assignmentID string, retryable bool) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.failLocked(assignmentID, retryable)
}

func (s *Scheduler) failLocked(assignmentID string, retryable bool) bool {
	state, exists := s.assignments[assignmentID]
	if !exists {
		return false
	
	
	}
	delete(s.assignments, assignmentID)
	_ = s.registry.Release(state.assignment.WorkerID)
	if retryable && state.assignment.Attempt < s.maxAttempts && len(s.queue) < s.queueCapacity {
		s.queue = append([]contract.DistributedJob{state.job}, s.queue...)
	} else {
		s.failed++
	}
	return true
}

func (s *Scheduler) RecoverWorker(workerID string) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	identifiers := []string{}
	for assignmentID, state := range s.assignments {
		if state.assignment.WorkerID == workerID {
			identifiers = append(identifiers, assignmentID)
		}
	}
	for _, assignmentID := range identifiers {
		s.failLocked(assignmentID, true)
	}
	return len(identifiers)
}

func (s *Scheduler) RecoverExpired(now time.Time) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	identifiers := []string{}
	for assignmentID, state := range s.assignments {
		deadline, err := time.Parse(time.RFC3339Nano, state.assignment.LeaseDeadline)
		if err == nil && !deadline.After(now) {
			identifiers = append(identifiers, assignmentID)
		}
	}
	for _, assignmentID := range identifiers {
		s.failLocked(assignmentID, true)
	}
	return len(identifiers)
}

func (s *Scheduler) Snapshot() Snapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	return Snapshot{Queued: len(s.queue), Assigned: len(s.assignments), Completed: s.completed, Failed: s.failed, SeenJobs: len(s.seen)}
}
