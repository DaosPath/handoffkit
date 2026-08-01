package contract

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	ProtocolVersion        = "1.0"
	DefaultChannelCapacity = 64
	DefaultMaxMessageBytes = 8 * 1024 * 1024
	DefaultMaxDepth        = 64
	MinMessageBytes        = 1024
	MaxRetryAttempts       = 100
	MaxErrorMessageBytes   = 2048
)

type RuntimeMode string

const (
	RuntimeClassic     RuntimeMode = "classic"
	RuntimeSession     RuntimeMode = "session"
	RuntimeDistributed RuntimeMode = "distributed"
)

type OverflowPolicy string

const (
	OverflowBlock  OverflowPolicy = "block"
	OverflowReject OverflowPolicy = "reject"
)

type RetryPolicy struct {
	MaxAttempts int `json:"max_attempts"`
	BaseDelayMS int `json:"base_delay_ms"`
	MaxDelayMS  int `json:"max_delay_ms"`
}

func DefaultRetryPolicy() RetryPolicy {
	return RetryPolicy{MaxAttempts: 3, BaseDelayMS: 100, MaxDelayMS: 2000}
}

func (p RetryPolicy) Validate() error {
	if p.MaxAttempts < 1 {
		return errors.New("max_attempts must be at least 1")
	}
	if p.MaxAttempts > MaxRetryAttempts {
		return fmt.Errorf("max_attempts must not exceed %d", MaxRetryAttempts)
	}
	if p.BaseDelayMS < 0 || p.MaxDelayMS < 0 || p.BaseDelayMS > p.MaxDelayMS {
		return errors.New("retry delays are invalid")
	}
	return nil
}

type SessionConfig struct {
	SessionID       string         `json:"session_id"`
	RuntimeMode     RuntimeMode    `json:"runtime_mode"`
	ChannelCapacity int            `json:"channel_capacity"`
	MaxMessageBytes int            `json:"max_message_bytes"`
	AckTimeoutMS    int            `json:"ack_timeout_ms"`
	DedupCapacity   int            `json:"dedup_capacity"`
	RetryPolicy     RetryPolicy    `json:"retry_policy"`
	Deadline        *string        `json:"deadline"`
	Metadata        map[string]any `json:"metadata"`
}

func NewSessionConfig(sessionID string) SessionConfig {
	return SessionConfig{
		SessionID:       sessionID,
		RuntimeMode:     RuntimeSession,
		ChannelCapacity: DefaultChannelCapacity,
		MaxMessageBytes: DefaultMaxMessageBytes,
		AckTimeoutMS:    30000,
		DedupCapacity:   4096,
		RetryPolicy:     DefaultRetryPolicy(),
		Metadata:        map[string]any{},
	}
}

func (c SessionConfig) Validate() error {
	if err := nonempty("session_id", c.SessionID); err != nil {
		return err
	}
	if c.RuntimeMode != RuntimeClassic && c.RuntimeMode != RuntimeSession && c.RuntimeMode != RuntimeDistributed {
		return errors.New("runtime_mode is invalid")
	}
	if c.ChannelCapacity < 1 {
		return errors.New("channel_capacity must be at least 1")
	}
	if c.MaxMessageBytes < MinMessageBytes {
		return fmt.Errorf("max_message_bytes must be at least %d", MinMessageBytes)
	}
	if c.MaxMessageBytes > DefaultMaxMessageBytes {
		return fmt.Errorf("max_message_bytes must not exceed %d", DefaultMaxMessageBytes)
	}
	if c.AckTimeoutMS < 1 || c.DedupCapacity < 1 {
		return errors.New("ack_timeout_ms and dedup_capacity must be at least 1")
	}
	if err := c.RetryPolicy.Validate(); err != nil {
		return err
	}
	if c.Deadline != nil {
		return ValidateTimestamp("deadline", *c.Deadline)
	}
	return nil
}

type ChannelConfig struct {
	Name           string         `json:"name"`
	Capacity       int            `json:"capacity"`
	OverflowPolicy OverflowPolicy `json:"overflow_policy"`
	RequiresAck    bool           `json:"requires_ack"`
	Metadata       map[string]any `json:"metadata"`
}

func (c ChannelConfig) Validate() error {
	if err := nonempty("name", c.Name); err != nil {
		return err
	}
	if c.Capacity < 1 {
		return errors.New("capacity must be at least 1")
	}
	if c.OverflowPolicy != OverflowBlock && c.OverflowPolicy != OverflowReject {
		return errors.New("overflow_policy is invalid")
	}
	return nil
}

type MessageEnvelope struct {
	ProtocolVersion string         `json:"protocol_version"`
	MessageID       string         `json:"message_id"`
	SessionID       string         `json:"session_id"`
	Channel         string         `json:"channel"`
	Kind            string         `json:"kind"`
	Source          string         `json:"source"`
	Target          *string        `json:"target"`
	Sequence        uint64         `json:"sequence"`
	CreatedAt       string         `json:"created_at"`
	Deadline        *string        `json:"deadline"`
	CorrelationID   *string        `json:"correlation_id"`
	CausationID     *string        `json:"causation_id"`
	IdempotencyKey  *string        `json:"idempotency_key"`
	Attempt         uint32         `json:"attempt"`
	RequiresAck     bool           `json:"requires_ack"`
	PayloadType     string         `json:"payload_type"`
	Payload         any            `json:"payload"`
	Metadata        map[string]any `json:"metadata"`
}

func (e MessageEnvelope) Validate() error {
	if e.ProtocolVersion != ProtocolVersion {
		return fmt.Errorf("unsupported protocol version %q", e.ProtocolVersion)
	}
	for name, value := range map[string]string{
		"message_id": e.MessageID, "session_id": e.SessionID, "channel": e.Channel,
		"kind": e.Kind, "source": e.Source, "payload_type": e.PayloadType,
	} {
		if err := nonempty(name, value); err != nil {
			return err
		}
	}
	if e.Attempt < 1 {
		return errors.New("attempt must be at least 1")
	}
	if err := ValidateTimestamp("created_at", e.CreatedAt); err != nil {
		return err
	}
	if e.Deadline != nil {
		if err := ValidateTimestamp("deadline", *e.Deadline); err != nil {
			return err
		}
	}
	for name, value := range map[string]*string{
		"target": e.Target, "correlation_id": e.CorrelationID,
		"causation_id": e.CausationID, "idempotency_key": e.IdempotencyKey,
	} {
		if value != nil && strings.TrimSpace(*value) == "" {
			return fmt.Errorf("%s must not be empty when set", name)
		}
	}
	if JSONDepth(e.Payload) > DefaultMaxDepth || JSONDepth(e.Metadata) > DefaultMaxDepth {
		return errors.New("JSON nesting depth must not exceed 64")
	}
	encoded, err := json.Marshal(e)
	if err != nil {
		return fmt.Errorf("encode message: %w", err)
	}
	if len(encoded) > DefaultMaxMessageBytes {
		return fmt.Errorf("message exceeds %d bytes", DefaultMaxMessageBytes)
	}
	return nil
}

func (e MessageEnvelope) NextAttempt() MessageEnvelope {
	e.Attempt++
	return e
}

func (e MessageEnvelope) Encode() ([]byte, error) {
	if err := e.Validate(); err != nil {
		return nil, err
	}
	return json.Marshal(e)
}

func DecodeEnvelope(data []byte) (MessageEnvelope, error) {
	if len(data) > DefaultMaxMessageBytes {
		return MessageEnvelope{}, fmt.Errorf("message exceeds %d bytes", DefaultMaxMessageBytes)
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	var envelope MessageEnvelope
	if err := decoder.Decode(&envelope); err != nil {
		return MessageEnvelope{}, fmt.Errorf("invalid envelope JSON: %w", err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			return MessageEnvelope{}, errors.New("invalid envelope JSON: trailing value")
		}
		return MessageEnvelope{}, fmt.Errorf("invalid envelope JSON: %w", err)
	}
	if err := envelope.Validate(); err != nil {
		return MessageEnvelope{}, err
	}
	return envelope, nil
}

type DeliveryAck struct {
	MessageID   string         `json:"message_id"`
	ProcessedAt string         `json:"processed_at"`
	Metadata    map[string]any `json:"metadata"`
}

func (a DeliveryAck) Validate() error {
	if err := nonempty("message_id", a.MessageID); err != nil {
		return err
	}
	return ValidateTimestamp("processed_at", a.ProcessedAt)
}

type DeliveryNack struct {
	MessageID   string         `json:"message_id"`
	Code        string         `json:"code"`
	Message     string         `json:"message"`
	Retryable   bool           `json:"retryable"`
	ProcessedAt string         `json:"processed_at"`
	Metadata    map[string]any `json:"metadata"`
}

func (n DeliveryNack) Validate() error {
	if err := nonempty("message_id", n.MessageID); err != nil {
		return err
	}
	if err := nonempty("code", n.Code); err != nil {
		return err
	}
	return ValidateTimestamp("processed_at", n.ProcessedAt)
}

type ProcessError struct {
	Code      string         `json:"code"`
	Message   string         `json:"message"`
	ProcessID string         `json:"process_id"`
	Retryable bool           `json:"retryable"`
	Details   map[string]any `json:"details"`
	Timestamp string         `json:"timestamp"`
}

func (e ProcessError) Validate() error {
	if err := nonempty("code", e.Code); err != nil {
		return err
	}
	if err := nonempty("process_id", e.ProcessID); err != nil {
		return err
	}
	return ValidateTimestamp("timestamp", e.Timestamp)
}

func (e ProcessError) Sanitized() ProcessError {
	e.Message = SanitizeError(e.Message)
	return e
}

type ArtifactRef struct {
	ArtifactID string         `json:"artifact_id"`
	URI        string         `json:"uri"`
	SHA256     string         `json:"sha256"`
	SizeBytes  uint64         `json:"size_bytes"`
	MediaType  string         `json:"media_type"`
	Metadata   map[string]any `json:"metadata"`
}

type TrainingJob struct {
	JobID                 string         `json:"job_id"`
	Dataset               ArtifactRef    `json:"dataset"`
	Output                string         `json:"output"`
	Config                map[string]any `json:"config"`
	RequestedCapabilities []string       `json:"requested_capabilities"`
	Deadline              *string        `json:"deadline"`
	IdempotencyKey        string         `json:"idempotency_key"`
	Metadata              map[string]any `json:"metadata"`
}

func (j TrainingJob) Validate() error {
	for name, value := range map[string]string{"job_id": j.JobID, "output": j.Output, "idempotency_key": j.IdempotencyKey} {
		if err := nonempty(name, value); err != nil {
			return err
		}
	}
	if err := j.Dataset.Validate(); err != nil {
		return err
	}
	if j.Deadline != nil {
		return ValidateTimestamp("deadline", *j.Deadline)
	}
	return nil
}

type EvaluationJob struct {
	JobID                 string         `json:"job_id"`
	Model                 ArtifactRef    `json:"model"`
	Dataset               ArtifactRef    `json:"dataset"`
	Output                string         `json:"output"`
	Config                map[string]any `json:"config"`
	RequestedCapabilities []string       `json:"requested_capabilities"`
	Deadline              *string        `json:"deadline"`
	IdempotencyKey        string         `json:"idempotency_key"`
	Metadata              map[string]any `json:"metadata"`
}

func (j EvaluationJob) Validate() error {
	for name, value := range map[string]string{"job_id": j.JobID, "output": j.Output, "idempotency_key": j.IdempotencyKey} {
		if err := nonempty(name, value); err != nil {
			return err
		}
	}
	if err := j.Model.Validate(); err != nil {
		return err
	}
	if err := j.Dataset.Validate(); err != nil {
		return err
	}
	if j.Deadline != nil {
		return ValidateTimestamp("deadline", *j.Deadline)
	}
	return nil
}

type JobProgress struct {
	JobID      string         `json:"job_id"`
	Phase      string         `json:"phase"`
	Status     string         `json:"status"`
	Step       uint64         `json:"step"`
	TotalSteps uint64         `json:"total_steps"`
	Progress   float64        `json:"progress"`
	Loss       *float64       `json:"loss"`
	Metrics    map[string]any `json:"metrics"`
	Message    string         `json:"message"`
	Timestamp  string         `json:"timestamp"`
	Artifacts  []ArtifactRef  `json:"artifacts"`
}

func (p JobProgress) Validate() error {
	for name, value := range map[string]string{"job_id": p.JobID, "phase": p.Phase, "status": p.Status} {
		if err := nonempty(name, value); err != nil {
			return err
		}
	}
	if math.IsNaN(p.Progress) || math.IsInf(p.Progress, 0) || p.Progress < 0 || p.Progress > 1 {
		return errors.New("progress must be between 0 and 1")
	}
	if p.Step > p.TotalSteps {
		return errors.New("step must not exceed total_steps")
	}
	if err := ValidateTimestamp("timestamp", p.Timestamp); err != nil {
		return err
	}
	for _, artifact := range p.Artifacts {
		if err := artifact.Validate(); err != nil {
			return err
		}
	}
	return nil
}

func (a ArtifactRef) Validate() error {
	for name, value := range map[string]string{"artifact_id": a.ArtifactID, "uri": a.URI, "media_type": a.MediaType} {
		if err := nonempty(name, value); err != nil {
			return err
		}
	}
	decoded, err := hex.DecodeString(a.SHA256)
	if err != nil || len(decoded) != 32 {
		return errors.New("sha256 must contain exactly 64 hexadecimal characters")
	}
	return nil
}

type WorkerCapabilities struct {
	WorkerID     string         `json:"worker_id"`
	Runtime      string         `json:"runtime"`
	OS           string         `json:"os"`
	Architecture string         `json:"architecture"`
	CPUCores     uint32         `json:"cpu_cores"`
	MemoryBytes  uint64         `json:"memory_bytes"`
	CUDA         bool           `json:"cuda"`
	CUDADevices  []string       `json:"cuda_devices"`
	Profiles     []string       `json:"profiles"`
	Operations   []string       `json:"operations"`
	Metadata     map[string]any `json:"metadata"`
}

func (w WorkerCapabilities) Validate() error {
	for name, value := range map[string]string{"worker_id": w.WorkerID, "runtime": w.Runtime, "os": w.OS, "architecture": w.Architecture} {
		if err := nonempty(name, value); err != nil {
			return err
		}
	}
	if w.CPUCores < 1 {
		return errors.New("cpu_cores must be at least 1")
	}
	return nil
}

type WorkerHeartbeat struct {
	WorkerID   string         `json:"worker_id"`
	Sequence   uint64         `json:"sequence"`
	ActiveJobs uint32         `json:"active_jobs"`
	Load       float64        `json:"load"`
	Timestamp  string         `json:"timestamp"`
	Metadata   map[string]any `json:"metadata"`
}

func (h WorkerHeartbeat) Validate() error {
	if err := nonempty("worker_id", h.WorkerID); err != nil {
		return err
	}
	if math.IsNaN(h.Load) || math.IsInf(h.Load, 0) || h.Load < 0 || h.Load > 1 {
		return errors.New("load must be between 0 and 1")
	}
	return ValidateTimestamp("timestamp", h.Timestamp)
}

type DistributedJob struct {
	JobID                 string         `json:"job_id"`
	Operation             string         `json:"operation"`
	Payload               any            `json:"payload"`
	RequestedCapabilities []string       `json:"requested_capabilities"`
	IdempotencyKey        string         `json:"idempotency_key"`
	Deadline              *string        `json:"deadline"`
	Metadata              map[string]any `json:"metadata"`
}

func (j DistributedJob) Validate() error {
	for name, value := range map[string]string{"job_id": j.JobID, "operation": j.Operation, "idempotency_key": j.IdempotencyKey} {
		if err := nonempty(name, value); err != nil {
			return err
		}
	}
	if j.Deadline != nil {
		return ValidateTimestamp("deadline", *j.Deadline)
	}
	return nil
}

type JobAssignment struct {
	AssignmentID  string         `json:"assignment_id"`
	JobID         string         `json:"job_id"`
	WorkerID      string         `json:"worker_id"`
	Attempt       uint32         `json:"attempt"`
	AssignedAt    string         `json:"assigned_at"`
	LeaseDeadline string         `json:"lease_deadline"`
	Payload       any            `json:"payload"`
	Metadata      map[string]any `json:"metadata"`
}

func (a JobAssignment) Validate() error {
	for name, value := range map[string]string{"assignment_id": a.AssignmentID, "job_id": a.JobID, "worker_id": a.WorkerID} {
		if err := nonempty(name, value); err != nil {
			return err
		}
	}
	if a.Attempt < 1 {
		return errors.New("attempt must be at least 1")
	}
	assigned, err := time.Parse(time.RFC3339Nano, a.AssignedAt)
	if err != nil {
		return errors.New("assigned_at must be an RFC 3339 timestamp")
	}
	lease, err := time.Parse(time.RFC3339Nano, a.LeaseDeadline)
	if err != nil {
		return errors.New("lease_deadline must be an RFC 3339 timestamp")
	}
	if lease.Before(assigned) {
		return errors.New("lease_deadline must not be earlier than assigned_at")
	}
	return nil
}

func ValidateTimestamp(name, value string) error {
	if _, err := time.Parse(time.RFC3339Nano, value); err != nil {
		return fmt.Errorf("%s must be an RFC 3339 timestamp", name)
	}
	return nil
}

func UTCNow() string {
	return time.Now().UTC().Format(time.RFC3339Nano)
}

func JSONDepth(value any) int {
	switch typed := value.(type) {
	case map[string]any:
		depth := 1
		for _, item := range typed {
			if candidate := 1 + JSONDepth(item); candidate > depth {
				depth = candidate
			}
		}
		return depth
	case []any:
		depth := 1
		for _, item := range typed {
			if candidate := 1 + JSONDepth(item); candidate > depth {
				depth = candidate
			}
		}
		return depth
	default:
		return 1
	}
}

var secretPattern = regexp.MustCompile(`(?i)(Bearer |sk-|gsk_|pypi-)[^\s,;)\]}]+`)

func SanitizeError(value string) string {
	cleaned := strings.NewReplacer("\r", " ", "\n", " ", "\x00", "").Replace(value)
	cleaned = secretPattern.ReplaceAllStringFunc(cleaned, func(token string) string {
		for _, prefix := range []string{"Bearer ", "sk-", "gsk_", "pypi-"} {
			if strings.HasPrefix(strings.ToLower(token), strings.ToLower(prefix)) {
				return token[:len(prefix)] + "[REDACTED]"
			}
		}
		return "[REDACTED]"
	})
	if len(cleaned) <= MaxErrorMessageBytes {
		return cleaned
	}
	cut := MaxErrorMessageBytes
	for cut > 0 && !utf8.ValidString(cleaned[:cut]) {
		cut--
	}
	return cleaned[:cut]
}

func ValidationErrorCode(err error) string {
	if err == nil {
		return ""
	}
	message := strings.ToLower(err.Error())
	for _, mapping := range []struct{ needle, code string }{
		{"protocol version", "unsupported_version"}, {"rfc 3339", "invalid_timestamp"},
		{"deadline must not", "invalid_deadline"}, {"must not be empty", "empty_field"},
		{"at least", "below_minimum"}, {"must not exceed", "above_maximum"},
		{"nesting depth", "nesting_too_deep"}, {"message exceeds", "message_too_large"},
		{"invalid_profile", "invalid_profile"},
		{"sha256", "invalid_sha256"}, {"between 0 and 1", "invalid_progress"},
	} {
		if strings.Contains(message, mapping.needle) {
			return mapping.code
		}
	}
	return "invalid_contract"
}

func nonempty(name, value string) error {
	if strings.TrimSpace(value) == "" {
		return fmt.Errorf("%s must not be empty", name)
	}
	return nil
}
