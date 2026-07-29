// Package security provides security profiles, TLS 1.3, identity, capability authorization, and replay protection.
package security

import (
	"crypto/sha256"
	cryptotls "crypto/tls"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"sync"
	"time"
)

type SecurityProfile string

const (
	SecurityProfileLocal    SecurityProfile = "local"
	SecurityProfileStandard SecurityProfile = "standard"
	SecurityProfileHybridPQ SecurityProfile = "hybrid-pq"
	SecurityProfileResearch SecurityProfile = "research"
)

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
	if (host == "0.0.0.0" || host == "::") && c.AllowInsecureLoopback {
		return errors.New("allow_insecure_loopback cannot be used with public bind (0.0.0.0)")
	}
	isLoopback := host == "127.0.0.1" || host == "localhost" || host == "::1"
	if c.Profile == SecurityProfileLocal && !isLoopback && !c.AllowInsecureLoopback {
		return fmt.Errorf("profile 'local' cannot listen on non-loopback interface '%s' without allow_insecure_loopback=true", host)
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
	if peer != nil && len(peer.Capabilities) > 0 {
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
	return true
}

func (cp *CapabilityPolicy) AuthorizeJob(jobType string, peer *PeerIdentity) error {
	if !peer.IsValidAt(0) {
		return fmt.Errorf("peer identity '%s' has expired or is invalid", peer.PeerID)
	}
	op := "job:" + jobType
	if !cp.IsOperationAuthorized(op, peer) && !cp.IsOperationAuthorized(jobType, peer) {
		return fmt.Errorf("peer '%s' is not authorized to execute job type '%s'", peer.PeerID, jobType)
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

func (rp *ReplayProtection) CheckAndRecord(sessionID string, sequence uint64, nonce string, createdAtTs int64) error {
	rp.mu.Lock()
	defer rp.mu.Unlock()

	now := time.Now().Unix()
	if createdAtTs != 0 {
		if uint64(now)-uint64(createdAtTs) > rp.WindowSeconds && now > createdAtTs {
			return fmt.Errorf("message timestamp is older than replay window (%ds)", rp.WindowSeconds)
		}
		if createdAtTs > now && uint64(createdAtTs-now) > rp.MaxClockSkewSeconds {
			return fmt.Errorf("message timestamp is in the future beyond max clock skew (%ds)", rp.MaxClockSkewSeconds)
		}
	}

	if lastSeq, ok := rp.lastSequences[sessionID]; ok {
		if sequence <= lastSeq {
			return fmt.Errorf("sequence %d is not strictly monotonic for session %s (last: %d)", sequence, sessionID, lastSeq)
		}
	}
	rp.lastSequences[sessionID] = sequence

	if nonce != "" {
		if _, exists := rp.seenNonces[nonce]; exists {
			return fmt.Errorf("duplicate nonce detected: %s", nonce)
		}
		if len(rp.seenNonces) >= rp.MaxSeenNonces {
			for k := range rp.seenNonces {
				delete(rp.seenNonces, k)
				break
			}
		}
		rp.seenNonces[nonce] = now
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

func BuildTLSConfig(config *SecurityConfig, isServer bool) (*cryptotls.Config, error) {
	if config == nil || config.Profile == SecurityProfileLocal {
		return nil, nil
	}

	tlsConfig := &cryptotls.Config{
		MinVersion: cryptotls.VersionTLS13,
	}

	if config.CertPath != "" && config.KeyPath != "" {
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

	if config.RequireMTLS {
		if isServer {
			tlsConfig.ClientAuth = cryptotls.RequireAndVerifyClientCert
		}
	}

	return tlsConfig, nil
}
