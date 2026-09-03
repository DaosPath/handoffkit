package security

import (
	"errors"
	"fmt"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"testing/quick"
	"time"
)

func TestSecurityTranscriptDeterminismProperty(t *testing.T) {
	property := func(seed uint64) bool {
		capabilities := []string{fmt.Sprintf("job:%d", seed%17), "artifact:read", "job:submit"}
		reversed := append([]string(nil), capabilities...)
		for left, right := 0, len(reversed)-1; left < right; left, right = left+1, right-1 {
			reversed[left], reversed[right] = reversed[right], reversed[left]
		}
		sender := PeerIdentity{
			PeerID: "peer-a", NodeID: "node-a", TrustDomain: "handoffkit.internal",
			CredentialFingerprint: "sha256:" + strings.Repeat("a", 64), Capabilities: capabilities,
		}
		receiver := PeerIdentity{
			PeerID: "peer-b", NodeID: "node-b", TrustDomain: "handoffkit.internal",
			CredentialFingerprint: "sha256:" + strings.Repeat("b", 64),
		}
		input := SecurityTranscriptInput{
			ProtocolVersion: "1.0", RequestedProfile: SecurityProfileStandard,
			SelectedProfile: SecurityProfileStandard, Sender: &sender, Receiver: &receiver,
			TLSVersion: "TLSv1.3", SessionID: "property-session",
			HandshakeNonce: fmt.Sprintf("nonce-%d", seed), Timestamp: "2026-01-01T00:00:00Z",
		}
		first, firstErr := BuildSecurityTranscript(input)
		sender.Capabilities = reversed
		second, secondErr := BuildSecurityTranscript(input)
		return firstErr == nil && secondErr == nil && reflect.DeepEqual(first, second)
	}
	if err := quick.Check(property, &quick.Config{MaxCount: 100}); err != nil {
		t.Fatal(err)
	}
}

func TestRotationWindowProperty(t *testing.T) {
	property := func(duration uint16, offset int16, skew uint8) bool {
		base := int64(2_000_000_000)
		policy, err := NewCredentialRotationPolicy("sha256:"+strings.Repeat("a", 64), int64(skew))
		if err != nil {
			return false
		}
		until := base + int64(duration)
		if policy.Rotate("sha256:"+strings.Repeat("b", 64), until) != nil {
			return false
		}
		now := base + int64(offset)
		previousExpected := now <= until+int64(skew)
		return policy.IsAllowed("sha256:"+strings.Repeat("a", 64), now) == previousExpected &&
			policy.IsAllowed("sha256:"+strings.Repeat("b", 64), now)
	}
	if err := quick.Check(property, &quick.Config{MaxCount: 100}); err != nil {
		t.Fatal(err)
	}
}

func TestDurableReplayRestartProperty(t *testing.T) {
	property := func(rawSequence uint16, nonceSeed uint32) bool {
		sequence := uint64(rawSequence) + 1
		nonce := fmt.Sprintf("nonce-%d", nonceSeed)
		path := filepath.Join(t.TempDir(), "replay.json")
		options := DefaultDurableReplayOptions()
		first, err := NewDurableReplayProtection(path, options)
		if err != nil {
			return false
		}
		context := replayContext()
		scope := context.CredentialFingerprint + "|" + context.SessionID
		now := time.Now().Unix()
		if first.CheckAndRecordContext(scope, sequence, nonce, now, context) != nil {
			return false
		}
		restored, err := NewDurableReplayProtection(path, options)
		if err != nil {
			return false
		}
		err = restored.CheckAndRecordContext(scope, sequence+1, nonce, now, context)
		var structured *SecurityError
		return errors.As(err, &structured) && structured.Code == "replay_nonce"
	}
	if err := quick.Check(property, &quick.Config{MaxCount: 24}); err != nil {
		t.Fatal(err)
	}
}

func TestDurableRevocationEffectiveWindowProperty(t *testing.T) {
	property := func(delay uint8, lifetime uint8) bool {
		base := int64(2_000_000_000)
		effective := base + int64(delay)
		expires := effective + int64(lifetime) + 1
		policy, err := NewDurableRevocationPolicy(
			filepath.Join(t.TempDir(), "revocations.json"), DefaultDurableRevocationOptions())
		if err != nil {
			return false
		}
		entry, err := NewRevocationEntry(RevocationPeerID, "property-peer", "property", base, effective, expires)
		if err != nil || policy.Revoke(entry) != nil {
			return false
		}
		before, beforeErr := policy.IsRevoked(RevocationPeerID, "property-peer", effective-1)
		during, duringErr := policy.IsRevoked(RevocationPeerID, "property-peer", effective)
		after, afterErr := policy.IsRevoked(RevocationPeerID, "property-peer", expires+1)
		return beforeErr == nil && duringErr == nil && afterErr == nil && !before && during && !after
	}
	if err := quick.Check(property, &quick.Config{MaxCount: 24}); err != nil {
		t.Fatal(err)
	}
}
