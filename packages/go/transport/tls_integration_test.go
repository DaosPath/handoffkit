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
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/DaosPath/handoffkit/go/contract"
	"github.com/DaosPath/handoffkit/go/internal/testsupport"
	"github.com/DaosPath/handoffkit/go/security"
)

const (
	testTrustDomain = "handoffkit.internal"
	testIssuer      = "CN=HandoffKit Test CA"
	testNextIssuer  = "CN=HandoffKit Next Test CA"
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
		transcript, ok := envelope.Metadata["security_transcript"].(map[string]any)
		if !ok || transcript["format"] != "handoffkit.security.transcript" {
			return errors.New("validated security transcript is missing from request")
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
	transcript, ok := response.Metadata["security_transcript"].(map[string]any)
	if !ok || transcript["selected_profile"] != "standard" {
		t.Fatal("validated security transcript is missing from response")
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

	// The explicit in-memory fallback resets when no durable backend is
	// configured; the next test covers the durable listener-restart path.
	restarted := security.NewReplayProtection(30, 3, 1000)
	scope := clientIdentity.CredentialFingerprint + "|" + first.SessionID
	if err := restarted.CheckAndRecord(scope, first.Sequence, "same", now.Unix()); err != nil {
		t.Fatalf("fresh replay state rejected message after modeled restart: %v", err)
	}
}

func TestGoTLSReplayStateSurvivesListenerRestart(t *testing.T) {
	statePath := filepath.Join(t.TempDir(), "replay-state.json")
	options := security.DefaultDurableReplayOptions()
	options.WindowSeconds = 30
	options.MaxClockSkewSeconds = 3
	clientIdentity := fixtureIdentity(t, "client")
	envelope := secureEnvelope(t, clientIdentity, "durable-restart", 1, "durable-nonce", testOperation, time.Now())

	submit := func(expectReplay bool) {
		t.Helper()
		serverConfig := secureTransportConfig(t, "server", "client")
		replay, replayErr := security.NewDurableReplayProtection(statePath, options)
		if replayErr != nil {
			t.Fatal(replayErr)
		}
		serverConfig.ReplayProtection = replay
		listener, listenErr := ListenTCP("127.0.0.1:0", serverConfig)
		if listenErr != nil {
			t.Fatal(listenErr)
		}
		result := make(chan error, 1)
		go acceptOne(listener, serverConfig, result, func(server *LengthDelimited) error {
			_, receiveErr := server.Receive(context.Background())
			return receiveErr
		})
		client, dialErr := DialTCP(context.Background(), listener.Addr().String(), secureTransportConfig(t, "client", "server"))
		if dialErr != nil {
			_ = listener.Close()
			t.Fatal(dialErr)
		}
		if sendErr := client.Send(context.Background(), envelope); sendErr != nil {
			_ = client.Close()
			_ = listener.Close()
			t.Fatal(sendErr)
		}
		_ = client.Close()
		receiveErr := <-result
		_ = listener.Close()
		if expectReplay {
			if code := securityCode(receiveErr); code != "replay_sequence" {
				t.Fatalf("durable replay after listener restart returned %q: %v", code, receiveErr)
			}
		} else if receiveErr != nil {
			t.Fatal(receiveErr)
		}
	}

	submit(false)
	submit(true)
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

func TestGoExistingConnectionRejectsCertificateAfterExpiry(t *testing.T) {
	serverConfig := secureTransportConfig(t, "server", "client")
	var securityClock atomic.Int64
	securityClock.Store(time.Now().Unix())
	serverConfig.now = func() time.Time { return time.Unix(securityClock.Load(), 0) }
	listener, err := ListenTCP("127.0.0.1:0", serverConfig)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	first := make(chan error, 1)
	second := make(chan error, 1)
	go func() {
		connection, acceptErr := listener.Accept()
		if acceptErr != nil {
			first <- acceptErr
			second <- acceptErr
			return
		}
		wire, wireErr := NewLengthDelimited(connection, serverConfig)
		if wireErr != nil {
			_ = connection.Close()
			first <- wireErr
			second <- wireErr
			return
		}
		defer wire.Close()
		_, firstErr := wire.Receive(context.Background())
		first <- firstErr
		if firstErr != nil {
			second <- firstErr
			return
		}
		_, secondErr := wire.Receive(context.Background())
		second <- secondErr
	}()
	clientConfig := secureTransportConfig(t, "client", "server")
	client, err := DialTCP(context.Background(), listener.Addr().String(), clientConfig)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	identity := fixtureIdentity(t, "client")
	if err := client.Send(context.Background(), secureEnvelope(
		t, identity, "live-expiry", 1, "before-expiry", testOperation, time.Now())); err != nil {
		t.Fatal(err)
	}
	if err := <-first; err != nil {
		t.Fatalf("valid certificate failed on existing connection: %v", err)
	}
	securityClock.Store(fixtureCertificate(t, "client").NotAfter.Unix() + 1)
	if err := client.Send(context.Background(), secureEnvelope(
		t, identity, "live-expiry", 2, "after-expiry", testOperation, time.Now())); err != nil {
		t.Fatal(err)
	}
	if err := <-second; securityCode(err) != "credential_expired" {
		t.Fatalf("existing connection did not re-check certificate expiry: %v", err)
	}
}

func TestGoDurableRevocationReloadUpdatesLiveTLSIdentityPolicy(t *testing.T) {
	statePath := filepath.Join(t.TempDir(), "revocations.json")
	livePolicy, err := security.NewDurableRevocationPolicy(statePath, security.DefaultDurableRevocationOptions())
	if err != nil {
		t.Fatal(err)
	}
	writerPolicy, err := security.NewDurableRevocationPolicy(statePath, security.DefaultDurableRevocationOptions())
	if err != nil {
		t.Fatal(err)
	}
	serverConfig := secureTransportConfig(t, "server", "client", "revoked_client")
	serverConfig.IdentityPolicy.RevocationPolicy = livePolicy
	listener, err := ListenTCP("127.0.0.1:0", serverConfig)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()

	submit := func(certificate string) (error, bool) {
		t.Helper()
		result := make(chan error, 1)
		dispatched := make(chan struct{}, 1)
		go acceptOne(listener, serverConfig, result, func(*LengthDelimited) error {
			dispatched <- struct{}{}
			return nil
		})
		client, dialErr := DialTCP(context.Background(), listener.Addr().String(), secureTransportConfig(t, certificate, "server"))
		if client != nil {
			_ = client.Close()
		}
		serverErr := <-result
		select {
		case <-dispatched:
			return errors.Join(dialErr, serverErr), true
		default:
			return errors.Join(dialErr, serverErr), false
		}
	}

	if submitErr, dispatched := submit("revoked_client"); submitErr != nil || !dispatched {
		t.Fatalf("initial credential rejected: %v", submitErr)
	}
	liveFirst := make(chan error, 1)
	liveSecond := make(chan error, 1)
	go func() {
		connection, acceptErr := listener.Accept()
		if acceptErr != nil {
			liveFirst <- acceptErr
			liveSecond <- acceptErr
			return
		}
		wire, wireErr := NewLengthDelimited(connection, serverConfig)
		if wireErr != nil {
			_ = connection.Close()
			liveFirst <- wireErr
			liveSecond <- wireErr
			return
		}
		defer wire.Close()
		_, firstErr := wire.Receive(context.Background())
		liveFirst <- firstErr
		if firstErr != nil {
			liveSecond <- firstErr
			return
		}
		_, secondErr := wire.Receive(context.Background())
		liveSecond <- secondErr
	}()
	liveIdentity := fixtureIdentity(t, "revoked_client")
	liveClient, err := DialTCP(
		context.Background(), listener.Addr().String(), secureTransportConfig(t, "revoked_client", "server"))
	if err != nil {
		t.Fatal(err)
	}
	if err := liveClient.Send(context.Background(), secureEnvelope(
		t, liveIdentity, "live-revocation", 1, "live-before-revocation", testOperation, time.Now())); err != nil {
		t.Fatal(err)
	}
	if err := <-liveFirst; err != nil {
		t.Fatalf("live credential failed before revocation: %v", err)
	}
	fingerprint := security.CertificateFingerprint(fixtureCertificate(t, "revoked_client"))
	entry, err := security.NewRevocationEntry(
		security.RevocationCertificateFingerprint,
		fingerprint,
		"test compromise",
		time.Now().Unix(),
		0,
		0,
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := writerPolicy.Revoke(entry); err != nil {
		t.Fatal(err)
	}
	if revoked, _ := livePolicy.IsRevoked(security.RevocationCertificateFingerprint, fingerprint, 0); revoked {
		t.Fatal("live policy changed without reload")
	}
	if err := livePolicy.Reload(); err != nil {
		t.Fatal(err)
	}
	if err := liveClient.Send(context.Background(), secureEnvelope(
		t, liveIdentity, "live-revocation", 2, "live-after-revocation", testOperation, time.Now())); err != nil {
		t.Fatal(err)
	}
	if liveErr := <-liveSecond; securityCode(liveErr) != "credential_revoked" {
		t.Fatalf("existing connection did not re-check durable revocation: %v", liveErr)
	}
	_ = liveClient.Close()
	if submitErr, dispatched := submit("revoked_client"); securityCode(submitErr) != "credential_revoked" || dispatched {
		t.Fatalf("revoked credential result: %v, dispatched=%v", submitErr, dispatched)
	}
	if submitErr, dispatched := submit("client"); submitErr != nil || !dispatched {
		t.Fatalf("renewed credential rejected: %v", submitErr)
	}
	restored, err := security.NewDurableRevocationPolicy(statePath, security.DefaultDurableRevocationOptions())
	if err != nil {
		t.Fatal(err)
	}
	if revoked, err := restored.IsRevoked(security.RevocationCertificateFingerprint, fingerprint, 0); err != nil || !revoked {
		t.Fatalf("revocation did not survive restart: %v, %v", revoked, err)
	}
}

func TestGoTLSCredentialsReloadAtomicallyOnLiveListener(t *testing.T) {
	now := time.Now().Unix()
	oldClient := fixtureIdentity(t, "client")
	newClient := fixtureIdentity(t, "client_rotated")
	oldServer := fixtureIdentity(t, "server")
	newServer := fixtureIdentity(t, "server_rotated")
	clientRotation, err := security.NewCredentialRotationPolicy(oldClient.CredentialFingerprint, 0)
	if err != nil {
		t.Fatal(err)
	}
	serverRotation, err := security.NewCredentialRotationPolicy(oldServer.CredentialFingerprint, 0)
	if err != nil {
		t.Fatal(err)
	}
	serverConfig := secureTransportConfig(t, "server", "client", "client_rotated")
	serverConfig.IdentityPolicy.RotationPolicy = clientRotation
	clientConfig := secureTransportConfig(t, "client", "server", "server_rotated")
	clientConfig.IdentityPolicy.RotationPolicy = serverRotation
	serverProvider, err := security.NewReloadableTLSConfig(serverConfig.SecurityConfig, true)
	if err != nil {
		t.Fatal(err)
	}
	clientProvider, err := security.NewReloadableTLSConfig(clientConfig.SecurityConfig, false, "localhost")
	if err != nil {
		t.Fatal(err)
	}
	serverConfig.TLSProvider = serverProvider
	clientConfig.TLSProvider = clientProvider
	listener, err := ListenTCP("127.0.0.1:0", serverConfig)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()

	type acceptedResult struct {
		fingerprint string
		err         error
	}
	acceptMessage := func() <-chan acceptedResult {
		result := make(chan acceptedResult, 1)
		go func() {
			connection, acceptErr := listener.Accept()
			if acceptErr != nil {
				result <- acceptedResult{err: acceptErr}
				return
			}
			transport, transportErr := NewLengthDelimited(connection, serverConfig)
			if transportErr != nil {
				_ = connection.Close()
				result <- acceptedResult{err: transportErr}
				return
			}
			_, receiveErr := transport.Receive(context.Background())
			fingerprint := transport.AuthenticatedPeer.CredentialFingerprint
			_ = transport.Close()
			result <- acceptedResult{fingerprint: fingerprint, err: receiveErr}
		}()
		return result
	}

	existingResult := acceptMessage()
	existing, err := DialTCP(context.Background(), listener.Addr().String(), clientConfig)
	if err != nil {
		t.Fatal(err)
	}
	nextServerSecurity := *serverConfig.SecurityConfig
	nextServerSecurity.CertPath = tlsFixture("server_rotated_cert.pem")
	nextServerSecurity.KeyPath = tlsFixture("server_rotated_key.pem")
	beforeFailedReload := serverProvider.Status(now)
	mismatched := nextServerSecurity
	mismatched.KeyPath = tlsFixture("server_key.pem")
	if _, err := serverProvider.Reload(&mismatched, time.Minute, now); err == nil {
		t.Fatal("mismatched certificate/key reload succeeded")
	}
	if after := serverProvider.Status(now); !reflect.DeepEqual(after, beforeFailedReload) {
		t.Fatalf("failed reload changed provider state: %#v", after)
	}
	if _, err := serverProvider.Reload(&nextServerSecurity, time.Minute, now); err != nil {
		t.Fatal(err)
	}
	nextClientSecurity := *clientConfig.SecurityConfig
	nextClientSecurity.CertPath = tlsFixture("client_rotated_cert.pem")
	nextClientSecurity.KeyPath = tlsFixture("client_rotated_key.pem")
	if _, err := clientProvider.Reload(&nextClientSecurity, time.Minute, now); err != nil {
		t.Fatal(err)
	}
	if err := clientRotation.Rotate(newClient.CredentialFingerprint, now+60); err != nil {
		t.Fatal(err)
	}
	if err := serverRotation.Rotate(newServer.CredentialFingerprint, now+60); err != nil {
		t.Fatal(err)
	}
	if err := existing.Send(context.Background(), secureEnvelope(t, oldClient, "existing-after-reload", 1, "existing", testOperation, time.Now())); err != nil {
		t.Fatal(err)
	}
	if result := <-existingResult; result.err != nil || result.fingerprint != oldClient.CredentialFingerprint {
		t.Fatalf("existing session failed after reload: fingerprint=%s error=%v code=%s", result.fingerprint, result.err, securityCode(result.err))
	}
	_ = existing.Close()

	rotatedResult := acceptMessage()
	rotated, err := DialTCP(context.Background(), listener.Addr().String(), clientConfig)
	if err != nil {
		t.Fatal(err)
	}
	if err := rotated.Send(context.Background(), secureEnvelope(t, newClient, "rotated-new", 1, "rotated", testOperation, time.Now())); err != nil {
		t.Fatal(err)
	}
	if result := <-rotatedResult; result.err != nil || result.fingerprint != newClient.CredentialFingerprint {
		t.Fatalf("rotated credential failed: %#v", result)
	}
	_ = rotated.Close()

	oldTransitionConfig := secureTransportConfig(t, "client", "server_rotated")
	oldTransitionResult := acceptMessage()
	oldTransition, err := DialTCP(context.Background(), listener.Addr().String(), oldTransitionConfig)
	if err != nil {
		t.Fatal(err)
	}
	if err := oldTransition.Send(context.Background(), secureEnvelope(t, oldClient, "old-transition", 1, "old-transition", testOperation, time.Now())); err != nil {
		t.Fatal(err)
	}
	if result := <-oldTransitionResult; result.err != nil || result.fingerprint != oldClient.CredentialFingerprint {
		t.Fatalf("previous credential rejected during transition: %#v", result)
	}
	_ = oldTransition.Close()

	existingTransitionFirst := make(chan error, 1)
	existingTransitionSecond := make(chan error, 1)
	go func() {
		connection, acceptErr := listener.Accept()
		if acceptErr != nil {
			existingTransitionFirst <- acceptErr
			existingTransitionSecond <- acceptErr
			return
		}
		wire, wireErr := NewLengthDelimited(connection, serverConfig)
		if wireErr != nil {
			_ = connection.Close()
			existingTransitionFirst <- wireErr
			existingTransitionSecond <- wireErr
			return
		}
		defer wire.Close()
		_, firstErr := wire.Receive(context.Background())
		existingTransitionFirst <- firstErr
		if firstErr != nil {
			existingTransitionSecond <- firstErr
			return
		}
		_, secondErr := wire.Receive(context.Background())
		existingTransitionSecond <- secondErr
	}()
	existingTransition, err := DialTCP(context.Background(), listener.Addr().String(), oldTransitionConfig)
	if err != nil {
		t.Fatal(err)
	}
	if err := existingTransition.Send(context.Background(), secureEnvelope(
		t, oldClient, "existing-transition", 1, "existing-transition-before", testOperation, time.Now())); err != nil {
		t.Fatal(err)
	}
	if err := <-existingTransitionFirst; err != nil {
		t.Fatalf("existing previous credential failed during transition: %v", err)
	}

	if err := clientRotation.SetTransitionUntil(now - 1); err != nil {
		t.Fatal(err)
	}
	if err := existingTransition.Send(context.Background(), secureEnvelope(
		t, oldClient, "existing-transition", 2, "existing-transition-after", testOperation, time.Now())); err != nil {
		t.Fatal(err)
	}
	if existingErr := <-existingTransitionSecond; securityCode(existingErr) != "credential_rotation_rejected" {
		t.Fatalf("existing previous credential survived the rotation window: %v", existingErr)
	}
	_ = existingTransition.Close()
	rejectedResult := make(chan error, 1)
	dispatched := make(chan struct{}, 1)
	go acceptOne(listener, serverConfig, rejectedResult, func(*LengthDelimited) error {
		dispatched <- struct{}{}
		return nil
	})
	rejected, dialErr := DialTCP(context.Background(), listener.Addr().String(), oldTransitionConfig)
	if rejected != nil {
		_ = rejected.Close()
	}
	serverErr := <-rejectedResult
	if code := securityCode(errors.Join(dialErr, serverErr)); code != "credential_rotation_rejected" {
		t.Fatalf("expired previous credential returned %q: %v", code, errors.Join(dialErr, serverErr))
	}
	select {
	case <-dispatched:
		t.Fatal("expired previous credential reached dispatch")
	default:
	}

	status := serverProvider.Status(now)
	if status["current_fingerprint"] != newServer.CredentialFingerprint ||
		status["previous_fingerprint"] != oldServer.CredentialFingerprint ||
		status["generation"] != uint64(2) {
		t.Fatalf("unexpected reload status: %#v", status)
	}
	for key := range status {
		if strings.Contains(key, "path") {
			t.Fatalf("reload status leaked a path field: %s", key)
		}
	}
}

func TestGoTLSTrustStoreReloadAcceptsNewCAWithoutListenerRestart(t *testing.T) {
	trustBundle := filepath.Join(t.TempDir(), "ca-transition.pem")
	originalCA, err := os.ReadFile(tlsFixture("ca_cert.pem"))
	if err != nil {
		t.Fatal(err)
	}
	nextCA, err := os.ReadFile(tlsFixture("next_ca_cert.pem"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(trustBundle, append(originalCA, nextCA...), 0o600); err != nil {
		t.Fatal(err)
	}
	serverConfig := secureTransportConfig(t, "server", "client", "next_client")
	serverConfig.IdentityPolicy.AllowedIssuerNames[testNextIssuer] = true
	provider, err := security.NewReloadableTLSConfig(serverConfig.SecurityConfig, true)
	if err != nil {
		t.Fatal(err)
	}
	serverConfig.TLSProvider = provider
	listener, err := ListenTCP("127.0.0.1:0", serverConfig)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	nextClientConfig := secureTransportConfig(t, "next_client", "server")
	nextClientConfig.SecurityConfig.CACertPath = trustBundle

	firstResult := make(chan error, 1)
	firstDispatched := make(chan struct{}, 1)
	go acceptOne(listener, serverConfig, firstResult, func(*LengthDelimited) error {
		firstDispatched <- struct{}{}
		return nil
	})
	firstClient, firstDialErr := DialTCP(context.Background(), listener.Addr().String(), nextClientConfig)
	if firstClient != nil {
		_ = firstClient.Close()
	}
	firstServerErr := <-firstResult
	if errors.Join(firstDialErr, firstServerErr) == nil {
		t.Fatal("client signed by unknown CA was accepted before trust reload")
	}
	select {
	case <-firstDispatched:
		t.Fatal("client signed by unknown CA reached dispatch")
	default:
	}

	before := provider.Status(0)["trust_anchor_hash"]
	nextServerSecurity := *serverConfig.SecurityConfig
	nextServerSecurity.CACertPath = trustBundle
	if _, err := provider.Reload(&nextServerSecurity, time.Minute, 0); err != nil {
		t.Fatal(err)
	}
	if provider.Status(0)["trust_anchor_hash"] == before {
		t.Fatal("trust anchor hash did not change")
	}
	secondResult := make(chan error, 1)
	secondDispatched := make(chan struct{}, 1)
	go acceptOne(listener, serverConfig, secondResult, func(*LengthDelimited) error {
		secondDispatched <- struct{}{}
		return nil
	})
	connected, err := DialTCP(context.Background(), listener.Addr().String(), nextClientConfig)
	if err != nil {
		t.Fatal(err)
	}
	_ = connected.Close()
	if serverErr := <-secondResult; serverErr != nil {
		t.Fatal(serverErr)
	}
	select {
	case <-secondDispatched:
	case <-time.After(2 * time.Second):
		t.Fatal("trusted next-CA client did not reach dispatch")
	}
}
