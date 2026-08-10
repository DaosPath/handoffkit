package artifactgate

import (
	"encoding/json"
	"testing"
)

func FuzzArtifactSignatureMetadata(f *testing.F) {
	f.Add([]byte(`{"signed_artifact":{"artifact_id":"artifact-1","content_hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","signature":"AA==","algorithm":"ed25519","signer_identity":"producer-1","key_fingerprint":"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","created_at":1}}`))
	f.Add([]byte(`{"signed_artifact":{"algorithm":"unknown"}}`))
	f.Fuzz(func(t *testing.T, data []byte) {
		if len(data) > 64*1024 {
			return
		}
		var metadata map[string]any
		if json.Unmarshal(data, &metadata) != nil {
			return
		}
		_, _, _ = signedMetadata(metadata)
	})
}
