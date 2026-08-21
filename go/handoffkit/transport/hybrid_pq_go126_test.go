//go:build go1.26

package transport

import (
	"context"
	"crypto/tls"
	"net"
	"os"
	"testing"

	"github.com/DaosPath/handoffkit/go/security"
)

func TestGoHybridPQNegotiatesX25519MLKEM768(t *testing.T) {
	if !security.DetectHybridPQSupport() {
		if os.Getenv("HANDOFFKIT_REQUIRE_HYBRID_PQ") == "1" {
			t.Fatal("active Go crypto/tls provider does not expose X25519MLKEM768")
		}
		t.Skip("active Go crypto/tls provider does not expose X25519MLKEM768")
	}
	serverConfig := secureTransportConfig(t, "server", "client")
	serverConfig.SecurityConfig.Profile = security.SecurityProfileHybridPQ
	clientConfig := secureTransportConfig(t, "client", "server")
	clientConfig.SecurityConfig.Profile = security.SecurityProfileHybridPQ
	listener, err := ListenTCP("127.0.0.1:0", serverConfig)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	result := make(chan error, 1)
	go acceptOne(listener, serverConfig, result, func(server *LengthDelimited) error {
		state, ok := server.TLSState()
		if !ok || state.Version != tls.VersionTLS13 || state.CurveID != tls.X25519MLKEM768 {
			t.Errorf("server negotiated unexpected TLS state: %#v", state)
		}
		return nil
	})
	client, err := DialTCP(context.Background(), listener.Addr().String(), clientConfig)
	if err != nil {
		t.Fatalf("hybrid client handshake failed: %#v", err)
	}
	state, ok := client.TLSState()
	if !ok || state.Version != tls.VersionTLS13 || state.CurveID != tls.X25519MLKEM768 {
		t.Fatalf("client negotiated unexpected TLS state: %#v", state)
	}
	_ = client.Close()
	if err := <-result; err != nil {
		t.Fatal(err)
	}
}

func TestGoHybridPQRejectsDirectStandardTLSWrapping(t *testing.T) {
	if !security.DetectHybridPQSupport() {
		if os.Getenv("HANDOFFKIT_REQUIRE_HYBRID_PQ") == "1" {
			t.Fatal("active Go crypto/tls provider does not expose X25519MLKEM768")
		}
		t.Skip("active Go crypto/tls provider does not expose X25519MLKEM768")
	}
	serverConfig := secureTransportConfig(t, "server", "client")
	serverTLSConfig, err := security.BuildTLSConfig(serverConfig.SecurityConfig, true)
	if err != nil {
		t.Fatal(err)
	}
	serverTLSConfig.CurvePreferences = []tls.CurveID{tls.X25519}

	rawListener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	listener := tls.NewListener(rawListener, serverTLSConfig)
	defer listener.Close()

	result := make(chan error, 1)
	release := make(chan struct{})
	go func() {
		connection, acceptErr := listener.Accept()
		if acceptErr != nil {
			result <- acceptErr
			return
		}
		defer connection.Close()
		hybridConfig := serverConfig
		hybridSecurity := *serverConfig.SecurityConfig
		hybridSecurity.Profile = security.SecurityProfileHybridPQ
		hybridConfig.SecurityConfig = &hybridSecurity
		_, wrapErr := NewLengthDelimited(connection, hybridConfig)
		_, _ = connection.Write([]byte{0})
		result <- wrapErr
		<-release
	}()

	clientConfig := secureTransportConfig(t, "client", "server")
	clientTLSConfig, err := security.BuildTLSConfig(
		clientConfig.SecurityConfig,
		false,
		"localhost",
	)
	if err != nil {
		t.Fatal(err)
	}
	clientTLSConfig.CurvePreferences = []tls.CurveID{tls.X25519}
	client, err := tls.Dial("tcp", listener.Addr().String(), clientTLSConfig)
	if err != nil {
		t.Fatal(err)
	}
	_ = client.Close()
	close(release)

	if code := securityCode(<-result); code != "security_profile_mismatch" {
		t.Fatalf("expected security_profile_mismatch, got %q", code)
	}
}
