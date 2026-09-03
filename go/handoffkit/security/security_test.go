package security_test

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/DaosPath/handoffkit/go/internal/testsupport"
	"github.com/DaosPath/handoffkit/go/security"
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
	if err := cfgInsecure.ValidateListenAddress("192.168.1.1"); err == nil {
		t.Fatal("allow_insecure_loopback must not permit a non-loopback bind")
	}
}

func TestBuildTLSConfigRejectsUnavailableOCSPPaths(t *testing.T) {
	for name, mutate := range map[string]func(*security.SecurityConfig){
		"fetch":     func(config *security.SecurityConfig) { config.OCSPFetch = true },
		"responder": func(config *security.SecurityConfig) { config.OCSPResponderURL = "https://ocsp.invalid" },
		"response":  func(config *security.SecurityConfig) { config.OCSPResponsePath = "response.der" },
		"required":  func(config *security.SecurityConfig) { config.RequireOCSP = true },
	} {
		t.Run(name, func(t *testing.T) {
			config := security.NewDefaultSecurityConfig()
			mutate(config)
			_, err := security.BuildTLSConfig(config, false, "localhost")
			var structured *security.SecurityError
			if !errors.As(err, &structured) || structured.Code != "ocsp_fetch_unavailable" {
				t.Fatalf("OCSP path did not fail closed: %#v", err)
			}
		})
	}
}

func TestBuildTLSConfigLoadsTrustAnchorsAndServerName(t *testing.T) {
	fixture := func(name string) string {
		return filepath.Join(tlsFixtureRoot, name)
	}
	config := &security.SecurityConfig{
		Profile:     security.SecurityProfileStandard,
		RequireMTLS: true,
		TrustDomain: "handoffkit.internal",
		CACertPath:  fixture("ca_cert.pem"),
		CertPath:    fixture("client_cert.pem"),
		KeyPath:     fixture("client_key.pem"),
	}
	client, err := security.BuildTLSConfig(config, false, "localhost")
	if err != nil {
		t.Fatal(err)
	}
	if client.MinVersion != tls.VersionTLS13 || client.MaxVersion != tls.VersionTLS13 {
		t.Fatal("client config is not pinned to TLS 1.3")
	}
	if client.RootCAs == nil || client.ClientCAs == nil || client.ServerName != "localhost" {
		t.Fatal("client trust pools or server name were not configured")
	}
	if len(client.Certificates) != 1 {
		t.Fatal("client certificate was not loaded")
	}

	config.CertPath = fixture("server_cert.pem")
	config.KeyPath = fixture("server_key.pem")
	server, err := security.BuildTLSConfig(config, true)
	if err != nil {
		t.Fatal(err)
	}
	if server.ClientAuth != tls.RequireAndVerifyClientCert || server.ClientCAs == nil {
		t.Fatal("server did not require and verify client certificates")
	}
}

func TestHybridPQCapabilityIsProviderDetectedAndFailsClosed(t *testing.T) {
	capabilities := security.GetSupportedCryptoCapabilities()
	algorithms := capabilities["signature_algorithms"].([]string)
	if len(algorithms) != 1 || algorithms[0] != "ed25519" {
		t.Fatalf("unexpected implemented signature algorithms: %#v", algorithms)
	}
	digests := capabilities["digest_algorithms"].([]string)
	if len(digests) != 1 || digests[0] != "sha256" {
		t.Fatalf("unexpected implemented digest algorithms: %#v", digests)
	}
	if capabilities["hybrid_pq_supported"] != security.DetectHybridPQSupport() {
		t.Fatal("reported hybrid-pq capability differs from provider detection")
	}
	config := &security.SecurityConfig{Profile: security.SecurityProfileHybridPQ}
	tlsConfig, err := security.BuildTLSConfig(config, false, "localhost")
	if !security.DetectHybridPQSupport() {
		var structured *security.SecurityError
		if !errors.As(err, &structured) || structured.Code != "security_profile_unavailable" {
			t.Fatalf("unavailable provider did not fail closed: %v", err)
		}
		return
	}
	if err != nil {
		t.Fatal(err)
	}
	if len(tlsConfig.CurvePreferences) != 1 || tlsConfig.CurvePreferences[0] != security.HybridPQGroup {
		t.Fatal("hybrid profile did not restrict the provider to X25519MLKEM768")
	}
}

func TestEd25519ArtifactSignaturesMatchSharedVectorAndPolicy(t *testing.T) {
	fixture := func(name string) string {
		return filepath.Join("..", "..", "..", "shared", "contracts", "test-fixtures", "artifact-signing", name)
	}
	vectorData, err := os.ReadFile(fixture("vector.json"))
	if err != nil {
		t.Fatal(err)
	}
	var vector struct {
		DataBase64       string                  `json:"data_base64"`
		PublicKeyPEM     string                  `json:"public_key_pem"`
		CanonicalPayload string                  `json:"canonical_payload"`
		SignedArtifact   security.SignedArtifact `json:"signed_artifact"`
	}
	if err := json.Unmarshal(vectorData, &vector); err != nil {
		t.Fatal(err)
	}
	data, err := base64.StdEncoding.DecodeString(vector.DataBase64)
	if err != nil {
		t.Fatal(err)
	}
	publicKey, err := security.LoadArtifactPublicKeyPEM([]byte(vector.PublicKeyPEM))
	if err != nil {
		t.Fatal(err)
	}
	credential := security.ArtifactSigningCredential{
		SignerIdentity: vector.SignedArtifact.SignerIdentity,
		PublicKey:      publicKey, ValidFrom: 1_799_999_900, ValidUntil: 1_800_000_100,
	}
	policy := security.NewArtifactTrustPolicy([]security.ArtifactSigningCredential{credential})
	if err := security.VerifySignedArtifact(data, vector.SignedArtifact, policy, 1_800_000_000); err != nil {
		t.Fatal(err)
	}
	payload, err := vector.SignedArtifact.CanonicalPayload()
	if err != nil {
		t.Fatal(err)
	}
	if string(payload) != vector.CanonicalPayload {
		t.Fatalf("canonical payload drifted: %s", payload)
	}
	producerPublic, producerPrivate, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	privateDER, err := x509.MarshalPKCS8PrivateKey(producerPrivate)
	if err != nil {
		t.Fatal(err)
	}
	privatePEM := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: privateDER})
	signer, err := security.NewArtifactSignerFromPEM(privatePEM, vector.SignedArtifact.SignerIdentity)
	if err != nil {
		t.Fatal(err)
	}
	signed, err := signer.SignArtifact("artifact-ephemeral", data, 1_800_000_000)
	if err != nil {
		t.Fatal(err)
	}
	if signed.KeyFingerprint != security.ArtifactPublicKeyFingerprint(producerPublic) {
		t.Fatal("ephemeral signer fingerprint does not match its public key")
	}
	credential = security.ArtifactSigningCredential{
		SignerIdentity: signed.SignerIdentity,
		PublicKey:      producerPublic, ValidFrom: 1_799_999_900, ValidUntil: 1_800_000_100,
	}
	policy = security.NewArtifactTrustPolicy([]security.ArtifactSigningCredential{credential})
	if err := security.VerifySignedArtifact(data, signed, policy, 1_800_000_000); err != nil {
		t.Fatal(err)
	}

	assertCode := func(name, expected string, artifact security.SignedArtifact, candidateData []byte, candidatePolicy *security.ArtifactTrustPolicy) {
		t.Helper()
		err := security.VerifySignedArtifact(candidateData, artifact, candidatePolicy, 1_800_000_000)
		var structured *security.SecurityError
		if !errors.As(err, &structured) || structured.Code != expected {
			t.Fatalf("%s returned %#v", name, err)
		}
	}
	assertCode("tamper", "artifact_integrity_mismatch", signed, []byte("tampered"), policy)
	invalidSignature := signed
	invalidSignature.Signature = "AAAA"
	assertCode("signature", "artifact_signature_invalid", invalidSignature, data, policy)
	wrongIdentity := signed
	wrongIdentity.SignerIdentity = "spiffe://evil.invalid/producer"
	assertCode("identity", "artifact_signer_mismatch", wrongIdentity, data, policy)

	wrongPublicKey, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	assertCode("untrusted", "artifact_signer_untrusted", signed, data, security.NewArtifactTrustPolicy([]security.ArtifactSigningCredential{{SignerIdentity: credential.SignerIdentity, PublicKey: wrongPublicKey}}))
	expired := credential
	expired.ValidUntil = 1_799_999_999
	assertCode("expired", "artifact_signer_expired", signed, data, security.NewArtifactTrustPolicy([]security.ArtifactSigningCredential{expired}))
	revoked := credential
	revoked.Revoked = true
	assertCode("revoked", "artifact_signer_revoked", signed, data, security.NewArtifactTrustPolicy([]security.ArtifactSigningCredential{revoked}))
	disallowed := security.NewArtifactTrustPolicy([]security.ArtifactSigningCredential{credential})
	disallowed.AllowedAlgorithms = map[string]bool{}
	assertCode("algorithm", "artifact_algorithm_unsupported", signed, data, disallowed)
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

	if err := rp.CheckAndRecord("s1", 3, "nonce-2", 0); err == nil {
		t.Fatal("expected error for duplicate nonce in one session scope")
	}
	if err := rp.CheckAndRecord("s2", 1, "nonce-1", 0); err != nil {
		t.Fatalf("same nonce in a different session scope must be accepted: %v", err)
	}
}
