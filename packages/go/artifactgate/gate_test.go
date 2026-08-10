package artifactgate

import (
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/DaosPath/handoffkit/go/contract"
	"github.com/DaosPath/handoffkit/go/security"
)

func referenceFor(t *testing.T, path, mediaType, producer string) (contract.ArtifactRef, []byte) {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	digest, err := security.ComputeSHA256(path)
	if err != nil {
		t.Fatal(err)
	}
	metadata := map[string]any{}
	if producer != "" {
		metadata["producer_identity"] = producer
	}
	return contract.ArtifactRef{
		ArtifactID: "artifact-1", URI: fileURI(path),
		SHA256: digest, SizeBytes: uint64(len(data)), MediaType: mediaType, Metadata: metadata,
	}, data
}

func basePolicy(root string) Policy {
	return Policy{
		HashRequired: true, SignatureRequirement: SignatureOptional,
		AllowedMediaTypes: map[string]bool{"application/x-ndjson": true},
		MaxSizeBytes:      1024, AllowedRoots: []string{root},
		SnapshotDirectory:   filepath.Join(root, "snapshots"),
		QuarantineDirectory: filepath.Join(root, "quarantine"),
	}
}

func requireCode(t *testing.T, err error, expected string) {
	t.Helper()
	var value *security.SecurityError
	if !errors.As(err, &value) || value.Code != expected {
		t.Fatalf("expected %s, got %#v", expected, err)
	}
}

func TestGateSnapshotsVerifiedContentAndRejectsPolicyViolations(t *testing.T) {
	root := t.TempDir()
	allowed := filepath.Join(root, "allowed")
	outside := filepath.Join(root, "outside")
	if err := os.MkdirAll(allowed, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(outside, 0o700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(allowed, "data.jsonl")
	if err := os.WriteFile(path, []byte("verified data\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	reference, original := referenceFor(t, path, "application/x-ndjson", "")
	policy := basePolicy(allowed)
	policy.SnapshotDirectory = filepath.Join(root, "snapshots")
	policy.QuarantineDirectory = filepath.Join(root, "quarantine")
	gate, err := New(policy)
	if err != nil {
		t.Fatal(err)
	}
	verified, err := gate.Ingest(reference, time.Now().Unix())
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("replaced after verification\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	snapshot, err := os.ReadFile(verified.SnapshotPath)
	if err != nil || string(snapshot) != string(original) {
		t.Fatalf("snapshot was not immutable: %q, %v", snapshot, err)
	}
	if verified.Snapshot.Metadata["ingestion_verified"] != true {
		t.Fatal("snapshot lacks verification marker")
	}
	if err := verified.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(verified.SnapshotPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("snapshot was not removed")
	}

	if err := os.WriteFile(path, original, 0o600); err != nil {
		t.Fatal(err)
	}
	badHash := reference
	badHash.SHA256 = "0" + badHash.SHA256[1:]
	if badHash.SHA256 == reference.SHA256 {
		badHash.SHA256 = "1" + badHash.SHA256[1:]
	}
	_, err = gate.Ingest(badHash, time.Now().Unix())
	requireCode(t, err, "artifact_integrity_mismatch")
	entries, err := os.ReadDir(policy.QuarantineDirectory)
	if err != nil || len(entries) == 0 {
		t.Fatalf("failure was not quarantined: %v", err)
	}

	badMedia := reference
	badMedia.MediaType = "application/octet-stream"
	_, err = gate.Ingest(badMedia, time.Now().Unix())
	requireCode(t, err, "artifact_media_type_denied")

	outsidePath := filepath.Join(outside, "data.jsonl")
	if err := os.WriteFile(outsidePath, original, 0o600); err != nil {
		t.Fatal(err)
	}
	outsideRef, _ := referenceFor(t, outsidePath, "application/x-ndjson", "")
	_, err = gate.Ingest(outsideRef, time.Now().Unix())
	requireCode(t, err, "artifact_path_denied")
}

func TestGateRejectsSymlinkEscapeAndSizeLimit(t *testing.T) {
	root := t.TempDir()
	allowed := filepath.Join(root, "allowed")
	outside := filepath.Join(root, "outside")
	if err := os.MkdirAll(allowed, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(outside, 0o700); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(outside, "target.jsonl")
	if err := os.WriteFile(target, []byte("outside\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(allowed, "escape.jsonl")
	if err := os.Symlink(target, link); err != nil {
		if runtime.GOOS == "windows" {
			t.Skipf("Windows host does not grant symlink creation: %v", err)
		}
		t.Fatal(err)
	}
	reference, _ := referenceFor(t, link, "application/x-ndjson", "")
	policy := basePolicy(allowed)
	policy.MaxSizeBytes = 4
	gate, err := New(policy)
	if err != nil {
		t.Fatal(err)
	}
	_, err = gate.Ingest(reference, time.Now().Unix())
	requireCode(t, err, "artifact_path_denied")

	inside := filepath.Join(allowed, "large.jsonl")
	if err := os.WriteFile(inside, []byte("too large\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	large, _ := referenceFor(t, inside, "application/x-ndjson", "")
	_, err = gate.Ingest(large, time.Now().Unix())
	requireCode(t, err, "artifact_too_large")
}

func TestGateRequiresAndVerifiesEd25519Producer(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "signed.bin")
	data := []byte("signed artifact\n")
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	producer := "spiffe://handoffkit.internal/producer/build-1"
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	signer := &security.ArtifactSigner{PrivateKey: privateKey, SignerIdentity: producer}
	signed, err := signer.SignArtifact("artifact-1", data, time.Now().Unix())
	if err != nil {
		t.Fatal(err)
	}
	trust := security.NewArtifactTrustPolicy([]security.ArtifactSigningCredential{{
		SignerIdentity: producer, PublicKey: publicKey,
		ValidFrom: time.Now().Add(-time.Hour).Unix(), ValidUntil: time.Now().Add(time.Hour).Unix(),
	}})
	reference, _ := referenceFor(t, path, "application/x-ndjson", producer)
	policy := basePolicy(root)
	policy.SignatureRequirement = SignatureRequired
	policy.TrustedProducers = map[string]bool{producer: true}
	policy.TrustedSigners = map[string]bool{producer: true}
	policy.SignaturePolicy = trust
	gate, err := New(policy)
	if err != nil {
		t.Fatal(err)
	}
	_, err = gate.Ingest(reference, time.Now().Unix())
	requireCode(t, err, "artifact_signature_required")
	reference.Metadata["signed_artifact"] = signed
	verified, err := gate.Ingest(reference, time.Now().Unix())
	if err != nil {
		t.Fatal(err)
	}
	defer verified.Close()

	wrongArtifactID := reference
	wrongArtifactID.Metadata = cloneMetadata(reference.Metadata)
	wrongSigned := signed
	wrongSigned.ArtifactID = "artifact-other"
	wrongArtifactID.Metadata["signed_artifact"] = wrongSigned
	_, err = gate.Ingest(wrongArtifactID, time.Now().Unix())
	requireCode(t, err, "artifact_signature_mismatch")

	invalidSignature := reference
	invalidSignature.Metadata = cloneMetadata(reference.Metadata)
	invalidSigned := signed
	invalidSigned.Signature = "AAAA"
	invalidSignature.Metadata["signed_artifact"] = invalidSigned
	_, err = gate.Ingest(invalidSignature, time.Now().Unix())
	requireCode(t, err, "artifact_signature_invalid")

	unsupportedAlgorithm := reference
	unsupportedAlgorithm.Metadata = cloneMetadata(reference.Metadata)
	unsupportedSigned := signed
	unsupportedSigned.Algorithm = "ml-dsa"
	unsupportedAlgorithm.Metadata["signed_artifact"] = unsupportedSigned
	_, err = gate.Ingest(unsupportedAlgorithm, time.Now().Unix())
	requireCode(t, err, "artifact_algorithm_unsupported")

	wrongProducer := reference
	wrongProducer.Metadata = cloneMetadata(reference.Metadata)
	wrongProducer.Metadata["producer_identity"] = "spiffe://evil.invalid/producer/a"
	_, err = gate.Ingest(wrongProducer, time.Now().Unix())
	requireCode(t, err, "artifact_producer_mismatch")

	trust.Credentials[signed.KeyFingerprint] = security.ArtifactSigningCredential{
		SignerIdentity: producer, PublicKey: publicKey, Revoked: true,
	}
	_, err = gate.Ingest(reference, time.Now().Unix())
	requireCode(t, err, "artifact_signer_revoked")
}
