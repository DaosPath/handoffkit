package security_test

import (
	"testing"
	"time"

	"github.com/DaosPath/handoffkit/go/security"
)

func TestSecurityConfigValidation(t *testing.T) {
	cfg := security.NewDefaultSecurityConfig()
	if err := cfg.ValidateListenAddress("127.0.0.1"); err != nil {
		t.Fatalf("unexpected error for loopback: %v", err)
	}

	if err := cfg.ValidateListenAddress("192.168.1.1"); err == nil {
		t.Fatal("expected error for non-loopback address in local profile")
	}

	cfgInsecure := &security.SecurityConfig{
		Profile:               security.SecurityProfileLocal,
		AllowInsecureLoopback: true,
	}
	if err := cfgInsecure.ValidateListenAddress("0.0.0.0"); err == nil {
		t.Fatal("expected error for 0.0.0.0 with allow_insecure_loopback")
	}
}

func TestPeerIdentityValidation(t *testing.T) {
	now := time.Now().Unix()
	peer := &security.PeerIdentity{
		PeerID:       "p1",
		NodeID:       "n1",
		Capabilities: []string{"job:training"},
		IssuedAt:     now - 100,
		ExpiresAt:    now + 3600,
	}

	if !peer.IsValidAt(now) {
		t.Fatal("expected peer identity to be valid")
	}

	if peer.IsValidAt(now + 4000) {
		t.Fatal("expected peer identity to be expired")
	}
}

func TestCapabilityPolicyAuthorization(t *testing.T) {
	policy := security.NewCapabilityPolicy([]string{"job:training"}, nil)
	now := time.Now().Unix()
	peer := &security.PeerIdentity{
		PeerID:       "p1",
		NodeID:       "n1",
		Capabilities: []string{"job:training"},
		IssuedAt:     now - 100,
		ExpiresAt:    now + 3600,
	}

	if err := policy.AuthorizeJob("training", peer); err != nil {
		t.Fatalf("unexpected authorization error: %v", err)
	}

	if err := policy.AuthorizeJob("evaluation", peer); err == nil {
		t.Fatal("expected authorization error for evaluation job")
	}
}

func TestReplayProtectionSequences(t *testing.T) {
	rp := security.NewReplayProtection(300, 10, 1000)
	if err := rp.CheckAndRecord("s1", 1, "nonce-1", 0); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if err := rp.CheckAndRecord("s1", 2, "nonce-2", 0); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if err := rp.CheckAndRecord("s1", 2, "nonce-3", 0); err == nil {
		t.Fatal("expected error for non-monotonic sequence")
	}

	if err := rp.CheckAndRecord("s2", 1, "nonce-1", 0); err == nil {
		t.Fatal("expected error for duplicate nonce")
	}
}
