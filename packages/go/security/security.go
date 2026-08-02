// Package security provides security profiles, TLS 1.3, identity, capability authorization, and replay protection.
package security

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	cryptotls "crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net"
	"os"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"
)

const HybridPQGroup cryptotls.CurveID = 4588 // X25519MLKEM768 when implemented by crypto/tls.

var (
	hybridProbeOnce      sync.Once
	hybridProbeSupported bool
)

type SecurityError struct {
	Code    string         `json:"code"`
	Message string         `json:"message"`
	Details map[string]any `json:"details"`
}

func (e *SecurityError) Error() string { return e.Message }

func securityError(code, message string, details map[string]any) error {
	if details == nil {
		details = map[string]any{}
	}
	return &SecurityError{Code: code, Message: message, Details: details}
}

type SecurityProfile string

const (
	SecurityProfileLocal    SecurityProfile = "local"
	SecurityProfileStandard SecurityProfile = "standard"
	SecurityProfileHybridPQ SecurityProfile = "hybrid-pq"
	SecurityProfileResearch SecurityProfile = "research"
)

func NegotiateSecurityProfile(required, offered SecurityProfile, supported []SecurityProfile) (SecurityProfile, error) {
	recognized := func(profile SecurityProfile) bool {
		return profile == SecurityProfileLocal || profile == SecurityProfileStandard ||
			profile == SecurityProfileHybridPQ || profile == SecurityProfileResearch
	}
	if !recognized(required) || !recognized(offered) {
		return "", securityError("security_profile_unavailable", "a security profile is not recognized by this runtime", map[string]any{"required": required, "offered": offered})
	}
	if required != offered {
		return "", securityError("security_profile_mismatch", "required and offered security profiles do not match", map[string]any{"required": required, "offered": offered})
	}
	for _, profile := range supported {
		if profile == required {
			return required, nil
		}
	}
	return "", securityError("security_profile_unavailable", "the exact security profile has no active provider", map[string]any{"profile": required})
}

type SecurityConfig struct {
	Profile               SecurityProfile `json:"profile"`
	RequireMTLS           bool            `json:"require_mtls"`
	AllowInsecureLoopback bool            `json:"allow_insecure_loopback"`
	TrustDomain           string          `json:"trust_domain"`
	CACertPath            string          `json:"ca_cert_path,omitempty"`
	CertPath              string          `json:"cert_path,omitempty"`
	KeyPath               string          `json:"key_path,omitempty"`
	ReplayWindowSeconds   uint64          `json:"replay_window_seconds"`
	MaxClockSkewSeconds   uint64          `json:"max_clock_skew_seconds"`
}

func NewDefaultSecurityConfig() *SecurityConfig {
	return &SecurityConfig{
		Profile:               SecurityProfileLocal,
		RequireMTLS:           false,
		AllowInsecureLoopback: false,
		TrustDomain:           "handoffkit.internal",
		ReplayWindowSeconds:   300,
		MaxClockSkewSeconds:   10,
	}
}

func (c *SecurityConfig) ValidateListenAddress(host string) error {
	isLoopback := host == "127.0.0.1" || host == "localhost" || host == "::1"
	if (c.Profile == SecurityProfileLocal || c.Profile == SecurityProfileResearch) && !isLoopback {
		return fmt.Errorf("profile '%s' cannot listen on non-loopback interface '%s'", c.Profile, host)
	}
	return nil
}

type PeerIdentity struct {
	PeerID                string   `json:"peer_id"`
	NodeID                string   `json:"node_id"`
	TrustDomain           string   `json:"trust_domain"`
	WorkerID              string   `json:"worker_id,omitempty"`
	CredentialFingerprint string   `json:"credential_fingerprint,omitempty"`
	Capabilities          []string `json:"capabilities"`
	IssuedAt              int64    `json:"issued_at"`
	ExpiresAt             int64    `json:"expires_at"`
}

func (p *PeerIdentity) IsValidAt(timestamp int64) bool {
	ts := timestamp
	if ts == 0 {
		ts = time.Now().Unix()
	}
	if p.ExpiresAt > 0 && ts > p.ExpiresAt {
		return false
	}
	if p.IssuedAt > 0 && ts < (p.IssuedAt-60) {
		return false
	}
	return true
}

type CapabilityPolicy struct {
	AllowedOperations     map[string]bool
	AllowedWorkspaceRoots []string
}

func NewCapabilityPolicy(allowedOps []string, roots []string) *CapabilityPolicy {
	var opMap map[string]bool
	if allowedOps != nil {
		opMap = make(map[string]bool)
		for _, op := range allowedOps {
			opMap[op] = true
		}
	}
	return &CapabilityPolicy{
		AllowedOperations:     opMap,
		AllowedWorkspaceRoots: roots,
	}
}

func (cp *CapabilityPolicy) IsOperationAuthorized(op string, peer *PeerIdentity) bool {
	if cp.AllowedOperations != nil && !cp.AllowedOperations[op] {
		return false
	}
	if peer != nil {
		for _, cap := range peer.Capabilities {
			if cap == "*" || cap == op {
				return true
			}
			parts := strings.SplitN(op, ":", 2)
			if len(parts) > 1 && cap == (parts[0]+":*") {
				return true
			}
		}
		return false
	}
	return peer == nil
}

func (cp *CapabilityPolicy) AuthorizeJob(jobType string, peer *PeerIdentity) error {
	if peer == nil {
		return securityError("authenticated_peer_missing", "job authorization requires an authenticated peer", nil)
	}
	if !peer.IsValidAt(0) {
		return securityError("authentication_failed", fmt.Sprintf("peer identity '%s' has expired or is invalid", peer.PeerID), nil)
	}
	op := "job:" + jobType
	if !cp.IsOperationAuthorized(op, peer) && !cp.IsOperationAuthorized(jobType, peer) {
		return securityError("authorization_denied", fmt.Sprintf("peer '%s' is not authorized to execute job type '%s'", peer.PeerID, jobType), nil)
	}
	return nil
}

type ReplayProtection struct {
	mu                  sync.Mutex
	WindowSeconds       uint64
	MaxClockSkewSeconds uint64
	MaxSeenNonces       int
	seenNonces          map[string]int64
	lastSequences       map[string]uint64
	durable             *durableReplayState
}

func NewReplayProtection(windowSec, skewSec uint64, maxNonces int) *ReplayProtection {
	return &ReplayProtection{
		WindowSeconds:       windowSec,
		MaxClockSkewSeconds: skewSec,
		MaxSeenNonces:       maxNonces,
		seenNonces:          make(map[string]int64),
		lastSequences:       make(map[string]uint64),
	}
}

// CheckAndRecord stores process-local anti-replay state. Callers needing restart
// persistence must restore an equivalent durable snapshot before accepting traffic.
func (rp *ReplayProtection) CheckAndRecord(sessionScope string, sequence uint64, nonce string, createdAtTs int64) error {
	return rp.CheckAndRecordContext(sessionScope, sequence, nonce, createdAtTs, nil)
}

// CheckAndRecordContext persists authenticated scope metadata when durable
// replay is enabled. A durable write must complete before the message can pass.
func (rp *ReplayProtection) CheckAndRecordContext(sessionScope string, sequence uint64, nonce string, createdAtTs int64, context *ReplayContext) error {
	rp.mu.Lock()
	defer rp.mu.Unlock()

	now := time.Now().Unix()
	if createdAtTs != 0 {
		if now > createdAtTs && uint64(now-createdAtTs) > rp.WindowSeconds {
			return securityError("replay_timestamp_stale", fmt.Sprintf("message timestamp is older than replay window (%ds)", rp.WindowSeconds), nil)
		}
		if createdAtTs > now && uint64(createdAtTs-now) > rp.MaxClockSkewSeconds {
			return securityError("replay_timestamp_future", fmt.Sprintf("message timestamp is in the future beyond max clock skew (%ds)", rp.MaxClockSkewSeconds), nil)
		}
	}

	candidateSequences := cloneSequences(rp.lastSequences)
	candidateNonces := cloneNonces(rp.seenNonces)
	cutoff := now - int64(rp.WindowSeconds)
	for key, seenAt := range candidateNonces {
		if seenAt < cutoff {
			delete(candidateNonces, key)
		}
	}

	if lastSeq, ok := candidateSequences[sessionScope]; ok {
		if sequence <= lastSeq {
			return securityError("replay_sequence", fmt.Sprintf("sequence %d is not strictly monotonic for session %s (last: %d)", sequence, sessionScope, lastSeq), nil)
		}
	}

	nonceKey := sessionScope + "\x00" + nonce
	if nonce != "" {
		if _, exists := candidateNonces[nonceKey]; exists {
			return securityError("replay_nonce", "duplicate nonce detected", nil)
		}
		if len(candidateNonces) >= rp.MaxSeenNonces {
			return securityError("replay_state_capacity", "replay nonce capacity is exhausted", map[string]any{"max_seen_nonces": rp.MaxSeenNonces})
		}
	}

	// Build and durably commit candidate state before accepting the message.
	candidateSequences[sessionScope] = sequence
	if nonce != "" {
		candidateNonces[nonceKey] = now
	}
	if rp.durable != nil {
		if err := rp.durable.commitCandidate(sessionScope, sequence, candidateSequences, candidateNonces, context, now); err != nil {
			return err
		}
	}
	rp.lastSequences = candidateSequences
	rp.seenNonces = candidateNonces
	return nil
}

func cloneSequences(source map[string]uint64) map[string]uint64 {
	clone := make(map[string]uint64, len(source))
	for key, value := range source {
		clone[key] = value
	}
	return clone
}

func cloneNonces(source map[string]int64) map[string]int64 {
	clone := make(map[string]int64, len(source))
	for key, value := range source {
		clone[key] = value
	}
	return clone
}

type CertificateIdentityPolicy struct {
	TrustDomain                  string
	CapabilitiesByFingerprint    map[string][]string
	RevokedFingerprints          map[string]bool
	ExpectedPeerID               string
	ExpectedNodeID               string
	ExpectedWorkerID             string
	AllowedIssuerNames           map[string]bool
	RequireAuthorizedFingerprint bool
	RevocationPolicy             *DurableRevocationPolicy
	RotationPolicy               *CredentialRotationPolicy
}

func NewCertificateIdentityPolicy(trustDomain string, grants map[string][]string) *CertificateIdentityPolicy {
	normalized := make(map[string][]string, len(grants))
	for fingerprint, capabilities := range grants {
		normalized[NormalizeFingerprint(fingerprint)] = append([]string(nil), capabilities...)
	}
	return &CertificateIdentityPolicy{
		TrustDomain:                  trustDomain,
		CapabilitiesByFingerprint:    normalized,
		RevokedFingerprints:          map[string]bool{},
		AllowedIssuerNames:           map[string]bool{},
		RequireAuthorizedFingerprint: true,
	}
}

func CertificateFingerprint(certificate *x509.Certificate) string {
	digest := sha256.Sum256(certificate.Raw)
	return "sha256:" + hex.EncodeToString(digest[:])
}

func NormalizeFingerprint(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	value = strings.TrimPrefix(value, "sha256:")
	value = strings.ReplaceAll(value, ":", "")
	return "sha256:" + value
}

func AuthenticateTLSConnection(connection *cryptotls.Conn, policy *CertificateIdentityPolicy) (*PeerIdentity, error) {
	if connection == nil || policy == nil {
		return nil, securityError("tls_required", "secure network transport requires TLS and a certificate identity policy", nil)
	}
	if err := connection.Handshake(); err != nil {
		return nil, classifyTLSHandshakeError(err)
	}
	state := connection.ConnectionState()
	if state.Version != cryptotls.VersionTLS13 {
		return nil, securityError("tls_version_mismatch", "authenticated transport did not negotiate TLS 1.3", map[string]any{"version": state.Version})
	}
	if len(state.PeerCertificates) == 0 || len(state.VerifiedChains) == 0 {
		return nil, securityError("peer_certificate_untrusted", "TLS peer certificate was not verified", nil)
	}
	certificate := state.PeerCertificates[0]
	now := time.Now()
	if now.Before(certificate.NotBefore) || now.After(certificate.NotAfter) {
		return nil, securityError("credential_expired", "TLS peer certificate is outside its validity period", nil)
	}
	issuer := certificate.Issuer.String()
	if len(policy.AllowedIssuerNames) > 0 && !policy.AllowedIssuerNames[issuer] {
		return nil, securityError("issuer_not_allowed", "TLS peer certificate issuer is not allowed by local policy", map[string]any{"issuer": issuer})
	}

	var identityURI string
	for _, candidate := range certificate.URIs {
		if candidate.Scheme == "spiffe" {
			if identityURI != "" {
				return nil, securityError("identity_san_invalid", "TLS peer certificate must contain exactly one HK-CSP identity URI SAN", nil)
			}
			identityURI = candidate.String()
		}
	}
	peerID, nodeID, workerID, trustDomain, err := parseIdentityURI(identityURI)
	if err != nil {
		return nil, err
	}
	if trustDomain != policy.TrustDomain {
		return nil, securityError("trust_domain_mismatch", "TLS peer trust domain does not match local policy", map[string]any{"expected": policy.TrustDomain, "actual": trustDomain})
	}
	mismatches := make([]string, 0, 3)
	for _, expected := range []struct{ name, want, got string }{
		{"peer_id", policy.ExpectedPeerID, peerID},
		{"node_id", policy.ExpectedNodeID, nodeID},
		{"worker_id", policy.ExpectedWorkerID, workerID},
	} {
		if expected.want != "" && expected.want != expected.got {
			mismatches = append(mismatches, expected.name)
		}
	}
	if len(mismatches) > 0 {
		return nil, securityError("certificate_identity_mismatch", "certificate identity does not match local peer expectations", map[string]any{"fields": mismatches})
	}

	fingerprint := CertificateFingerprint(certificate)
	revokedKind := ""
	if policy.RevocationPolicy != nil {
		for _, candidate := range []struct {
			kind  RevocationKind
			value string
		}{
			{RevocationCertificateFingerprint, fingerprint},
			{RevocationPeerID, peerID},
			{RevocationIssuer, issuer},
			{RevocationTrustDomain, trustDomain},
		} {
			revoked, revocationErr := policy.RevocationPolicy.IsRevoked(candidate.kind, candidate.value, now.Unix())
			if revocationErr != nil {
				return nil, securityError("revocation_state_invalid", "revocation policy could not evaluate authenticated peer", nil)
			}
			if revoked {
				revokedKind = string(candidate.kind)
				break
			}
		}
	}
	if policy.RevokedFingerprints[NormalizeFingerprint(fingerprint)] || revokedKind != "" {
		return nil, securityError("credential_revoked", "TLS peer credential is revoked by local policy", map[string]any{"credential_fingerprint": fingerprint})
	}
	if policy.RotationPolicy != nil && !policy.RotationPolicy.IsAllowed(fingerprint, now.Unix()) {
		return nil, securityError("credential_rotation_rejected", "TLS peer credential is outside the configured rotation window", map[string]any{"credential_fingerprint": fingerprint})
	}
	capabilities, ok := policy.CapabilitiesByFingerprint[NormalizeFingerprint(fingerprint)]
	if !ok && policy.RequireAuthorizedFingerprint {
		return nil, securityError("credential_not_authorized", "TLS peer credential is not authorized by local policy", map[string]any{"credential_fingerprint": fingerprint})
	}
	return &PeerIdentity{
		PeerID: peerID, NodeID: nodeID, WorkerID: workerID, TrustDomain: trustDomain,
		CredentialFingerprint: fingerprint,
		Capabilities:          append([]string(nil), capabilities...),
		IssuedAt:              certificate.NotBefore.Unix(), ExpiresAt: certificate.NotAfter.Unix(),
	}, nil
}

func classifyTLSHandshakeError(err error) error {
	var hostnameError x509.HostnameError
	if errors.As(err, &hostnameError) {
		return securityError("hostname_mismatch", "TLS server certificate does not match the requested server name", map[string]any{"cause": err.Error()})
	}
	var unknownAuthority x509.UnknownAuthorityError
	if errors.As(err, &unknownAuthority) {
		return securityError("unknown_ca", "TLS certificate chain has no trusted authority", map[string]any{"cause": err.Error()})
	}
	var certificateInvalid x509.CertificateInvalidError
	if errors.As(err, &certificateInvalid) {
		code := "certificate_invalid"
		if certificateInvalid.Reason == x509.Expired {
			code = "credential_expired"
		}
		return securityError(code, "TLS certificate validation failed", map[string]any{"cause": err.Error()})
	}
	return securityError("tls_handshake_failed", "TLS handshake failed", map[string]any{"cause": err.Error()})
}

func ValidateDeclaredPeerIdentity(authenticated, declared *PeerIdentity) error {
	if authenticated == nil || declared == nil {
		return securityError("declared_identity_missing", "secure envelope requires a declared peer identity", nil)
	}
	actualCaps := append([]string(nil), authenticated.Capabilities...)
	declaredCaps := append([]string(nil), declared.Capabilities...)
	sort.Strings(actualCaps)
	sort.Strings(declaredCaps)
	mismatches := make([]string, 0)
	for _, field := range []struct{ name, actual, declared string }{
		{"peer_id", authenticated.PeerID, declared.PeerID},
		{"node_id", authenticated.NodeID, declared.NodeID},
		{"worker_id", authenticated.WorkerID, declared.WorkerID},
		{"trust_domain", authenticated.TrustDomain, declared.TrustDomain},
		{"credential_fingerprint", authenticated.CredentialFingerprint, NormalizeFingerprint(declared.CredentialFingerprint)},
	} {
		if field.actual != field.declared {
			mismatches = append(mismatches, field.name)
		}
	}
	if strings.Join(actualCaps, "\x00") != strings.Join(declaredCaps, "\x00") {
		mismatches = append(mismatches, "capabilities")
	}
	if len(mismatches) > 0 {
		return securityError("declared_identity_mismatch", "declared peer identity does not match authenticated certificate identity", map[string]any{"fields": mismatches})
	}
	return nil
}

func parseIdentityURI(value string) (string, string, string, string, error) {
	if value == "" {
		return "", "", "", "", securityError("identity_san_invalid", "TLS peer certificate must contain exactly one HK-CSP identity URI SAN", nil)
	}
	// The URI is already parsed by crypto/x509; split only its strict HK-CSP path.
	parts := strings.Split(strings.TrimPrefix(value, "spiffe://"), "/")
	if len(parts) != 5 && len(parts) != 7 {
		return "", "", "", "", securityError("identity_san_invalid", "TLS peer identity URI SAN has an invalid format", nil)
	}
	if parts[1] != "peer" || parts[3] != "node" || (len(parts) == 7 && parts[5] != "worker") || parts[0] == "" || parts[2] == "" || parts[4] == "" {
		return "", "", "", "", securityError("identity_san_invalid", "TLS peer identity URI SAN has an invalid format", nil)
	}
	workerID := ""
	if len(parts) == 7 {
		if parts[6] == "" {
			return "", "", "", "", securityError("identity_san_invalid", "TLS peer identity URI SAN has an invalid format", nil)
		}
		workerID = parts[6]
	}
	return parts[2], parts[4], workerID, strings.ToLower(parts[0]), nil
}

type SignedArtifact struct {
	ArtifactID     string `json:"artifact_id"`
	ContentHash    string `json:"content_hash"`
	Signature      string `json:"signature"`
	Algorithm      string `json:"algorithm"`
	SignerIdentity string `json:"signer_identity"`
	KeyFingerprint string `json:"key_fingerprint"`
	CreatedAt      int64  `json:"created_at"`
}

func (artifact SignedArtifact) Validate() error {
	if artifact.ArtifactID == "" || artifact.SignerIdentity == "" {
		return errors.New("artifact_id and signer_identity must not be empty")
	}
	if artifact.Algorithm != "ed25519" {
		return securityError("artifact_algorithm_unsupported", "unsupported artifact signature algorithm", map[string]any{"algorithm": artifact.Algorithm})
	}
	if len(artifact.ContentHash) != 64 || strings.ToLower(artifact.ContentHash) != artifact.ContentHash {
		return errors.New("content_hash must be a lowercase SHA-256 digest")
	}
	if _, err := hex.DecodeString(artifact.ContentHash); err != nil {
		return errors.New("content_hash must be a lowercase SHA-256 digest")
	}
	if normalized := NormalizeFingerprint(artifact.KeyFingerprint); normalized != artifact.KeyFingerprint || len(normalized) != 71 {
		return errors.New("key_fingerprint must be a canonical SHA-256 fingerprint")
	}
	if _, err := hex.DecodeString(strings.TrimPrefix(artifact.KeyFingerprint, "sha256:")); err != nil {
		return errors.New("key_fingerprint must be a canonical SHA-256 fingerprint")
	}
	if artifact.CreatedAt < 0 {
		return errors.New("created_at must not be negative")
	}
	return nil
}

func (artifact SignedArtifact) CanonicalPayload() ([]byte, error) {
	if err := artifact.Validate(); err != nil {
		return nil, err
	}
	canonical := struct {
		Algorithm      string `json:"algorithm"`
		ArtifactID     string `json:"artifact_id"`
		ContentHash    string `json:"content_hash"`
		CreatedAt      int64  `json:"created_at"`
		KeyFingerprint string `json:"key_fingerprint"`
		SignerIdentity string `json:"signer_identity"`
	}{
		Algorithm: artifact.Algorithm, ArtifactID: artifact.ArtifactID,
		ContentHash: artifact.ContentHash, CreatedAt: artifact.CreatedAt,
		KeyFingerprint: artifact.KeyFingerprint, SignerIdentity: artifact.SignerIdentity,
	}
	var encoded bytes.Buffer
	encoder := json.NewEncoder(&encoded)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(canonical); err != nil {
		return nil, err
	}
	return bytes.TrimSuffix(encoded.Bytes(), []byte{'\n'}), nil
}

type ArtifactSigningCredential struct {
	SignerIdentity string
	PublicKey      ed25519.PublicKey
	ValidFrom      int64
	ValidUntil     int64
	Revoked        bool
}

func (credential ArtifactSigningCredential) Fingerprint() string {
	return ArtifactPublicKeyFingerprint(credential.PublicKey)
}

type ArtifactTrustPolicy struct {
	Credentials          map[string]ArtifactSigningCredential
	AllowedAlgorithms    map[string]bool
	MaxFutureSkewSeconds int64
	RevocationPolicy     *DurableRevocationPolicy
}

func NewArtifactTrustPolicy(credentials []ArtifactSigningCredential) *ArtifactTrustPolicy {
	trusted := make(map[string]ArtifactSigningCredential, len(credentials))
	for _, credential := range credentials {
		credential.PublicKey = append(ed25519.PublicKey(nil), credential.PublicKey...)
		trusted[credential.Fingerprint()] = credential
	}
	return &ArtifactTrustPolicy{
		Credentials: trusted, AllowedAlgorithms: map[string]bool{"ed25519": true},
		MaxFutureSkewSeconds: 10,
	}
}

type ArtifactSigner struct {
	PrivateKey     ed25519.PrivateKey
	SignerIdentity string
}

func NewArtifactSignerFromPEM(privateKeyPEM []byte, signerIdentity string) (*ArtifactSigner, error) {
	if signerIdentity == "" {
		return nil, errors.New("signer_identity must not be empty")
	}
	block, _ := pem.Decode(privateKeyPEM)
	if block == nil {
		return nil, errors.New("artifact private key PEM contains no key")
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, err
	}
	privateKey, ok := parsed.(ed25519.PrivateKey)
	if !ok {
		return nil, errors.New("artifact signer requires an Ed25519 private key")
	}
	return &ArtifactSigner{PrivateKey: privateKey, SignerIdentity: signerIdentity}, nil
}

func LoadArtifactPublicKeyPEM(publicKeyPEM []byte) (ed25519.PublicKey, error) {
	block, _ := pem.Decode(publicKeyPEM)
	if block == nil {
		return nil, errors.New("artifact public key PEM contains no key")
	}
	parsed, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return nil, err
	}
	publicKey, ok := parsed.(ed25519.PublicKey)
	if !ok {
		return nil, errors.New("artifact credential requires an Ed25519 public key")
	}
	return publicKey, nil
}

func ArtifactPublicKeyFingerprint(publicKey ed25519.PublicKey) string {
	digest := sha256.Sum256(publicKey)
	return "sha256:" + hex.EncodeToString(digest[:])
}

func (signer *ArtifactSigner) SignArtifact(artifactID string, data []byte, createdAt int64) (SignedArtifact, error) {
	if createdAt == 0 {
		createdAt = time.Now().Unix()
	}
	digest := sha256.Sum256(data)
	publicKey := signer.PrivateKey.Public().(ed25519.PublicKey)
	artifact := SignedArtifact{
		ArtifactID: artifactID, ContentHash: hex.EncodeToString(digest[:]), Algorithm: "ed25519",
		SignerIdentity: signer.SignerIdentity, KeyFingerprint: ArtifactPublicKeyFingerprint(publicKey),
		CreatedAt: createdAt,
	}
	payload, err := artifact.CanonicalPayload()
	if err != nil {
		return SignedArtifact{}, err
	}
	artifact.Signature = base64.StdEncoding.EncodeToString(ed25519.Sign(signer.PrivateKey, payload))
	return artifact, nil
}

func VerifySignedArtifact(data []byte, artifact SignedArtifact, policy *ArtifactTrustPolicy, now int64) error {
	if err := artifact.Validate(); err != nil {
		return err
	}
	if policy == nil || !policy.AllowedAlgorithms[artifact.Algorithm] {
		return securityError("artifact_algorithm_unsupported", "artifact signature algorithm is not allowlisted", nil)
	}
	digest := sha256.Sum256(data)
	if hex.EncodeToString(digest[:]) != artifact.ContentHash {
		return securityError("artifact_integrity_mismatch", "artifact content does not match the signed SHA-256 digest", nil)
	}
	credential, ok := policy.Credentials[artifact.KeyFingerprint]
	if !ok {
		return securityError("artifact_signer_untrusted", "artifact signer key is not trusted", nil)
	}
	if credential.SignerIdentity != artifact.SignerIdentity {
		return securityError("artifact_signer_mismatch", "artifact signer identity does not match local key policy", nil)
	}
	signerRevoked := false
	if policy.RevocationPolicy != nil {
		fingerprintRevoked, fingerprintErr := policy.RevocationPolicy.IsRevoked(RevocationSignerFingerprint, artifact.KeyFingerprint, now)
		identityRevoked, identityErr := policy.RevocationPolicy.IsRevoked(RevocationPeerID, artifact.SignerIdentity, now)
		if fingerprintErr != nil || identityErr != nil {
			return securityError("revocation_state_invalid", "revocation policy could not evaluate artifact signer", nil)
		}
		signerRevoked = fingerprintRevoked || identityRevoked
	}
	if credential.Revoked || signerRevoked {
		return securityError("artifact_signer_revoked", "artifact signer key is revoked", nil)
	}
	if now == 0 {
		now = time.Now().Unix()
	}
	if (credential.ValidFrom > 0 && now < credential.ValidFrom) || (credential.ValidUntil > 0 && now > credential.ValidUntil) {
		return securityError("artifact_signer_expired", "artifact signer credential is outside its validity window", nil)
	}
	if artifact.CreatedAt > now+policy.MaxFutureSkewSeconds ||
		(credential.ValidFrom > 0 && artifact.CreatedAt < credential.ValidFrom) ||
		(credential.ValidUntil > 0 && artifact.CreatedAt > credential.ValidUntil) {
		return securityError("artifact_timestamp_invalid", "artifact signature timestamp is outside the accepted window", nil)
	}
	signature, err := base64.StdEncoding.Strict().DecodeString(artifact.Signature)
	if err != nil || len(signature) != ed25519.SignatureSize {
		return securityError("artifact_signature_invalid", "artifact signature is not valid Ed25519 base64", nil)
	}
	payload, err := artifact.CanonicalPayload()
	if err != nil {
		return err
	}
	if !ed25519.Verify(credential.PublicKey, payload, signature) {
		return securityError("artifact_signature_invalid", "artifact signature verification failed", nil)
	}
	return nil
}

func ComputeSHA256(filePath string) (string, error) {
	f, err := os.Open(filePath)
	if err != nil {
		return "", err
	}
	defer f.Close()

	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func DetectHybridPQSupport() bool {
	hybridProbeOnce.Do(func() {
		if !canObserveNegotiatedHybridPQ {
			return
		}
		if HybridPQGroup.String() != "X25519MLKEM768" {
			return
		}
		certificate, err := ephemeralProbeCertificate()
		if err != nil {
			return
		}
		serverSide, clientSide := net.Pipe()
		defer serverSide.Close()
		defer clientSide.Close()
		// ML-KEM key generation can exceed 250 ms on constrained CI runners.
		// This probe runs once; use a bounded but realistic handshake deadline.
		deadline := time.Now().Add(2 * time.Second)
		_ = serverSide.SetDeadline(deadline)
		_ = clientSide.SetDeadline(deadline)
		server := cryptotls.Server(serverSide, &cryptotls.Config{
			MinVersion: cryptotls.VersionTLS13, MaxVersion: cryptotls.VersionTLS13,
			Certificates:     []cryptotls.Certificate{certificate},
			CurvePreferences: []cryptotls.CurveID{HybridPQGroup},
		})
		// Certificate verification is irrelevant in this isolated provider probe;
		// production contexts never set InsecureSkipVerify.
		client := cryptotls.Client(clientSide, &cryptotls.Config{
			MinVersion: cryptotls.VersionTLS13, MaxVersion: cryptotls.VersionTLS13,
			CurvePreferences:   []cryptotls.CurveID{HybridPQGroup},
			InsecureSkipVerify: true, //nolint:gosec
		})
		serverResult := make(chan error, 1)
		go func() { serverResult <- server.Handshake() }()
		clientErr := client.Handshake()
		if clientErr != nil {
			// Unblock the peer immediately when a compatibility GODEBUG or
			// provider policy removes the requested group.
			_ = clientSide.Close()
		}
		serverErr := <-serverResult
		hybridProbeSupported = clientErr == nil && serverErr == nil
	})
	return hybridProbeSupported
}

func ephemeralProbeCertificate() (cryptotls.Certificate, error) {
	privateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return cryptotls.Certificate{}, err
	}
	now := time.Now()
	template := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: "handoffkit-provider-probe"},
		NotBefore:    now.Add(-time.Minute),
		NotAfter:     now.Add(time.Minute),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &privateKey.PublicKey, privateKey)
	if err != nil {
		return cryptotls.Certificate{}, err
	}
	keyDER, err := x509.MarshalPKCS8PrivateKey(privateKey)
	if err != nil {
		return cryptotls.Certificate{}, err
	}
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyDER})
	return cryptotls.X509KeyPair(certPEM, keyPEM)
}

func GetSupportedCryptoCapabilities() map[string]any {
	hybrid := DetectHybridPQSupport()
	profiles := []SecurityProfile{SecurityProfileLocal, SecurityProfileStandard}
	if hybrid {
		profiles = append(profiles, SecurityProfileHybridPQ)
	}
	return map[string]any{
		"runtime":              "go",
		"contracts_only":       false,
		"provider":             runtime.Version() + " crypto/tls",
		"tls13_supported":      true,
		"profiles_supported":   profiles,
		"profiles_recognized":  []SecurityProfile{SecurityProfileLocal, SecurityProfileStandard, SecurityProfileHybridPQ, SecurityProfileResearch},
		"digest_algorithms":    []string{"sha256"},
		"signature_algorithms": []string{"ed25519"},
		"hybrid_pq_group": func() any {
			if hybrid {
				return "X25519MLKEM768"
			}
			return nil
		}(),
		"hybrid_pq_supported": hybrid,
	}
}

func BuildTLSConfig(config *SecurityConfig, isServer bool, serverName ...string) (*cryptotls.Config, error) {
	if config == nil || config.Profile == SecurityProfileLocal {
		return nil, nil
	}
	if config.Profile == SecurityProfileResearch {
		return nil, securityError("security_profile_unavailable", "research security profile has no production TLS provider", map[string]any{"profile": config.Profile})
	}
	if config.Profile == SecurityProfileHybridPQ && !DetectHybridPQSupport() {
		return nil, securityError("security_profile_unavailable", "hybrid-pq is unavailable in the active Go crypto/tls provider", map[string]any{"profile": config.Profile, "required_group": "X25519MLKEM768"})
	}

	tlsConfig := &cryptotls.Config{
		MinVersion: cryptotls.VersionTLS13,
		MaxVersion: cryptotls.VersionTLS13,
	}
	if config.Profile == SecurityProfileHybridPQ {
		tlsConfig.CurvePreferences = []cryptotls.CurveID{HybridPQGroup}
	} else {
		tlsConfig.CurvePreferences = []cryptotls.CurveID{cryptotls.X25519, cryptotls.CurveP256}
	}
	if !isServer {
		if len(serverName) == 0 || strings.TrimSpace(serverName[0]) == "" {
			return nil, securityError("server_name_required", "TLS client requires a server name for certificate verification", nil)
		}
		tlsConfig.ServerName = serverName[0]
	}

	if config.CACertPath != "" {
		caBytes, err := os.ReadFile(config.CACertPath)
		if err != nil {
			return nil, fmt.Errorf("failed to read CA file: %w", err)
		}
		rootPool, err := x509.SystemCertPool()
		if err != nil || rootPool == nil {
			rootPool = x509.NewCertPool()
		}
		if !rootPool.AppendCertsFromPEM(caBytes) {
			return nil, securityError("trust_anchor_invalid", "CA file contains no parseable certificates", nil)
		}
		clientPool := x509.NewCertPool()
		if !clientPool.AppendCertsFromPEM(caBytes) {
			return nil, securityError("trust_anchor_invalid", "CA file contains no parseable certificates", nil)
		}
		tlsConfig.RootCAs = rootPool
		tlsConfig.ClientCAs = clientPool
	}

	if (config.CertPath == "") != (config.KeyPath == "") {
		return nil, securityError("certificate_key_mismatch", "cert_path and key_path must be configured together", nil)
	}
	if config.CertPath != "" {
		certBytes, err := os.ReadFile(config.CertPath)
		if err != nil {
			return nil, fmt.Errorf("failed to read cert file: %w", err)
		}
		keyBytes, err := os.ReadFile(config.KeyPath)
		if err != nil {
			return nil, fmt.Errorf("failed to read key file: %w", err)
		}
		cert, err := cryptotls.X509KeyPair(certBytes, keyBytes)
		if err != nil {
			return nil, fmt.Errorf("failed to load certificate keypair: %w", err)
		}
		tlsConfig.Certificates = []cryptotls.Certificate{cert}
	}
	if isServer && len(tlsConfig.Certificates) == 0 {
		return nil, securityError("server_certificate_missing", "TLS server requires a certificate and private key", nil)
	}

	if config.RequireMTLS {
		if isServer {
			if tlsConfig.ClientCAs == nil {
				return nil, securityError("trust_anchor_missing", "mTLS server requires a configured client CA", nil)
			}
			tlsConfig.ClientAuth = cryptotls.RequireAndVerifyClientCert
		} else if len(tlsConfig.Certificates) == 0 {
			return nil, securityError("client_certificate_missing", "mTLS client requires a certificate and private key", nil)
		}
	}

	return tlsConfig, nil
}
