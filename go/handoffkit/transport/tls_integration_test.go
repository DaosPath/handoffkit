package transport

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/DaosPath/handoffkit/go/contract"
	"github.com/DaosPath/handoffkit/go/internal/testsupport"
	"github.com/DaosPath/handoffkit/go/security"
)

const (
	testTrustDomain = "handoffkit.internal"
	testIssuer      = "CN=HandoffKit Test CA"
	testOperation   = "message:echo"
)

var tlsFixtureRoot string

func TestMain(testingMain *testing.M) {
	root, cleanup, err := testsupport.GenerateTLSFixtures()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	tlsFixtureRoot = root
	code := testingMain.Run()
	cleanup()
	os.Exit(code)
}

func tlsFixture(name string) string {
	return filepath.Join(tlsFixtureRoot, name)
}

func fixtureCertificate(t *testing.T, name string) *x509.Certificate {
	t.Helper()
	data, err := os.ReadFile(tlsFixture(name + "_cert.pem"))
	if err != nil {
		t.Fatal(err)
	}
	block, _ := pem.Decode(data)
	if block == nil {
		t.Fatalf("fixture %s contains no certificate", name)
	}
	certificate, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		t.Fatal(err)
	}
	return certificate
}

func fixtureIdentity(t *testing.T, name string) security.PeerIdentity {
	t.Helper()
	certificate := fixtureCertificate(t, name)
	if len(certificate.URIs) != 1 {
		t.Fatalf("fixture %s must contain one identity URI", name)
	}
	parts := splitIdentityPath(certificate.URIs[0].Path)
	identity := security.PeerIdentity{
		PeerID:                parts[1],
		NodeID:                parts[3],
		TrustDomain:           certificate.URIs[0].Hostname(),
		CredentialFingerprint: security.CertificateFingerprint(certificate),
		Capabilities:          []string{testOperation},
		IssuedAt:              certificate.NotBefore.Unix(),
		ExpiresAt:             certificate.NotAfter.Unix(),
	}
	if len(parts) == 6 {
		identity.WorkerID = parts[5]
	}
	return identity
}

func splitIdentityPath(path string) []string {
	return strings.FieldsFunc(path, func(character rune) bool { return character == '/' })
}

func secureTransportConfig(t *testing.T, ownCertificate string, acceptedPeers ...string) Config {
	t.Helper()
	grants := make(map[string][]string, len(acceptedPeers))
	for _, peer := range acceptedPeers {
		grants[security.CertificateFingerprint(fixtureCertificate(t, peer))] = []string{testOperation}
	}
	identityPolicy := security.NewCertificateIdentityPolicy(testTrustDomain, grants)
	identityPolicy.AllowedIssuerNames[testIssuer] = true
	config := DefaultConfig()
	config.ConnectTimeout = time.Second
	config.IOTimeout = time.Second
	config.ServerName = "localhost"
	config.SecurityConfig = &security.SecurityConfig{
		Profile:             security.SecurityProfileStandard,
		RequireMTLS:         true,
		TrustDomain:         testTrustDomain,
		CACertPath:          tlsFixture("ca_cert.pem"),
		ReplayWindowSeconds: 30,
		MaxClockSkewSeconds: 3,
	}
	if ownCertificate != "" {
		config.SecurityConfig.CertPath = tlsFixture(ownCertificate + "_cert.pem")
		config.SecurityConfig.KeyPath = tlsFixture(ownCertificate + "_key.pem")
	}
	config.IdentityPolicy = identityPolicy
	config.CapabilityPolicy = security.NewCapabilityPolicy([]string{testOperation}, nil)
	config.ReplayProtection = security.NewReplayProtection(30, 3, 1000)
	return config
}

func identityWire(t *testing.T, identity security.PeerIdentity) map[string]any {
	t.Helper()
	data, err := json.Marshal(identity)
	if err != nil {
		t.Fatal(err)
	}
	var wire map[string]any
	if err := json.Unmarshal(data, &wire); err != nil {
		t.Fatal(err)
	}
	return wire
}

func secureEnvelope(t *testing.T, identity security.PeerIdentity, session string, sequence uint64, nonce, operation string, createdAt time.Time) contract.MessageEnvelope {
	t.Helper()
	return contract.MessageEnvelope{
		ProtocolVersion: contract.ProtocolVersion,
		MessageID:       session + "-message",
		SessionID:       session,
		Channel:         "secure",
		Kind:            "data",
		Source:          identity.PeerID,
		Sequence:        sequence,
		CreatedAt:       createdAt.UTC().Format(time.RFC3339Nano),
		Attempt:         1,
		PayloadType:     "json",
		Payload:         map[string]any{"ok": true},
		Metadata: map[string]any{
			"peer_identity":  identityWire(t, identity),
			"security_nonce": nonce,
			"operation":      operation,
		},
	}
}

func acceptOne(listener interface{ Accept() (net.Conn, error) }, config Config, result chan<- error, handler func(*LengthDelimited) error) {
	connection, err := listener.Accept()
	if err != nil {
		result <- err
		return
	}
	transport, err := NewLengthDelimited(connection, config)
	if err == nil {
		err = handler(transport)
	}
	if transport != nil {
		_ = transport.Close()
	} else {
		_ = connection.Close()
	}
	result <- err
}

func securityCode(err error) string {
	var structured *security.SecurityError
	if errors.As(err, &structured) {
		return structured.Code
	}
	return ""
}

func TestGoTLS13MTLSRoundTripAndCertificateIdentity(t *testing.T) {
	serverConfig := secureTransportConfig(t, "server", "client")
	clientConfig := secureTransportConfig(t, "client", "server")
	listener, err := ListenTCP("127.0.0.1:0", serverConfig)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = listener.Close() })
	result := make(chan error, 1)
	clientIdentity := fixtureIdentity(t, "client")
	serverIdentity := fixtureIdentity(t, "server")
	go acceptOne(listener, serverConfig, result, func(server *LengthDelimited) error {
		if server.AuthenticatedPeer.PeerID != clientIdentity.PeerID || server.AuthenticatedPeer.WorkerID != clientIdentity.WorkerID {
			t.Errorf("server authenticated wrong client identity: %#v", server.AuthenticatedPeer)
		}
		state, ok := server.TLSState()
		if !ok || state.Version != tls.VersionTLS13 || state.ServerName != "localhost" {
			t.Errorf("server TLS state is not verified TLS 1.3 with SNI: %#v", state)
		}
		envelope, receiveErr := server.Receive(context.Background())
		if receiveErr != nil {
			return receiveErr
		}
		return server.Send(context.Background(), secureEnvelope(t, serverIdentity, envelope.SessionID, 1, "server-response", testOperation, time.Now()))
	})

	client, err := DialTCP(context.Background(), listener.Addr().String(), clientConfig)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	if client.AuthenticatedPeer.PeerID != serverIdentity.PeerID {
		t.Fatalf("client authenticated wrong server: %#v", client.AuthenticatedPeer)
	}
	state, ok := client.TLSState()
	if !ok || state.Version != tls.VersionTLS13 || state.ServerName != "localhost" {
		t.Fatalf("client TLS state is not verified TLS 1.3: %#v", state)
	}
	if err := client.Send(context.Background(), secureEnvelope(t, clientIdentity, "roundtrip", 1, "client-request", testOperation, time.Now())); err != nil {
		t.Fatal(err)
	}
	response, err := client.Receive(context.Background())
	if err != nil || response.Source != serverIdentity.PeerID {
		t.Fatalf("secure roundtrip failed: %v", err)
	}
	if err := <-result; err != nil {
		t.Fatal(err)
	}
}

func TestGoTLSRejectsInvalidServerCertificates(t *testing.T) {
	cases := []struct {
		name          string
		certificate   string
		ca            string
		serverName    string
		expectedCodes []string
	}{
		{"wrong hostname", "wrong_host_server", "ca_cert.pem", "localhost", []string{"hostname_mismatch"}},
		{"expired", "expired_server", "ca_cert.pem", "localhost", []string{"credential_expired"}},
		{"unknown CA", "server", "rogue_ca_cert.pem", "localhost", []string{"unknown_ca"}},
		{"rogue issuer", "rogue_server", "ca_cert.pem", "localhost", []string{"unknown_ca"}},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			serverConfig := secureTransportConfig(t, testCase.certificate, "client")
			clientConfig := secureTransportConfig(t, "client", testCase.certificate)
			clientConfig.SecurityConfig.CACertPath = tlsFixture(testCase.ca)
			clientConfig.ServerName = testCase.serverName
			listener, err := ListenTCP("127.0.0.1:0", serverConfig)
			if err != nil {
				t.Fatal(err)
			}
			defer listener.Close()
			serverResult := make(chan error, 1)
			go acceptOne(listener, serverConfig, serverResult, func(*LengthDelimited) error { return nil })
			_, err = DialTCP(context.Background(), listener.Addr().String(), clientConfig)
			if err == nil {
				t.Fatal("invalid server certificate was accepted")
			}
			matched := false
			for _, code := range testCase.expectedCodes {
				matched = matched || securityCode(err) == code
			}
			if !matched {
				t.Fatalf("unexpected structured error %q: %v", securityCode(err), err)
			}
			select {
			case <-serverResult:
			case <-time.After(time.Second):
				t.Fatal("server handshake did not terminate")
			}
		})
	}
}

func TestGoMTLSRejectsClientWithoutCertificate(t *testing.T) {
	serverConfig := secureTransportConfig(t, "server", "client")
	clientConfig := secureTransportConfig(t, "", "server")
	clientConfig.SecurityConfig.RequireMTLS = false
	listener, err := ListenTCP("127.0.0.1:0", serverConfig)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	serverResult := make(chan error, 1)
	go acceptOne(listener, serverConfig, serverResult, func(*LengthDelimited) error {
		return errors.New("unauthenticated client reached dispatch")
	})
	client, clientErr := DialTCP(context.Background(), listener.Addr().String(), clientConfig)
	if client != nil {
		_ = client.Close()
	}
	serverErr := <-serverResult
	if clientErr == nil && serverErr == nil {
		t.Fatal("mTLS accepted a client without a certificate")
	}
	if securityCode(serverErr) != "tls_handshake_failed" {
		t.Fatalf("server returned non-structured mTLS error: %v", serverErr)
	}
}

func TestGoSecureReceiveRejectsDeclaredIdentitySpoofing(t *testing.T) {
	clientIdentity := fixtureIdentity(t, "client")
	cases := map[string]any{
		"peer_id":                "spoofed-peer",
		"node_id":                "spoofed-node",
		"worker_id":              "spoofed-worker",
		"trust_domain":           "evil.invalid",
		"credential_fingerprint": "sha256:00",
		"capabilities":           []string{"*"},
	}
	for field, value := range cases {
		t.Run(field, func(t *testing.T) {
			serverConfig := secureTransportConfig(t, "server", "client")
			listener, err := ListenTCP("127.0.0.1:0", serverConfig)
			if err != nil {
				t.Fatal(err)
			}
			defer listener.Close()
			result := make(chan error, 1)
			go acceptOne(listener, serverConfig, result, func(server *LengthDelimited) error {
				_, receiveErr := server.Receive(context.Background())
				return receiveErr
			})
			client, err := DialTCP(context.Background(), listener.Addr().String(), secureTransportConfig(t, "client", "server"))
			if err != nil {
				t.Fatal(err)
			}
			envelope := secureEnvelope(t, clientIdentity, "spoof-"+field, 1, "nonce-"+field, testOperation, time.Now())
			envelope.Metadata["peer_identity"].(map[string]any)[field] = value
			if err := client.Send(context.Background(), envelope); err != nil {
				t.Fatal(err)
			}
			_ = client.Close()
			if code := securityCode(<-result); code != "declared_identity_mismatch" {
				t.Fatalf("spoofed %s returned code %q", field, code)
			}
		})
	}
}

func TestGoSecureReceiveIntegratesReplayAndAuthorizationAcrossReconnects(t *testing.T) {
	serverConfig := secureTransportConfig(t, "server", "client", "revoked_client")
	serverConfig.ReplayProtection = security.NewReplayProtection(30, 3, 1000)
	listener, err := ListenTCP("127.0.0.1:0", serverConfig)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	result := make(chan error, 16)
	go func() {
		for {
			connection, acceptErr := listener.Accept()
			if acceptErr != nil {
				return
			}
			server, wrapErr := NewLengthDelimited(connection, serverConfig)
			if wrapErr == nil {
				_, wrapErr = server.Receive(context.Background())
				_ = server.Close()
			} else {
				_ = connection.Close()
			}
			result <- wrapErr
		}
	}()
	clientIdentity := fixtureIdentity(t, "client")
	secondIdentity := fixtureIdentity(t, "revoked_client")
	submit := func(envelope contract.MessageEnvelope, certificate string) error {
		client, dialErr := DialTCP(context.Background(), listener.Addr().String(), secureTransportConfig(t, certificate, "server"))
		if dialErr != nil {
			return dialErr
		}
		if sendErr := client.Send(context.Background(), envelope); sendErr != nil {
			_ = client.Close()
			return sendErr
		}
		_ = client.Close()
		return <-result
	}
	now := time.Now()
	first := secureEnvelope(t, clientIdentity, "replay", 1, "same", testOperation, now)
	if err := submit(first, "client"); err != nil {
		t.Fatal(err)
	}
	if code := securityCode(submit(first, "client")); code != "replay_sequence" {
		t.Fatalf("same sequence returned %q", code)
	}
	if code := securityCode(submit(secureEnvelope(t, clientIdentity, "replay", 2, "same", testOperation, now), "client")); code != "replay_nonce" {
		t.Fatalf("same nonce returned %q", code)
	}
	if err := submit(secureEnvelope(t, clientIdentity, "other-session", 1, "same", testOperation, now), "client"); err != nil {
		t.Fatalf("different session rejected: %v", err)
	}
	if err := submit(secureEnvelope(t, secondIdentity, "replay", 1, "same", testOperation, now), "revoked_client"); err != nil {
		t.Fatalf("different peer rejected: %v", err)
	}
	if code := securityCode(submit(secureEnvelope(t, clientIdentity, "stale", 1, "stale", testOperation, now.Add(-time.Minute)), "client")); code != "replay_timestamp_stale" {
		t.Fatalf("stale timestamp returned %q", code)
	}
	if code := securityCode(submit(secureEnvelope(t, clientIdentity, "future", 1, "future", testOperation, now.Add(10*time.Second)), "client")); code != "replay_timestamp_future" {
		t.Fatalf("future timestamp returned %q", code)
	}
	if err := submit(secureEnvelope(t, clientIdentity, "skew", 1, "skew", testOperation, now.Add(time.Second)), "client"); err != nil {
		t.Fatalf("allowed clock skew rejected: %v", err)
	}
	if code := securityCode(submit(secureEnvelope(t, clientIdentity, "authz", 1, "authz", "job:admin", now), "client")); code != "authorization_denied" {
		t.Fatalf("unauthorized operation returned %q", code)
	}

	// Secure replay state is deliberately process-local. A newly constructed
	// state (the current restart model) accepts the same authenticated scope.
	restarted := security.NewReplayProtection(30, 3, 1000)
	scope := clientIdentity.CredentialFingerprint + "|" + first.SessionID
	if err := restarted.CheckAndRecord(scope, first.Sequence, "same", now.Unix()); err != nil {
		t.Fatalf("fresh replay state rejected message after modeled restart: %v", err)
	}
}

func TestGoLocalRevocationRejectsBeforeDispatch(t *testing.T) {
	serverConfig := secureTransportConfig(t, "server", "revoked_client")
	fingerprint := security.CertificateFingerprint(fixtureCertificate(t, "revoked_client"))
	serverConfig.IdentityPolicy.RevokedFingerprints[fingerprint] = true
	listener, err := ListenTCP("127.0.0.1:0", serverConfig)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	serverResult := make(chan error, 1)
	dispatched := make(chan struct{}, 1)
	go acceptOne(listener, serverConfig, serverResult, func(*LengthDelimited) error {
		dispatched <- struct{}{}
		return nil
	})
	client, err := DialTCP(context.Background(), listener.Addr().String(), secureTransportConfig(t, "revoked_client", "server"))
	if err == nil {
		_ = client.Close()
	}
	if code := securityCode(<-serverResult); code != "credential_revoked" {
		t.Fatalf("revoked credential returned %q", code)
	}
	select {
	case <-dispatched:
		t.Fatal("revoked peer reached dispatch")
	default:
	}
}
