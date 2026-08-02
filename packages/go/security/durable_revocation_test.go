package security

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func revocationEntry(t *testing.T, kind RevocationKind, value string, now, effectiveAt, expiresAt int64) RevocationEntry {
	t.Helper()
	entry, err := NewRevocationEntry(kind, value, "credential compromise", now, effectiveAt, expiresAt)
	if err != nil {
		t.Fatal(err)
	}
	return entry
}

func revocationOptions() DurableRevocationOptions {
	return DefaultDurableRevocationOptions()
}

func TestDurableRevocationPersistsAndScopesSubjects(t *testing.T) {
	path := filepath.Join(t.TempDir(), "revocations.json")
	policy, err := NewDurableRevocationPolicy(path, revocationOptions())
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().Unix()
	for _, entry := range []RevocationEntry{
		revocationEntry(t, RevocationCertificateFingerprint, "sha256:"+strings.Repeat("a", 64), now, 0, 0),
		revocationEntry(t, RevocationPeerID, "peer-a", now, 0, 0),
		revocationEntry(t, RevocationIssuer, "CN=HandoffKit Test CA", now, 0, 0),
		revocationEntry(t, RevocationTrustDomain, "HANDOFFKIT.INTERNAL", now, 0, 0),
	} {
		if err := policy.Revoke(entry); err != nil {
			t.Fatal(err)
		}
	}
	restored, err := NewDurableRevocationPolicy(path, revocationOptions())
	if err != nil {
		t.Fatal(err)
	}
	if status := restored.Status(now); status.Generation != 4 || status.Entries != 4 || status.Active != 4 {
		t.Fatalf("unexpected revocation status: %#v", status)
	}
	for _, candidate := range []struct {
		kind  RevocationKind
		value string
	}{
		{RevocationCertificateFingerprint, strings.Repeat("AA:", 31) + "AA"},
		{RevocationPeerID, "peer-a"},
		{RevocationIssuer, "CN=HandoffKit Test CA"},
		{RevocationTrustDomain, "handoffkit.internal"},
	} {
		revoked, checkErr := restored.IsRevoked(candidate.kind, candidate.value, now)
		if checkErr != nil || !revoked {
			t.Fatalf("expected %s revocation, got %v: %v", candidate.kind, revoked, checkErr)
		}
	}
	if revoked, _ := restored.IsRevoked(RevocationCertificateFingerprint, "sha256:"+strings.Repeat("b", 64), now); revoked {
		t.Fatal("renewed credential was incorrectly revoked")
	}
}

func TestGoLoadsSharedDurableRevocationFixture(t *testing.T) {
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("cannot locate durable revocation test")
	}
	fixture := filepath.Clean(filepath.Join(filepath.Dir(filename), "..", "..", "contracts", "test-fixtures", "security", "durable-revocation-v1.json"))
	raw, err := os.ReadFile(fixture)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "shared-revocations.json")
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	policy, err := NewDurableRevocationPolicy(path, revocationOptions())
	if err != nil {
		t.Fatal(err)
	}
	status := policy.Status(1_800_000_000)
	if status.Generation != 3 || status.Entries != 3 || status.Active != 2 {
		t.Fatalf("shared revocation status mismatch: %#v", status)
	}
	for _, candidate := range []struct {
		kind     RevocationKind
		value    string
		expected bool
	}{
		{RevocationCertificateFingerprint, "sha256:" + strings.Repeat("a", 64), true},
		{RevocationSignerFingerprint, "sha256:" + strings.Repeat("b", 64), true},
		{RevocationPeerID, "peer-b", false},
	} {
		revoked, err := policy.IsRevoked(candidate.kind, candidate.value, 1_800_000_000)
		if err != nil || revoked != candidate.expected {
			t.Fatalf("shared revocation decision mismatch: %v, %v", revoked, err)
		}
	}
}

func TestDurableRevocationEffectiveWindowRemoveAndReload(t *testing.T) {
	path := filepath.Join(t.TempDir(), "revocations.json")
	reader, _ := NewDurableRevocationPolicy(path, revocationOptions())
	writer, _ := NewDurableRevocationPolicy(path, revocationOptions())
	now := time.Now().Unix()
	if err := writer.Revoke(revocationEntry(t, RevocationPeerID, "future-peer", now, now+10, now+20)); err != nil {
		t.Fatal(err)
	}
	if revoked, _ := reader.IsRevoked(RevocationPeerID, "future-peer", now+11); revoked {
		t.Fatal("reader changed without explicit reload")
	}
	if err := reader.Reload(); err != nil {
		t.Fatal(err)
	}
	for timestamp, expected := range map[int64]bool{now + 9: false, now + 10: true, now + 20: false} {
		revoked, err := reader.IsRevoked(RevocationPeerID, "future-peer", timestamp)
		if err != nil || revoked != expected {
			t.Fatalf("unexpected decision at %d: %v, %v", timestamp, revoked, err)
		}
	}
	removed, err := writer.Remove(RevocationPeerID, "future-peer")
	if err != nil || !removed {
		t.Fatalf("remove failed: %v, %v", removed, err)
	}
	if err := reader.Reload(); err != nil {
		t.Fatal(err)
	}
	if revoked, _ := reader.IsRevoked(RevocationPeerID, "future-peer", now+11); revoked {
		t.Fatal("removed revocation remained active")
	}
}

func TestDurableRevocationCapacityAndCorruptionFailClosed(t *testing.T) {
	path := filepath.Join(t.TempDir(), "revocations.json")
	options := revocationOptions()
	options.MaxEntries = 1
	policy, err := NewDurableRevocationPolicy(path, options)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().Unix()
	if err := policy.Revoke(revocationEntry(t, RevocationPeerID, "peer-a", now, 0, 0)); err != nil {
		t.Fatal(err)
	}
	err = policy.Revoke(revocationEntry(t, RevocationPeerID, "peer-b", now, 0, 0))
	requireCode(t, err, "revocation_state_capacity")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil {
		t.Fatal(err)
	}
	value["checksum"] = "sha256:00"
	raw, _ = json.Marshal(value)
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	_, err = NewDurableRevocationPolicy(path, options)
	requireCode(t, err, "security_state_corrupt")
	if _, statErr := os.Stat(path); !errors.Is(statErr, os.ErrNotExist) {
		t.Fatalf("corrupt state was not quarantined: %v", statErr)
	}
}

func TestArtifactVerificationUsesDurableSignerRevocation(t *testing.T) {
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	credential := ArtifactSigningCredential{SignerIdentity: "producer-a", PublicKey: publicKey}
	signer := &ArtifactSigner{PrivateKey: privateKey, SignerIdentity: "producer-a"}
	artifact, err := signer.SignArtifact("artifact-a", []byte("verified payload"), time.Now().Unix())
	if err != nil {
		t.Fatal(err)
	}
	revocations, err := NewDurableRevocationPolicy(filepath.Join(t.TempDir(), "revocations.json"), revocationOptions())
	if err != nil {
		t.Fatal(err)
	}
	policy := NewArtifactTrustPolicy([]ArtifactSigningCredential{credential})
	policy.RevocationPolicy = revocations
	if err := VerifySignedArtifact([]byte("verified payload"), artifact, policy, time.Now().Unix()); err != nil {
		t.Fatal(err)
	}
	entry := revocationEntry(t, RevocationSignerFingerprint, credential.Fingerprint(), time.Now().Unix(), 0, 0)
	if err := revocations.Revoke(entry); err != nil {
		t.Fatal(err)
	}
	requireCode(t, VerifySignedArtifact([]byte("verified payload"), artifact, policy, time.Now().Unix()), "artifact_signer_revoked")
}
