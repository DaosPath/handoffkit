//go:build linux

package edgeprofile

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/DaosPath/handoffkit/go/security"
)

func TestEdgeSmallReadOnlyDurableStateFailsClosed(t *testing.T) {
	root := t.TempDir()
	state := filepath.Join(root, "replay.json")
	options := security.DefaultDurableReplayOptions()
	options.MaxSeenNonces = 32
	options.MaxScopes = 32
	options.MaxFileBytes = 64 * 1024
	replay, err := security.NewDurableReplayProtection(state, options)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(root, 0o500); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(root, 0o700) })
	context := &security.ReplayContext{
		PeerID:                "edge-peer",
		SessionID:             "edge-session",
		CredentialFingerprint: "sha256:" + strings.Repeat("0", 64),
		SecurityProfile:       "standard",
	}
	err = replay.CheckAndRecordContext(
		context.CredentialFingerprint+"|"+context.SessionID,
		1,
		"edge-read-only",
		time.Now().Unix(),
		context,
	)
	var structured *security.SecurityError
	if !errors.As(err, &structured) || structured.Code != "security_state_write_failed" {
		t.Fatalf("read-only durable state did not fail closed: %#v", err)
	}
}
