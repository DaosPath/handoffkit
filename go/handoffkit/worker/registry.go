package worker

import (
	"errors"
	"sort"
	"sync"
	"time"

	"github.com/DaosPath/handoffkit/go/contract"
)

type Status string

const (
	Online  Status = "online"
	Suspect Status = "suspect"
	Offline Status = "offline"
)

type Record struct {
	Capabilities      contract.WorkerCapabilities `json:"capabilities"`
	Status            Status                      `json:"status"`
	HeartbeatSequence uint64                      `json:"heartbeat_sequence"`
	ActiveJobs        uint32                      `json:"active_jobs"`
	Load              float64                     `json:"load"`
	LastSeen          time.Time                   `json:"last_seen"`
	Metadata          map[string]any              `json:"metadata"`
}

type Registry struct {
	mu           sync.Mutex
	records      map[string]Record
	suspectAfter time.Duration
	offlineAfter time.Duration
	now          func() time.Time
}

func NewRegistry(suspectAfter, offlineAfter time.Duration) (*Registry, error) {
	if suspectAfter <= 0 || offlineAfter < suspectAfter {
		return nil, errors.New("heartbeat thresholds are invalid")
	}
	return &Registry{records: map[string]Record{}, suspectAfter: suspectAfter, offlineAfter: offlineAfter, now: time.Now}, nil
}

func (r *Registry) Register(capabilities contract.WorkerCapabilities) (Record, error) {
	if err := capabilities.Validate(); err != nil {
		return Record{}, err
	}
	record := Record{Capabilities: capabilities, Status: Online, LastSeen: r.now(), Metadata: map[string]any{}}
	r.mu.Lock()
	r.records[capabilities.WorkerID] = record
	r.mu.Unlock()
	return record, nil
}

func (r *Registry) Heartbeat(heartbeat contract.WorkerHeartbeat) (bool, error) {
	if err := heartbeat.Validate(); err != nil {
		return false, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	record, ok := r.records[heartbeat.WorkerID]
	if !ok {
		return false, errors.New("unknown worker")
	}
	if heartbeat.Sequence <= record.HeartbeatSequence {
		return false, nil
	}
	record.Status = Online
	record.HeartbeatSequence = heartbeat.Sequence
	record.ActiveJobs = heartbeat.ActiveJobs
	record.Load = heartbeat.Load
	record.LastSeen = r.now()
	record.Metadata = cloneMap(heartbeat.Metadata)
	r.records[heartbeat.WorkerID] = record
	return true, nil
}

func (r *Registry) MarkDisconnected(workerID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	record, ok := r.records[workerID]
	if !ok {
		return errors.New("unknown worker")
	}
	record.Status = Offline
	r.records[workerID] = record
	return nil
}

func (r *Registry) Expire() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := r.now()
	changed := []string{}
	for workerID, record := range r.records {
		age := now.Sub(record.LastSeen)
		status := Online
		if age >= r.offlineAfter {
			status = Offline
		} else if age >= r.suspectAfter {
			status = Suspect
		}
		if status != record.Status {
			record.Status = status
			r.records[workerID] = record
			changed = append(changed, workerID)
		}
	}
	sort.Strings(changed)
	return changed
}

func (r *Registry) Reserve(required []string) (Record, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	candidates := []Record{}
	for _, record := range r.records {
		if record.Status == Online && supports(record.Capabilities.Operations, required) {
			candidates = append(candidates, record)
		}
	}
	if len(candidates) == 0 {
		return Record{}, false
	}
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].Load != candidates[j].Load {
			return candidates[i].Load < candidates[j].Load
		}
		if candidates[i].ActiveJobs != candidates[j].ActiveJobs {
			return candidates[i].ActiveJobs < candidates[j].ActiveJobs
		}
		return candidates[i].Capabilities.WorkerID < candidates[j].Capabilities.WorkerID
	})
	chosen := candidates[0]
	chosen.ActiveJobs++
	r.records[chosen.Capabilities.WorkerID] = chosen
	return chosen, true
}

func (r *Registry) Release(workerID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	record, ok := r.records[workerID]
	if !ok {
		return errors.New("unknown worker")
	}
	if record.ActiveJobs > 0 {
		record.ActiveJobs--
	}
	r.records[workerID] = record
	return nil
}

func (r *Registry) Get(workerID string) (Record, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	record, ok := r.records[workerID]
	return record, ok
}

func (r *Registry) List() []Record {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := make([]Record, 0, len(r.records))
	for _, record := range r.records {
		result = append(result, record)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Capabilities.WorkerID < result[j].Capabilities.WorkerID })
	return result
}

func supports(available, required []string) bool {
	set := map[string]struct{}{}
	for _, item := range available {
		set[item] = struct{}{}
	}
	for _, item := range required {
		if _, ok := set[item]; !ok {
			return false
		}
	}
	return true
}

func cloneMap(value map[string]any) map[string]any {
	result := map[string]any{}
	for key, item := range value {
		result[key] = item
	}
	return result
}
