package studioevents

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strings"
	"time"
)

const (
	Format        = "handoffkit.studio.security-event"
	FormatVersion = 1
	MaxLineBytes  = 64 * 1024
)

const (
	EventSessionObserved    = "session.observed"
	EventSessionReconnected = "session.reconnected"
	EventSecurityRejected   = "security.rejected"
	EventJobUpdated         = "job.updated"
	EventArtifactVerified   = "artifact.verified"
	EventRuntimeStatus      = "runtime.status"
)

var (
	idPattern          = regexp.MustCompile(`^[A-Za-z0-9._:@-]{1,128}$`)
	fingerprintPattern = regexp.MustCompile(`^sha256:[0-9a-f]{12}\.\.\.[0-9a-f]{8}$`)
	identityPattern    = regexp.MustCompile(`^(?:[A-Za-z0-9._:@-]{1,128}|spiffe://[A-Za-z0-9._:@/-]{1,240})$`)
	secretPattern      = regexp.MustCompile(`(?i)-----BEGIN|Bearer\s|\b(?:sk-|pypi-|gsk_)[A-Za-z0-9_-]+|[A-Za-z]:\\|/(?:home|Users|tmp|var)/`)
)

type Event struct {
	Format        string          `json:"format"`
	FormatVersion int             `json:"format_version"`
	EventID       string          `json:"event_id"`
	EventType     string          `json:"event_type"`
	ObservedAt    string          `json:"observed_at"`
	Runtime       string          `json:"runtime"`
	EdgeProfile   string          `json:"edge_profile"`
	Payload       json.RawMessage `json:"payload"`
}

type Queue struct {
	Pending  int `json:"pending"`
	Capacity int `json:"capacity"`
}

type Rotation struct {
	Status              string  `json:"status"`
	CurrentFingerprint  *string `json:"current_fingerprint"`
	PreviousFingerprint *string `json:"previous_fingerprint"`
	PreviousAccepted    bool    `json:"previous_accepted"`
	TransitionUntil     *string `json:"transition_until"`
}

type Session struct {
	SessionID             string   `json:"session_id"`
	PeerID                string   `json:"peer_id"`
	NodeID                string   `json:"node_id"`
	WorkerID              *string  `json:"worker_id"`
	IdentitySource        string   `json:"identity_source"`
	TrustDomain           string   `json:"trust_domain"`
	CredentialFingerprint string   `json:"credential_fingerprint"`
	CertificateExpiresAt  string   `json:"certificate_expires_at"`
	CertificateState      string   `json:"certificate_state"`
	SecurityProfile       string   `json:"security_profile"`
	TLSVersion            string   `json:"tls_version"`
	NegotiatedGroup       *string  `json:"negotiated_group"`
	HybridPQProviderState string   `json:"hybrid_pq_provider_state"`
	RevocationState       string   `json:"revocation_state"`
	Rotation              Rotation `json:"rotation"`
	Queue                 Queue    `json:"queue"`
	Reconnects            int      `json:"reconnects"`
}

type Rejection struct {
	SessionID *string `json:"session_id"`
	Category  string  `json:"category"`
	Code      string  `json:"code"`
	Message   string  `json:"message"`
}

type Job struct {
	JobID     string  `json:"job_id"`
	Operation string  `json:"operation"`
	Status    string  `json:"status"`
	Progress  float64 `json:"progress"`
	WorkerID  *string `json:"worker_id"`
	ErrorCode *string `json:"error_code"`
}

type Artifact struct {
	ArtifactID        string  `json:"artifact_id"`
	JobID             string  `json:"job_id"`
	MediaType         string  `json:"media_type"`
	Verification      string  `json:"verification"`
	ProducerIdentity  *string `json:"producer_identity"`
	IdentitySource    string  `json:"identity_source"`
	SignerFingerprint *string `json:"signer_fingerprint"`
	ErrorCode         *string `json:"error_code"`
}

type RuntimeStatus struct {
	Connections             int    `json:"connections"`
	ConnectionLimit         int    `json:"connection_limit"`
	Queue                   Queue  `json:"queue"`
	ReplayRejections        int    `json:"replay_rejections"`
	AuthorizationRejections int    `json:"authorization_rejections"`
	Reconnects              int    `json:"reconnects"`
	HybridPQProviderState   string `json:"hybrid_pq_provider_state"`
}

func New(runtime, edgeProfile, eventType string, payload any) (Event, error) {
	encoded, err := json.Marshal(payload)
	if err != nil {
		return Event{}, err
	}
	identifier := make([]byte, 16)
	if _, err := rand.Read(identifier); err != nil {
		return Event{}, err
	}
	event := Event{
		Format:        Format,
		FormatVersion: FormatVersion,
		EventID:       "event-" + hex.EncodeToString(identifier),
		EventType:     eventType,
		ObservedAt:    time.Now().UTC().Format(time.RFC3339Nano),
		Runtime:       runtime,
		EdgeProfile:   edgeProfile,
		Payload:       encoded,
	}
	if err := event.Validate(); err != nil {
		return Event{}, err
	}
	return event, nil
}

func ParseNDJSON(data []byte) ([]Event, error) {
	lines := bytes.Split(data, []byte{'\n'})
	events := make([]Event, 0, len(lines))
	seen := map[string]bool{}
	var previous time.Time
	for _, line := range lines {
		line = bytes.TrimSpace(line)
		if len(line) == 0 {
			continue
		}
		if len(line) > MaxLineBytes {
			return nil, errors.New("studio event line exceeds its limit")
		}
		decoder := json.NewDecoder(bytes.NewReader(line))
		decoder.DisallowUnknownFields()
		var event Event
		if err := decoder.Decode(&event); err != nil {
			return nil, fmt.Errorf("studio event JSON is invalid: %w", err)
		}
		if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
			return nil, errors.New("studio event JSON has trailing data")
		}
		if err := event.Validate(); err != nil {
			return nil, err
		}
		if seen[event.EventID] {
			return nil, errors.New("studio event id is duplicated")
		}
		observed, _ := time.Parse(time.RFC3339Nano, event.ObservedAt)
		if !previous.IsZero() && observed.Before(previous) {
			return nil, errors.New("studio event timestamps are not monotonic")
		}
		seen[event.EventID] = true
		previous = observed
		events = append(events, event)
	}
	return events, nil
}

func (event Event) Validate() error {
	if event.Format != Format || event.FormatVersion != FormatVersion {
		return errors.New("studio event format is unavailable")
	}
	if !idPattern.MatchString(event.EventID) {
		return errors.New("studio event id is invalid")
	}
	if _, err := time.Parse(time.RFC3339Nano, event.ObservedAt); err != nil {
		return errors.New("studio event timestamp is invalid")
	}
	if !contains([]string{"python", "node", "go", "rust", "cpp"}, event.Runtime) ||
		!contains([]string{"edge-small", "edge-standard", "server"}, event.EdgeProfile) {
		return errors.New("studio event runtime or edge profile is invalid")
	}
	switch event.EventType {
	case EventSessionObserved, EventSessionReconnected:
		var payload Session
		if err := decodePayload(event.Payload, &payload); err != nil {
			return err
		}
		return payload.validate()
	case EventSecurityRejected:
		var payload Rejection
		if err := decodePayload(event.Payload, &payload); err != nil {
			return err
		}
		return payload.validate()
	case EventJobUpdated:
		var payload Job
		if err := decodePayload(event.Payload, &payload); err != nil {
			return err
		}
		return payload.validate()
	case EventArtifactVerified:
		var payload Artifact
		if err := decodePayload(event.Payload, &payload); err != nil {
			return err
		}
		return payload.validate()
	case EventRuntimeStatus:
		var payload RuntimeStatus
		if err := decodePayload(event.Payload, &payload); err != nil {
			return err
		}
		return payload.validate()
	default:
		return errors.New("studio event type is invalid")
	}
}

func TruncateFingerprint(value string) (string, error) {
	normalized := strings.ToLower(strings.ReplaceAll(strings.TrimSpace(value), ":", ""))
	normalized = strings.TrimPrefix(normalized, "sha256")
	if len(normalized) != 64 {
		return "", errors.New("fingerprint must contain a SHA-256 digest")
	}
	if _, err := hex.DecodeString(normalized); err != nil {
		return "", errors.New("fingerprint must contain a SHA-256 digest")
	}
	return "sha256:" + normalized[:12] + "..." + normalized[len(normalized)-8:], nil
}

func decodePayload(data []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return fmt.Errorf("studio event payload is invalid: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return errors.New("studio event payload has trailing data")
	}
	return nil
}

func (value Queue) validate() error {
	if value.Pending < 0 || value.Capacity < 1 || value.Pending > value.Capacity {
		return errors.New("studio event queue is invalid")
	}
	return nil
}

func (value Rotation) validate() error {
	if !contains([]string{"not-configured", "current", "transition"}, value.Status) {
		return errors.New("studio event rotation state is invalid")
	}
	for _, fingerprint := range []*string{value.CurrentFingerprint, value.PreviousFingerprint} {
		if fingerprint != nil && !fingerprintPattern.MatchString(*fingerprint) {
			return errors.New("studio event rotation fingerprint is not truncated")
		}
	}
	if value.TransitionUntil != nil {
		if _, err := time.Parse(time.RFC3339Nano, *value.TransitionUntil); err != nil {
			return errors.New("studio event rotation timestamp is invalid")
		}
	}
	return nil
}

func (value Session) validate() error {
	for _, identifier := range []string{value.SessionID, value.PeerID, value.NodeID, value.TrustDomain} {
		if !idPattern.MatchString(identifier) {
			return errors.New("studio session identity is invalid")
		}
	}
	if value.WorkerID != nil && !idPattern.MatchString(*value.WorkerID) {
		return errors.New("studio session worker id is invalid")
	}
	if value.IdentitySource != "certificate-san" || !fingerprintPattern.MatchString(value.CredentialFingerprint) || value.TLSVersion != "TLSv1.3" {
		return errors.New("studio session lacks authenticated certificate evidence")
	}
	if value.NegotiatedGroup != nil && (len(*value.NegotiatedGroup) < 1 || len(*value.NegotiatedGroup) > 64) {
		return errors.New("studio session negotiated group is invalid")
	}
	if _, err := time.Parse(time.RFC3339Nano, value.CertificateExpiresAt); err != nil {
		return errors.New("studio session certificate expiry is invalid")
	}
	if !contains([]string{"valid", "expired"}, value.CertificateState) ||
		!contains([]string{"standard", "hybrid-pq"}, value.SecurityProfile) ||
		!contains([]string{"unavailable", "available-not-selected", "negotiated"}, value.HybridPQProviderState) ||
		!contains([]string{"not-configured", "not-revoked", "revoked"}, value.RevocationState) || value.Reconnects < 0 {
		return errors.New("studio session security state is invalid")
	}
	if err := value.Queue.validate(); err != nil {
		return err
	}
	return value.Rotation.validate()
}

func (value Rejection) validate() error {
	if value.SessionID != nil && !idPattern.MatchString(*value.SessionID) {
		return errors.New("studio rejection session id is invalid")
	}
	if !contains([]string{"authentication", "authorization", "replay", "revocation", "transcript", "artifact", "worker"}, value.Category) ||
		!idPattern.MatchString(value.Code) || len(value.Message) < 1 || len(value.Message) > 240 || secretPattern.MatchString(value.Message) {
		return errors.New("studio rejection is invalid or contains sensitive data")
	}
	return nil
}

func (value Job) validate() error {
	if !idPattern.MatchString(value.JobID) || !contains([]string{"training", "evaluation"}, value.Operation) ||
		!contains([]string{"queued", "running", "completed", "failed", "cancelled", "interrupted"}, value.Status) ||
		value.Progress < 0 || value.Progress > 1 {
		return errors.New("studio job event is invalid")
	}
	for _, identifier := range []*string{value.WorkerID, value.ErrorCode} {
		if identifier != nil && !idPattern.MatchString(*identifier) {
			return errors.New("studio job identifier is invalid")
		}
	}
	return nil
}

func (value Artifact) validate() error {
	if !idPattern.MatchString(value.ArtifactID) || !idPattern.MatchString(value.JobID) ||
		len(value.MediaType) < 1 || len(value.MediaType) > 128 ||
		!contains([]string{"verified", "rejected"}, value.Verification) ||
		!contains([]string{"verified-signer", "unverified"}, value.IdentitySource) {
		return errors.New("studio artifact event is invalid")
	}
	if value.ProducerIdentity != nil && !identityPattern.MatchString(*value.ProducerIdentity) {
		return errors.New("studio artifact producer is invalid")
	}
	if value.SignerFingerprint != nil && !fingerprintPattern.MatchString(*value.SignerFingerprint) {
		return errors.New("studio artifact signer fingerprint is not truncated")
	}
	if value.ErrorCode != nil && !idPattern.MatchString(*value.ErrorCode) {
		return errors.New("studio artifact error code is invalid")
	}
	if value.Verification == "verified" && (value.IdentitySource != "verified-signer" || value.ProducerIdentity == nil || value.SignerFingerprint == nil) {
		return errors.New("verified studio artifact lacks signer evidence")
	}
	if value.Verification == "rejected" && value.IdentitySource != "unverified" {
		return errors.New("rejected studio artifact cannot claim signer identity")
	}
	return nil
}

func (value RuntimeStatus) validate() error {
	if value.Connections < 0 || value.ConnectionLimit < 1 || value.Connections > value.ConnectionLimit ||
		value.ReplayRejections < 0 || value.AuthorizationRejections < 0 || value.Reconnects < 0 ||
		!contains([]string{"unavailable", "available-not-selected", "negotiated"}, value.HybridPQProviderState) {
		return errors.New("studio runtime status is invalid")
	}
	return value.Queue.validate()
}

func contains(values []string, value string) bool {
	for _, candidate := range values {
		if candidate == value {
			return true
		}
	}
	return false
}
