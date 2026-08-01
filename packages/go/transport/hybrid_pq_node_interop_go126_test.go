//go:build go1.26

package transport

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/DaosPath/handoffkit/go/security"
)

type nodeHybridResult struct {
	state tls.ConnectionState
	peer  *security.PeerIdentity
	err   error
}

func TestGoNodeHybridPQMTLSInteroperability(t *testing.T) {
	if os.Getenv("HANDOFFKIT_RUN_HYBRID_INTEROP") != "1" {
		t.Skip("set HANDOFFKIT_RUN_HYBRID_INTEROP=1 for Node/Go hybrid interoperability")
	}
	if !security.DetectHybridPQSupport() {
		t.Fatal("active Go crypto/tls provider does not expose X25519MLKEM768")
	}

	config := secureTransportConfig(t, "server", "client")
	config.SecurityConfig.Profile = security.SecurityProfileHybridPQ
	listener, err := ListenTCP("127.0.0.1:0", config)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()

	accepted := make(chan nodeHybridResult, 1)
	go func() {
		connection, acceptErr := listener.Accept()
		if acceptErr != nil {
			accepted <- nodeHybridResult{err: acceptErr}
			return
		}
		transport, transportErr := NewLengthDelimited(connection, config)
		if transportErr != nil {
			_ = connection.Close()
			accepted <- nodeHybridResult{err: transportErr}
			return
		}
		state, _ := transport.TLSState()
		peer := transport.AuthenticatedPeer
		_ = transport.Close()
		accepted <- nodeHybridResult{state: state, peer: peer}
	}()

	root := filepath.Clean(filepath.Join("..", "..", ".."))
	script := filepath.Join(root, "packages", "js", "node", "test-support", "hybrid-go-client.mjs")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	nodeBinary := os.Getenv("HANDOFFKIT_NODE_BIN")
	if nodeBinary == "" {
		nodeBinary = "node"
	}
	output, commandErr := exec.CommandContext(
		ctx,
		nodeBinary,
		script,
		listener.Addr().String(),
		tlsFixtureRoot,
	).CombinedOutput()
	if commandErr != nil {
		_ = listener.Close()
		t.Fatalf("Node hybrid client failed: %v\n%s", commandErr, output)
	}

	var nodeState struct {
		Authorized bool   `json:"authorized"`
		Protocol   string `json:"protocol"`
		Provider   string `json:"provider"`
	}
	if err := json.Unmarshal(output, &nodeState); err != nil {
		t.Fatalf("Node hybrid client emitted invalid state %q: %v", output, err)
	}
	if !nodeState.Authorized || nodeState.Protocol != "TLSv1.3" || nodeState.Provider == "" {
		t.Fatalf("Node did not authenticate the Go TLS 1.3 server: %#v", nodeState)
	}

	select {
	case result := <-accepted:
		if result.err != nil {
			t.Fatal(result.err)
		}
		if result.state.Version != tls.VersionTLS13 || result.state.CurveID != tls.X25519MLKEM768 {
			t.Fatalf("Node/Go negotiated unexpected TLS state: %#v", result.state)
		}
		expectedPeer := fixtureIdentity(t, "client")
		if result.peer == nil || result.peer.PeerID != expectedPeer.PeerID ||
			result.peer.CredentialFingerprint != expectedPeer.CredentialFingerprint {
			t.Fatalf("Go did not bind the Node identity to its client certificate: %#v", result.peer)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Go did not finish the Node hybrid mTLS handshake")
	}
}
