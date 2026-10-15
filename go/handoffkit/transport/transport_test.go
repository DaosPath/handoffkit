package transport

import (
	"context"
	"encoding/binary"
	"net"
	"testing"
	"time"

	"github.com/DaosPath/handoffkit/go/contract"
	"github.com/DaosPath/handoffkit/go/security"
)

func networkEnvelope() contract.MessageEnvelope {
	key := "network-1"
	return contract.MessageEnvelope{
		ProtocolVersion: contract.ProtocolVersion, MessageID: key, SessionID: "network",
		Channel: "tasks", Kind: "data", Source: "go", Sequence: 1,
		CreatedAt: "2026-01-01T00:00:00Z", IdempotencyKey: &key, Attempt: 1,
		PayloadType: "json", Payload: map[string]any{"ok": true}, Metadata: map[string]any{},
	}
}

func TestLengthDelimitedRealTCP(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	done := make(chan error, 1)
	go func() {
		connection, acceptErr := listener.Accept()
		if acceptErr != nil {
			done <- acceptErr
			return
		}
		server, wrapErr := NewLengthDelimited(connection, DefaultConfig())
		if wrapErr != nil {
			done <- wrapErr
			return
		}
		envelope, receiveErr := server.Receive(context.Background())
		if receiveErr == nil {
			receiveErr = server.Send(context.Background(), envelope)
		}
		_ = server.Close()
		done <- receiveErr
	}()
	client, err := DialTCP(context.Background(), listener.Addr().String(), DefaultConfig())
	if err != nil {
		t.Fatal(err)
	}
	envelope := networkEnvelope()
	if err := client.Send(context.Background(), envelope); err != nil {
		t.Fatal(err)
	}
	response, err := client.Receive(context.Background())
	if err != nil || response.MessageID != envelope.MessageID {
		t.Fatal("TCP roundtrip failed", err)
	}
	_ = client.Close()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}

func TestOversizedHeaderRejectedBeforePayload(t *testing.T) {
	serverConnection, clientConnection := net.Pipe()
	defer serverConnection.Close()
	defer clientConnection.Close()
	config := DefaultConfig()
	config.MaxMessageBytes = 4096
	client, err := NewLengthDelimited(clientConnection, config)
	if err != nil {
		t.Fatal(err)
	}
	go func() {
		header := make([]byte, 4)
		binary.BigEndian.PutUint32(header, 4097)
		_, _ = serverConnection.Write(header)
	}()
	if _, err := client.Receive(context.Background()); err == nil {
		t.Fatal("oversized frame accepted")
	}
}

func TestTransportConfigRejectsUnavailableResearchProfile(t *testing.T) {
	config := DefaultConfig()
	config.SecurityConfig.Profile = security.SecurityProfileResearch
	err := config.Validate()
	if code := securityCode(err); code != "security_profile_unavailable" {
		t.Fatalf("expected security_profile_unavailable, got %q", code)
	}
}

func TestTCPRetryConnectsWhenServerAppears(t *testing.T) {
	probe, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := probe.Addr().String()
	probe.Close()
	ready := make(chan net.Listener, 1)
	go func() {
		time.Sleep(30 * time.Millisecond)
		listener, listenErr := net.Listen("tcp", address)
		if listenErr != nil {
			ready <- nil
			return
		}
		ready <- listener
		connection, _ := listener.Accept()
		if connection != nil {
			connection.Close()
		}
	}()
	config := DefaultConfig()
	config.RetryPolicy = contract.RetryPolicy{MaxAttempts: 5, BaseDelayMS: 20, MaxDelayMS: 40}
	client, err := DialTCPWithRetry(context.Background(), address, config)
	if err != nil {
		t.Fatal(err)
	}
	_ = client.Close()
	listener := <-ready
	if listener == nil {
		t.Fatal("server failed to start")
	}
	listener.Close()
}

func FuzzNDJSONFrame(f *testing.F) {
	f.Add([]byte(`{"message_id":"x"}\n`))
	f.Add([]byte("not-json\n"))
	f.Fuzz(func(t *testing.T, data []byte) {
		left, right := net.Pipe()
		defer left.Close()
		defer right.Close()
		wire, err := NewNDJSON(left, left, left, 4096)
		if err != nil {
			t.Fatal(err)
		}
		go func() { _, _ = right.Write(data); _ = right.Close() }()
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
		defer cancel()
		_, _ = wire.Receive(ctx)
	})
}
