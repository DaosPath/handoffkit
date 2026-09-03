package security

import (
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/pem"
	"errors"
	"os"
	"runtime"
	"sync"
	"time"
)

type tlsReloadCandidate struct {
	config               *tls.Config
	fingerprint          string
	trustAnchorHash      string
	certificateExpiresAt int64
}

// ReloadableTLSConfig atomically publishes fully validated TLS configuration
// snapshots for new handshakes. Existing connections retain their negotiated
// credentials and trust state.
type ReloadableTLSConfig struct {
	mu                      sync.RWMutex
	isServer                bool
	profile                 SecurityProfile
	trustDomain             string
	defaultServerName       string
	current                 *tls.Config
	currentFingerprint      string
	previousFingerprint     string
	trustAnchorHash         string
	previousTrustAnchorHash string
	certificateExpiresAt    int64
	transitionUntil         int64
	generation              uint64
}

func NewReloadableTLSConfig(config *SecurityConfig, isServer bool, serverName ...string) (*ReloadableTLSConfig, error) {
	if config == nil {
		return nil, securityError("tls_profile_required", "reloadable TLS config requires a security configuration", nil)
	}
	name := ""
	if len(serverName) > 0 {
		name = serverName[0]
	}
	provider := &ReloadableTLSConfig{
		isServer:          isServer,
		profile:           config.Profile,
		trustDomain:       config.TrustDomain,
		defaultServerName: name,
		generation:        1,
	}
	candidate, err := provider.buildCandidate(config)
	if err != nil {
		return nil, err
	}
	provider.current = candidate.config
	provider.currentFingerprint = candidate.fingerprint
	provider.trustAnchorHash = candidate.trustAnchorHash
	provider.certificateExpiresAt = candidate.certificateExpiresAt
	return provider, nil
}

func (provider *ReloadableTLSConfig) ClientConfig(serverName string) (*tls.Config, error) {
	config, _, err := provider.ClientSnapshot(serverName, nil)
	return config, err
}

func (provider *ReloadableTLSConfig) ClientSnapshot(serverName string, capabilities []string) (*tls.Config, *PeerIdentity, error) {
	if provider.isServer {
		return nil, nil, securityError("tls_reload_role_mismatch", "TLS reload provider role does not match transport role", nil)
	}
	if serverName == "" {
		serverName = provider.defaultServerName
	}
	if serverName == "" {
		return nil, nil, securityError("server_name_required", "TLS client requires a server name for certificate verification", nil)
	}
	provider.mu.RLock()
	defer provider.mu.RUnlock()
	config := provider.current.Clone()
	config.ServerName = serverName
	identity, err := PeerIdentityFromTLSConfig(config, capabilities)
	if err != nil {
		return nil, nil, err
	}
	return config, identity, nil
}

func (provider *ReloadableTLSConfig) LocalIdentity(capabilities []string) (*PeerIdentity, error) {
	provider.mu.RLock()
	defer provider.mu.RUnlock()
	return PeerIdentityFromTLSConfig(provider.current, capabilities)
}

func (provider *ReloadableTLSConfig) ServerConfig() (*tls.Config, error) {
	config, _, err := provider.ServerSnapshot(nil)
	return config, err
}

func (provider *ReloadableTLSConfig) ServerSnapshot(capabilities []string) (*tls.Config, *PeerIdentity, error) {
	if !provider.isServer {
		return nil, nil, securityError("tls_reload_role_mismatch", "TLS reload provider role does not match transport role", nil)
	}
	provider.mu.RLock()
	defer provider.mu.RUnlock()
	config := provider.current.Clone()
	identity, err := PeerIdentityFromTLSConfig(config, capabilities)
	if err != nil {
		return nil, nil, err
	}
	return config, identity, nil
}

func (provider *ReloadableTLSConfig) Reload(config *SecurityConfig, transition time.Duration, now int64) (map[string]any, error) {
	if transition < 0 {
		return nil, errors.New("transition duration must not be negative")
	}
	if config.Profile != provider.profile || config.TrustDomain != provider.trustDomain {
		return nil, securityError("tls_reload_policy_mismatch", "TLS reload cannot change security profile or trust domain", nil)
	}
	candidate, err := provider.buildCandidate(config)
	if err != nil {
		return nil, err
	}
	if now == 0 {
		now = time.Now().Unix()
	}
	provider.mu.Lock()
	provider.previousFingerprint = provider.currentFingerprint
	provider.previousTrustAnchorHash = provider.trustAnchorHash
	provider.current = candidate.config
	provider.currentFingerprint = candidate.fingerprint
	provider.trustAnchorHash = candidate.trustAnchorHash
	provider.certificateExpiresAt = candidate.certificateExpiresAt
	provider.transitionUntil = now + int64(transition/time.Second)
	provider.generation++
	provider.mu.Unlock()
	return provider.Status(now), nil
}

func (provider *ReloadableTLSConfig) Status(now int64) map[string]any {
	if now == 0 {
		now = time.Now().Unix()
	}
	provider.mu.RLock()
	defer provider.mu.RUnlock()
	role := "client"
	if provider.isServer {
		role = "server"
	}
	return map[string]any{
		"generation":                 provider.generation,
		"role":                       role,
		"security_profile":           provider.profile,
		"current_fingerprint":        nullableString(provider.currentFingerprint),
		"previous_fingerprint":       nullableString(provider.previousFingerprint),
		"transition_until":           provider.transitionUntil,
		"previous_accepted":          provider.previousFingerprint != "" && now <= provider.transitionUntil,
		"trust_anchor_hash":          nullableString(provider.trustAnchorHash),
		"previous_trust_anchor_hash": nullableString(provider.previousTrustAnchorHash),
		"certificate_expires_at":     provider.certificateExpiresAt,
		"provider":                   runtime.Version() + " crypto/tls",
	}
}

func (provider *ReloadableTLSConfig) buildCandidate(config *SecurityConfig) (*tlsReloadCandidate, error) {
	tlsConfig, err := BuildTLSConfig(config, provider.isServer, provider.defaultServerName)
	if err != nil {
		return nil, err
	}
	if tlsConfig == nil {
		return nil, securityError("tls_profile_required", "reloadable TLS config requires a secure profile", nil)
	}
	candidate := &tlsReloadCandidate{config: tlsConfig}
	if config.CertPath != "" {
		encoded, readErr := os.ReadFile(config.CertPath)
		if readErr != nil {
			return nil, readErr
		}
		block, _ := pem.Decode(encoded)
		if block == nil {
			return nil, errors.New("certificate file contains no PEM certificate")
		}
		certificate, parseErr := x509.ParseCertificate(block.Bytes)
		if parseErr != nil {
			return nil, parseErr
		}
		candidate.fingerprint = CertificateFingerprint(certificate)
		candidate.certificateExpiresAt = certificate.NotAfter.Unix()
	}
	if config.CACertPath != "" {
		encoded, readErr := os.ReadFile(config.CACertPath)
		if readErr != nil {
			return nil, readErr
		}
		digest := sha256.Sum256(encoded)
		candidate.trustAnchorHash = "sha256:" + hex.EncodeToString(digest[:])
	}
	return candidate, nil
}
