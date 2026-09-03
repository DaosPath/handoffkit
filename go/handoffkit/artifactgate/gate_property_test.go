package artifactgate

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/quick"

	"github.com/DaosPath/handoffkit/go/contract"
)

func TestArtifactHashGateProperty(t *testing.T) {
	property := func(seed uint64) bool {
		root := t.TempDir()
		data := []byte(fmt.Sprintf("artifact-property-%d", seed))
		path := filepath.Join(root, "artifact.bin")
		if os.WriteFile(path, data, 0o600) != nil {
			return false
		}
		gate, err := New(Policy{
			HashRequired: true, SignatureRequirement: SignatureOptional,
			AllowedMediaTypes: map[string]bool{"application/octet-stream": true},
			MaxSizeBytes:      1024, AllowedRoots: []string{root},
			SnapshotDirectory: filepath.Join(root, "snapshots"),
		})
		if err != nil {
			return false
		}
		digest := sha256.Sum256(data)
		reference := contract.ArtifactRef{
			ArtifactID: "artifact-property", URI: fileURI(path),
			SHA256: hex.EncodeToString(digest[:]), SizeBytes: uint64(len(data)),
			MediaType: "application/octet-stream", Metadata: map[string]any{},
		}
		verified, err := gate.Ingest(reference, 1)
		if err != nil {
			return false
		}
		_ = verified.Close()
		reference.SHA256 = strings.Repeat("0", 64)
		_, err = gate.Ingest(reference, 1)
		return errorCode(err) == "artifact_integrity_mismatch"
	}
	if err := quick.Check(property, &quick.Config{MaxCount: 24}); err != nil {
		t.Fatal(err)
	}
}
