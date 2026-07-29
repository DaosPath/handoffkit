package contract

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"testing/quick"
)

type corpusFile struct {
	Cases []struct {
		ID        string          `json:"id"`
		Kind      string          `json:"kind"`
		Valid     bool            `json:"valid"`
		ErrorCode string          `json:"error_code"`
		Value     json.RawMessage `json:"value"`
	} `json:"cases"`
}

func TestSharedDifferentialCorpus(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("..", "..", "contracts", "corpus", "csp-validation.json"))
	if err != nil {
		t.Fatal(err)
	}
	var corpus corpusFile
	if err := json.Unmarshal(data, &corpus); err != nil {
		t.Fatal(err)
	}
	for _, item := range corpus.Cases {
		t.Run(item.ID, func(t *testing.T) {
			canonical, validationErr := validateCorpus(item.Kind, item.Value)
			if item.Valid {
				if validationErr != nil {
					t.Fatalf("valid case rejected: %v", validationErr)
				}
				var expected any
				if err := json.Unmarshal(item.Value, &expected); err != nil {
					t.Fatal(err)
				}
				if !reflect.DeepEqual(canonical, expected) {
					t.Fatalf("canonical mismatch\nwant: %#v\ngot:  %#v", expected, canonical)
				}
				return
			}
			if validationErr == nil {
				t.Fatal("invalid case accepted")
			}
			if code := ValidationErrorCode(validationErr); code != item.ErrorCode {
				t.Fatalf("error code mismatch: want %s, got %s (%v)", item.ErrorCode, code, validationErr)
			}
		})
	}
}

func TestEnvelopeProperties(t *testing.T) {
	property := func(sequence uint32, attempt uint8, payload string) bool {
		if attempt == 0 {
			attempt = 1
		}
		key := "key"
		envelope := MessageEnvelope{
			ProtocolVersion: ProtocolVersion, MessageID: "message", SessionID: "session",
			Channel: "tasks", Kind: "data", Source: "test", Sequence: uint64(sequence),
			CreatedAt: "2026-01-01T00:00:00Z", IdempotencyKey: &key,
			Attempt: uint32(attempt), PayloadType: "text", Payload: payload, Metadata: map[string]any{},
		}
		encoded, err := envelope.Encode()
		if err != nil {
			return false
		}
		decoded, err := DecodeEnvelope(encoded)
		if err != nil || decoded.MessageID != envelope.MessageID || decoded.Attempt != envelope.Attempt {
			return false
		}
		next := decoded.NextAttempt()
		return next.MessageID == decoded.MessageID && next.Attempt == decoded.Attempt+1
	}
	if err := quick.Check(property, &quick.Config{MaxCount: 100}); err != nil {
		t.Fatal(err)
	}
}

func TestErrorSanitization(t *testing.T) {
	for _, secret := range []string{"Bearer secret-value", "sk-private", "gsk_private", "pypi-private"} {
		cleaned := SanitizeError("failed " + secret + "\nnext")
		if strings.Contains(cleaned, "private") || strings.Contains(cleaned, "secret-value") || strings.Contains(cleaned, "\n") {
			t.Fatalf("secret leaked: %q", cleaned)
		}
	}
}

func TestDistributedFixtures(t *testing.T) {
	for _, name := range []string{"worker_heartbeat.json", "distributed_job.json", "job_assignment.json"} {
		data, err := os.ReadFile(filepath.Join("..", "..", "contracts", "fixtures", name))
		if err != nil {
			t.Fatal(err)
		}
		var validationErr error
		switch name {
		case "worker_heartbeat.json":
			var value WorkerHeartbeat
			_ = json.Unmarshal(data, &value)
			validationErr = value.Validate()
		case "distributed_job.json":
			var value DistributedJob
			_ = json.Unmarshal(data, &value)
			validationErr = value.Validate()
		case "job_assignment.json":
			var value JobAssignment
			_ = json.Unmarshal(data, &value)
			validationErr = value.Validate()
		}
		if validationErr != nil {
			t.Fatalf("%s: %v", name, validationErr)
		}
	}
}

func FuzzDecodeEnvelope(f *testing.F) {
	f.Add([]byte(`{"protocol_version":"1.0"}`))
	f.Add([]byte(`not-json`))
	f.Fuzz(func(t *testing.T, data []byte) {
		_, _ = DecodeEnvelope(data)
	})
}

func validateCorpus(kind string, data []byte) (any, error) {
	var value any
	var validationErr error
	switch kind {
	case "message_envelope":
		var typed MessageEnvelope
		if err := json.Unmarshal(data, &typed); err != nil {
			return nil, err
		}
		validationErr = typed.Validate()
		value = typed
	case "session_config":
		var typed SessionConfig
		if err := json.Unmarshal(data, &typed); err != nil {
			return nil, err
		}
		validationErr = typed.Validate()
		value = typed
	case "channel_config":
		var typed ChannelConfig
		if err := json.Unmarshal(data, &typed); err != nil {
			return nil, err
		}
		validationErr = typed.Validate()
		value = typed
	case "delivery_ack":
		var typed DeliveryAck
		if err := json.Unmarshal(data, &typed); err != nil {
			return nil, err
		}
		validationErr = typed.Validate()
		value = typed
	case "delivery_nack":
		var typed DeliveryNack
		if err := json.Unmarshal(data, &typed); err != nil {
			return nil, err
		}
		validationErr = typed.Validate()
		value = typed
	case "process_error":
		var typed ProcessError
		if err := json.Unmarshal(data, &typed); err != nil {
			return nil, err
		}
		validationErr = typed.Validate()
		value = typed
	case "artifact_ref":
		var typed ArtifactRef
		if err := json.Unmarshal(data, &typed); err != nil {
			return nil, err
		}
		validationErr = typed.Validate()
		value = typed
	case "worker_capabilities":
		var typed WorkerCapabilities
		if err := json.Unmarshal(data, &typed); err != nil {
			return nil, err
		}
		validationErr = typed.Validate()
		value = typed
	case "job_progress":
		var typed JobProgress
		if err := json.Unmarshal(data, &typed); err != nil {
			return nil, err
		}
		validationErr = typed.Validate()
		value = typed
	default:
		return nil, json.Unmarshal(data, &value)
	}
	if validationErr != nil {
		return nil, validationErr
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	var canonical any
	err = json.Unmarshal(encoded, &canonical)
	return canonical, err
}
