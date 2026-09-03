package security_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/DaosPath/handoffkit/go/security"
)

type profileCase struct {
	ID        string                     `json:"id"`
	Required  security.SecurityProfile   `json:"required"`
	Offered   security.SecurityProfile   `json:"offered"`
	Supported []security.SecurityProfile `json:"supported"`
	Selected  security.SecurityProfile   `json:"selected"`
	ErrorCode string                     `json:"error_code"`
}

type authorizationCase struct {
	ID                string   `json:"id"`
	AllowedOperations []string `json:"allowed_operations"`
	PeerCapabilities  []string `json:"peer_capabilities"`
	Operation         string   `json:"operation"`
	Authorized        bool     `json:"authorized"`
}

type replayOperation struct {
	Peer            string `json:"peer"`
	Session         string `json:"session"`
	Sequence        uint64 `json:"sequence"`
	Nonce           string `json:"nonce"`
	TimestampOffset int64  `json:"timestamp_offset"`
	ErrorCode       string `json:"error_code"`
}

type replayCase struct {
	ID         string            `json:"id"`
	Operations []replayOperation `json:"operations"`
}

type conformanceVectors struct {
	ProfileNegotiation []profileCase       `json:"profile_negotiation"`
	Authorization      []authorizationCase `json:"authorization"`
	Replay             []replayCase        `json:"replay"`
	SignedArtifact     struct {
		CanonicalPayload string `json:"canonical_payload"`
	} `json:"signed_artifact"`
}

func contractsRoot(t *testing.T) string {
	t.Helper()
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("cannot locate conformance test")
	}
	return filepath.Clean(filepath.Join(filepath.Dir(filename), "..", "..", "..", "shared", "contracts"))
}

func loadJSON(t *testing.T, path string, target any) {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(data, target); err != nil {
		t.Fatal(err)
	}
}

func securityCode(err error) string {
	if structured, ok := err.(*security.SecurityError); ok {
		return structured.Code
	}
	return ""
}

func TestSecurityConformance(t *testing.T) {
	root := contractsRoot(t)
	var vectors conformanceVectors
	loadJSON(t, filepath.Join(root, "conformance", "security-v1.json"), &vectors)

	var config security.SecurityConfig
	loadJSON(t, filepath.Join(root, "fixtures", "security_config.json"), &config)
	encodedConfig, err := json.Marshal(config)
	if err != nil {
		t.Fatal(err)
	}
	var expectedConfig any
	loadJSON(t, filepath.Join(root, "fixtures", "security_config.json"), &expectedConfig)
	var actualConfig any
	if err := json.Unmarshal(encodedConfig, &actualConfig); err != nil {
		t.Fatal(err)
	}
	if !jsonEqual(actualConfig, expectedConfig) {
		t.Fatal("SecurityConfig wire mismatch")
	}

	var peer security.PeerIdentity
	loadJSON(t, filepath.Join(root, "fixtures", "peer_identity.json"), &peer)
	encodedPeer, _ := json.Marshal(peer)
	var expectedPeer any
	loadJSON(t, filepath.Join(root, "fixtures", "peer_identity.json"), &expectedPeer)
	var actualPeer any
	_ = json.Unmarshal(encodedPeer, &actualPeer)
	if !jsonEqual(actualPeer, expectedPeer) {
		t.Fatal("PeerIdentity wire mismatch")
	}

	var artifact security.SignedArtifact
	loadJSON(t, filepath.Join(root, "fixtures", "signed_artifact.json"), &artifact)
	payload, err := artifact.CanonicalPayload()
	if err != nil {
		t.Fatal(err)
	}
	if string(payload) != vectors.SignedArtifact.CanonicalPayload {
		t.Fatalf("canonical payload mismatch: %s", payload)
	}

	for _, testCase := range vectors.ProfileNegotiation {
		t.Run("profile/"+testCase.ID, func(t *testing.T) {
			selected, err := security.NegotiateSecurityProfile(testCase.Required, testCase.Offered, testCase.Supported)
			if testCase.ErrorCode != "" {
				if securityCode(err) != testCase.ErrorCode {
					t.Fatalf("expected %s, got %v", testCase.ErrorCode, err)
				}
			} else if err != nil || selected != testCase.Selected {
				t.Fatalf("unexpected negotiation: %s %v", selected, err)
			}
		})
	}

	for _, testCase := range vectors.Authorization {
		t.Run("authorization/"+testCase.ID, func(t *testing.T) {
			policy := security.NewCapabilityPolicy(testCase.AllowedOperations, nil)
			candidate := &security.PeerIdentity{PeerID: "peer", NodeID: "node", Capabilities: testCase.PeerCapabilities}
			if actual := policy.IsOperationAuthorized(testCase.Operation, candidate); actual != testCase.Authorized {
				t.Fatalf("expected %t, got %t", testCase.Authorized, actual)
			}
			if !testCase.Authorized {
				err := policy.AuthorizeJob(testCase.Operation[len("job:"):], candidate)
				if securityCode(err) != "authorization_denied" {
					t.Fatalf("expected authorization_denied, got %v", err)
				}
			}
		})
	}

	for _, testCase := range vectors.Replay {
		t.Run("replay/"+testCase.ID, func(t *testing.T) {
			replay := security.NewReplayProtection(30, 3, 1000)
			now := time.Now().Unix()
			for _, operation := range testCase.Operations {
				err := replay.CheckAndRecord(
					operation.Peer+"\x00"+operation.Session,
					operation.Sequence,
					operation.Nonce,
					now+operation.TimestampOffset,
				)
				if operation.ErrorCode == "" && err != nil {
					t.Fatal(err)
				}
				if operation.ErrorCode != "" && securityCode(err) != operation.ErrorCode {
					t.Fatalf("expected %s, got %v", operation.ErrorCode, err)
				}
			}
		})
	}
}

func jsonEqual(left, right any) bool {
	leftJSON, _ := json.Marshal(left)
	rightJSON, _ := json.Marshal(right)
	return string(leftJSON) == string(rightJSON)
}
