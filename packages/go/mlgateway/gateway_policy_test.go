package mlgateway

import (
	"path/filepath"
	"testing"

	"github.com/DaosPath/handoffkit/go/artifactgate"
	"github.com/DaosPath/handoffkit/go/security"
)

func TestRequireSignedArtifactGateRejectsOptionalOrUntrustedInput(t *testing.T) {
	root := t.TempDir()
	gate, err := artifactgate.New(artifactgate.Policy{
		HashRequired:         true,
		SignatureRequirement: artifactgate.SignatureOptional,
		MaxSizeBytes:         1024,
		AllowedRoots:         []string{root},
		SnapshotDirectory:    filepath.Join(root, "snapshots"),
	})
	if err != nil {
		t.Fatal(err)
	}
	requireGatewayCode(t, requireSignedArtifactGate(gate, "input"), "artifact_policy_incomplete")
}

func TestRequireSignedArtifactGateAcceptsBoundSignaturePolicy(t *testing.T) {
	root := t.TempDir()
	identity := "spiffe://handoffkit.internal/producer/test"
	gate, err := artifactgate.New(artifactgate.Policy{
		HashRequired:         true,
		SignatureRequirement: artifactgate.SignatureRequired,
		TrustedProducers:     map[string]bool{identity: true},
		TrustedSigners:       map[string]bool{identity: true},
		MaxSizeBytes:         1024,
		AllowedRoots:         []string{root},
		SnapshotDirectory:    filepath.Join(root, "snapshots"),
		SignaturePolicy:      security.NewArtifactTrustPolicy(nil),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := requireSignedArtifactGate(gate, "input"); err != nil {
		t.Fatal(err)
	}
}
