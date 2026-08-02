package security

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func durableOptions() DurableReplayOptions {
	return DefaultDurableReplayOptions()
}

func replayContext(overrides ...string) *ReplayContext {
	context := &ReplayContext{
		PeerID:                "peer-a",
		SessionID:             "session-a",
		CredentialFingerprint: "sha256:" + strings.Repeat("a", 64),
		SecurityProfile:       "standard",
	}
	if len(overrides) > 0 && overrides[0] != "" {
		context.PeerID = overrides[0]
	}
	if len(overrides) > 1 && overrides[1] != "" {
		context.SessionID = overrides[1]
	}
	if len(overrides) > 2 && overrides[2] != "" {
		context.CredentialFingerprint = overrides[2]
	}
	return context
}

func recordReplay(t *testing.T, replay *ReplayProtection, scope string, sequence uint64, nonce string, context *ReplayContext) error {
	t.Helper()
	return replay.CheckAndRecordContext(scope, sequence, nonce, time.Now().Unix(), context)
}

func requireCode(t *testing.T, err error, code string) {
	t.Helper()
	var securityErr *SecurityError
	if !errors.As(err, &securityErr) || securityErr.Code != code {
		t.Fatalf("expected %s, got %#v", code, err)
	}
}

func TestDurableReplayRejectsNonceAndSequenceAfterRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "replay.json")
	context := replayContext()
	scope := context.CredentialFingerprint + "|session-a"
	first, err := NewDurableReplayProtection(path, durableOptions())
	if err != nil {
		t.Fatal(err)
	}
	if err := recordReplay(t, first, scope, 1, "nonce-1", context); err != nil {
		t.Fatal(err)
	}

	restored, err := NewDurableReplayProtection(path, durableOptions())
	if err != nil {
		t.Fatal(err)
	}
	requireCode(t, recordReplay(t, restored, scope, 2, "nonce-1", context), "replay_nonce")
	requireCode(t, recordReplay(t, restored, scope, 1, "nonce-2", context), "replay_sequence")
	if err := recordReplay(t, restored, scope, 2, "nonce-2", context); err != nil {
		t.Fatal(err)
	}
	status, ok := restored.DurableStatus()
	if !ok || status.Generation != 2 {
		t.Fatalf("unexpected status: %#v", status)
	}
}

func TestGoLoadsSharedDurableReplayFixture(t *testing.T) {
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("cannot locate durable replay test")
	}
	fixture := filepath.Clean(filepath.Join(filepath.Dir(filename), "..", "..", "contracts", "test-fixtures", "security", "durable-replay-v1.json"))
	raw, err := os.ReadFile(fixture)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "shared-replay.json")
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	restored, err := NewDurableReplayProtection(path, durableOptions())
	if err != nil {
		t.Fatal(err)
	}
	status, ok := restored.DurableStatus()
	if !ok || status.Format != durableReplayFormat || status.FormatVersion != 1 || status.Generation != 7 || status.Scopes != 1 || status.Nonces != 2 {
		t.Fatalf("shared durable replay status mismatch: %#v", status)
	}
	context := replayContext()
	requireCode(t, restored.CheckAndRecordContext(context.CredentialFingerprint+"|session-a", 42, "", 0, context), "replay_sequence")
}

func TestDurableReplayScopesPeerSessionAndCredential(t *testing.T) {
	replay, err := NewDurableReplayProtection(filepath.Join(t.TempDir(), "replay.json"), durableOptions())
	if err != nil {
		t.Fatal(err)
	}
	values := []*ReplayContext{
		replayContext(),
		replayContext("", "session-b"),
		replayContext("peer-b", "peer-b-session"),
		replayContext("", "", "sha256:"+strings.Repeat("b", 64)),
	}
	scopes := []string{
		values[0].CredentialFingerprint + "|session-a",
		values[1].CredentialFingerprint + "|session-b",
		values[2].CredentialFingerprint + "|peer-b-session",
		values[3].CredentialFingerprint + "|session-a",
	}
	for index := range scopes {
		if err := recordReplay(t, replay, scopes[index], 1, "same", values[index]); err != nil {
			t.Fatal(err)
		}
	}
	status, _ := replay.DurableStatus()
	if status.Scopes != 4 {
		t.Fatalf("expected four scopes, got %#v", status)
	}
}

func TestDurableReplayQuarantinesTruncatedAndChecksumState(t *testing.T) {
	for _, mutation := range []string{"truncated", "checksum"} {
		t.Run(mutation, func(t *testing.T) {
			root := t.TempDir()
			path := filepath.Join(root, "replay.json")
			context := replayContext()
			replay, err := NewDurableReplayProtection(path, durableOptions())
			if err != nil {
				t.Fatal(err)
			}
			if err := recordReplay(t, replay, context.CredentialFingerprint+"|session-a", 1, "nonce-1", context); err != nil {
				t.Fatal(err)
			}
			if mutation == "truncated" {
				if err := os.WriteFile(path, []byte("{"), 0o600); err != nil {
					t.Fatal(err)
				}
			} else {
				raw, err := os.ReadFile(path)
				if err != nil {
					t.Fatal(err)
				}
				var value map[string]any
				if err := json.Unmarshal(raw, &value); err != nil {
					t.Fatal(err)
				}
				value["checksum"] = "sha256:" + strings.Repeat("0", 64)
				encoded, _ := json.Marshal(value)
				if err := os.WriteFile(path, encoded, 0o600); err != nil {
					t.Fatal(err)
				}
			}
			_, err = NewDurableReplayProtection(path, durableOptions())
			requireCode(t, err, "security_state_corrupt")
			if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("primary state should be quarantined: %v", err)
			}
			matches, _ := filepath.Glob(filepath.Join(root, "replay.json.corrupt-*"))
			if len(matches) != 1 {
				t.Fatalf("expected one quarantine, got %v", matches)
			}
		})
	}
}

func TestDurableReplayIgnoresOrphanedTempFile(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "replay.json")
	context := replayContext()
	scope := context.CredentialFingerprint + "|session-a"
	replay, err := NewDurableReplayProtection(path, durableOptions())
	if err != nil {
		t.Fatal(err)
	}
	if err := recordReplay(t, replay, scope, 1, "nonce-1", context); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".replay.json.tmp-crash"), []byte("{"), 0o600); err != nil {
		t.Fatal(err)
	}
	restored, err := NewDurableReplayProtection(path, durableOptions())
	if err != nil {
		t.Fatal(err)
	}
	requireCode(t, recordReplay(t, restored, scope, 1, "nonce-new", context), "replay_sequence")
}

func TestDurableReplayWriteFailureDoesNotAdvanceMemory(t *testing.T) {
	path := filepath.Join(t.TempDir(), "replay.json")
	context := replayContext()
	scope := context.CredentialFingerprint + "|session-a"
	replay, err := NewDurableReplayProtection(path, durableOptions())
	if err != nil {
		t.Fatal(err)
	}
	if err := recordReplay(t, replay, scope, 1, "nonce-1", context); err != nil {
		t.Fatal(err)
	}
	original := atomicReplaceState
	atomicReplaceState = func(_, _ string) error { return errors.New("simulated full disk") }
	t.Cleanup(func() { atomicReplaceState = original })
	requireCode(t, recordReplay(t, replay, scope, 2, "nonce-2", context), "security_state_write_failed")
	atomicReplaceState = original
	if err := recordReplay(t, replay, scope, 2, "nonce-2", context); err != nil {
		t.Fatal(err)
	}
}

func TestDurableReplayCapacityFailsClosed(t *testing.T) {
	options := durableOptions()
	options.MaxScopes = 1
	options.MaxSeenNonces = 1
	path := filepath.Join(t.TempDir(), "replay.json")
	context := replayContext()
	scope := context.CredentialFingerprint + "|session-a"
	replay, err := NewDurableReplayProtection(path, options)
	if err != nil {
		t.Fatal(err)
	}
	if err := recordReplay(t, replay, scope, 1, "nonce-1", context); err != nil {
		t.Fatal(err)
	}
	requireCode(t, recordReplay(t, replay, scope, 2, "nonce-2", context), "replay_state_capacity")
	requireCode(t, recordReplay(t, replay, "other", 1, "other", replayContext("peer-b")), "replay_state_capacity")
	restored, err := NewDurableReplayProtection(path, options)
	if err != nil {
		t.Fatal(err)
	}
	requireCode(t, recordReplay(t, restored, scope, 1, "nonce-new", context), "replay_sequence")
}

func TestDurableReplayCompactsExpiredScope(t *testing.T) {
	options := durableOptions()
	options.WindowSeconds = 1
	options.StateTTLSeconds = 2
	path := filepath.Join(t.TempDir(), "replay.json")
	context := replayContext()
	replay, err := NewDurableReplayProtection(path, options)
	if err != nil {
		t.Fatal(err)
	}
	if err := recordReplay(t, replay, context.CredentialFingerprint+"|session-a", 1, "nonce-1", context); err != nil {
		t.Fatal(err)
	}
	if err := replay.CompactDurable(time.Now().Add(3 * time.Second)); err != nil {
		t.Fatal(err)
	}
	status, _ := replay.DurableStatus()
	if status.Scopes != 0 || status.Nonces != 0 || status.Generation != 2 {
		t.Fatalf("unexpected compacted status: %#v", status)
	}
}

func TestDurableReplayRequiresAuthenticatedContext(t *testing.T) {
	replay, err := NewDurableReplayProtection(filepath.Join(t.TempDir(), "replay.json"), durableOptions())
	if err != nil {
		t.Fatal(err)
	}
	requireCode(t, replay.CheckAndRecord("scope", 1, "nonce", time.Now().Unix()), "replay_context_missing")
}
