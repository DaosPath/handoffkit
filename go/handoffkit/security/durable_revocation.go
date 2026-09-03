package security

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	DurableRevocationFormatVersion = 1
	durableRevocationFormat        = "handoffkit.security.revocations"
)

type RevocationKind string

const (
	RevocationCertificateFingerprint RevocationKind = "certificate_fingerprint"
	RevocationSignerFingerprint      RevocationKind = "signer_fingerprint"
	RevocationPeerID                 RevocationKind = "peer_id"
	RevocationIssuer                 RevocationKind = "issuer"
	RevocationTrustDomain            RevocationKind = "trust_domain"
)

type RevocationEntry struct {
	EffectiveAt int64          `json:"effective_at"`
	ExpiresAt   int64          `json:"expires_at"`
	Kind        RevocationKind `json:"kind"`
	Reason      string         `json:"reason"`
	RevokedAt   int64          `json:"revoked_at"`
	Value       string         `json:"value"`
}

func NewRevocationEntry(kind RevocationKind, value, reason string, revokedAt, effectiveAt, expiresAt int64) (RevocationEntry, error) {
	entry := RevocationEntry{
		EffectiveAt: effectiveAt,
		ExpiresAt:   expiresAt,
		Kind:        kind,
		Reason:      reason,
		RevokedAt:   revokedAt,
		Value:       value,
	}
	if entry.EffectiveAt == 0 {
		entry.EffectiveAt = entry.RevokedAt
	}
	if err := entry.normalizeAndValidate(); err != nil {
		return RevocationEntry{}, err
	}
	return entry, nil
}

func (entry *RevocationEntry) normalizeAndValidate() error {
	normalized, err := NormalizeRevocationValue(entry.Kind, entry.Value)
	if err != nil {
		return err
	}
	entry.Value = normalized
	entry.Reason = strings.TrimSpace(entry.Reason)
	if entry.Reason == "" {
		return errors.New("revocation reason must not be empty")
	}
	if entry.RevokedAt < 0 || entry.EffectiveAt < 0 || entry.ExpiresAt < 0 {
		return errors.New("revocation timestamps must not be negative")
	}
	if entry.ExpiresAt > 0 && entry.ExpiresAt <= entry.EffectiveAt {
		return errors.New("expires_at must be later than effective_at")
	}
	return nil
}

func NormalizeRevocationValue(kind RevocationKind, value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", errors.New("revocation value must not be empty")
	}
	switch kind {
	case RevocationCertificateFingerprint, RevocationSignerFingerprint:
		normalized := NormalizeFingerprint(value)
		raw := strings.TrimPrefix(normalized, "sha256:")
		if len(raw) != 64 {
			return "", errors.New("revocation fingerprint must be a SHA-256 fingerprint")
		}
		if _, err := hex.DecodeString(raw); err != nil {
			return "", errors.New("revocation fingerprint must be a SHA-256 fingerprint")
		}
		return normalized, nil
	case RevocationPeerID, RevocationIssuer:
		return value, nil
	case RevocationTrustDomain:
		return strings.ToLower(value), nil
	default:
		return "", fmt.Errorf("unsupported revocation kind: %s", kind)
	}
}

type DurableRevocationOptions struct {
	MaxEntries   int
	MaxFileBytes int64
}

func DefaultDurableRevocationOptions() DurableRevocationOptions {
	return DurableRevocationOptions{MaxEntries: 10_000, MaxFileBytes: 4 * 1024 * 1024}
}

type durableRevocationPayload struct {
	Entries       []RevocationEntry `json:"entries"`
	Format        string            `json:"format"`
	FormatVersion int               `json:"format_version"`
	Generation    uint64            `json:"generation"`
}

type durableRevocationEnvelope struct {
	Checksum      string            `json:"checksum"`
	Entries       []RevocationEntry `json:"entries"`
	Format        string            `json:"format"`
	FormatVersion int               `json:"format_version"`
	Generation    uint64            `json:"generation"`
}

type DurableRevocationStatus struct {
	Active        int    `json:"active"`
	Entries       int    `json:"entries"`
	Format        string `json:"format"`
	FormatVersion int    `json:"format_version"`
	Generation    uint64 `json:"generation"`
}

type DurableRevocationPolicy struct {
	mu           sync.RWMutex
	path         string
	maxEntries   int
	maxFileBytes int64
	generation   uint64
	entries      map[string]RevocationEntry
}

func NewDurableRevocationPolicy(path string, options DurableRevocationOptions) (*DurableRevocationPolicy, error) {
	if options.MaxEntries < 1 || options.MaxFileBytes < 1024 {
		return nil, errors.New("durable revocation bounds are invalid")
	}
	policy := &DurableRevocationPolicy{
		path:         filepath.Clean(path),
		maxEntries:   options.MaxEntries,
		maxFileBytes: options.MaxFileBytes,
		entries:      map[string]RevocationEntry{},
	}
	if err := policy.Reload(); err != nil {
		return nil, err
	}
	return policy, nil
}

func (policy *DurableRevocationPolicy) Revoke(entry RevocationEntry) error {
	if entry.EffectiveAt == 0 {
		entry.EffectiveAt = entry.RevokedAt
	}
	if err := entry.normalizeAndValidate(); err != nil {
		return err
	}
	policy.mu.Lock()
	defer policy.mu.Unlock()
	candidate := cloneRevocations(policy.entries)
	candidate[revocationKey(entry.Kind, entry.Value)] = entry
	if len(candidate) > policy.maxEntries {
		return securityError("revocation_state_capacity", "durable revocation capacity is exhausted", map[string]any{"max_entries": policy.maxEntries})
	}
	generation := policy.generation + 1
	if err := policy.persist(candidate, generation); err != nil {
		var structured *SecurityError
		if errors.As(err, &structured) && structured.Code == "revocation_state_durability_uncertain" {
			policy.entries = candidate
			policy.generation = generation
		}
		return err
	}
	policy.entries = candidate
	policy.generation = generation
	return nil
}

func (policy *DurableRevocationPolicy) Remove(kind RevocationKind, value string) (bool, error) {
	normalized, err := NormalizeRevocationValue(kind, value)
	if err != nil {
		return false, err
	}
	policy.mu.Lock()
	defer policy.mu.Unlock()
	key := revocationKey(kind, normalized)
	if _, ok := policy.entries[key]; !ok {
		return false, nil
	}
	candidate := cloneRevocations(policy.entries)
	delete(candidate, key)
	generation := policy.generation + 1
	if err := policy.persist(candidate, generation); err != nil {
		return false, err
	}
	policy.entries = candidate
	policy.generation = generation
	return true, nil
}

func (policy *DurableRevocationPolicy) IsRevoked(kind RevocationKind, value string, now int64) (bool, error) {
	normalized, err := NormalizeRevocationValue(kind, value)
	if err != nil {
		return false, err
	}
	if now == 0 {
		now = time.Now().Unix()
	}
	policy.mu.RLock()
	defer policy.mu.RUnlock()
	entry, ok := policy.entries[revocationKey(kind, normalized)]
	return ok && entry.EffectiveAt <= now && (entry.ExpiresAt == 0 || now < entry.ExpiresAt), nil
}

func (policy *DurableRevocationPolicy) Status(now int64) DurableRevocationStatus {
	if now == 0 {
		now = time.Now().Unix()
	}
	policy.mu.RLock()
	defer policy.mu.RUnlock()
	active := 0
	for _, entry := range policy.entries {
		if entry.EffectiveAt <= now && (entry.ExpiresAt == 0 || now < entry.ExpiresAt) {
			active++
		}
	}
	return DurableRevocationStatus{
		Active: active, Entries: len(policy.entries), Format: durableRevocationFormat,
		FormatVersion: DurableRevocationFormatVersion, Generation: policy.generation,
	}
}

func (policy *DurableRevocationPolicy) Reload() error {
	policy.mu.Lock()
	defer policy.mu.Unlock()
	entries, generation, err := policy.load()
	if err != nil {
		return err
	}
	policy.entries = entries
	policy.generation = generation
	return nil
}

func (policy *DurableRevocationPolicy) persist(entries map[string]RevocationEntry, generation uint64) error {
	sorted := sortedRevocations(entries)
	payload := durableRevocationPayload{
		Entries: sorted, Format: durableRevocationFormat,
		FormatVersion: DurableRevocationFormatVersion, Generation: generation,
	}
	payloadBytes, err := canonicalJSON(payload)
	if err != nil {
		return securityError("security_state_encode", "durable security state cannot be encoded", nil)
	}
	digest := sha256.Sum256(payloadBytes)
	envelope := durableRevocationEnvelope{
		Checksum: "sha256:" + hex.EncodeToString(digest[:]), Entries: sorted,
		Format: durableRevocationFormat, FormatVersion: DurableRevocationFormatVersion,
		Generation: generation,
	}
	encoded, err := canonicalJSON(envelope)
	if err != nil {
		return securityError("security_state_encode", "durable security state cannot be encoded", nil)
	}
	encoded = append(encoded, '\n')
	if int64(len(encoded)) > policy.maxFileBytes {
		return securityError("security_state_limit", "durable security state exceeds configured byte limit", map[string]any{"limit_bytes": policy.maxFileBytes})
	}
	return atomicWriteVersionedState(
		policy.path,
		encoded,
		"revocation_state_durability_uncertain",
		"durable revocation state committed but directory sync was uncertain",
	)
}

func (policy *DurableRevocationPolicy) load() (map[string]RevocationEntry, uint64, error) {
	entries := map[string]RevocationEntry{}
	if err := ensureStateParent(policy.path); err != nil {
		return nil, 0, err
	}
	info, err := os.Lstat(policy.path)
	if errors.Is(err, os.ErrNotExist) {
		return entries, 0, nil
	}
	if err != nil {
		return nil, 0, securityError("security_state_read_failed", "durable security state cannot be inspected", nil)
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return nil, 0, securityError("security_state_path_unsafe", "durable security state must be a regular non-symlink file", nil)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm()&0o077 != 0 {
		return nil, 0, securityError("security_state_permissions", "durable security state grants group or other permissions", nil)
	}
	if info.Size() > policy.maxFileBytes {
		return nil, 0, policy.quarantine("state exceeds configured byte limit")
	}
	raw, err := os.ReadFile(policy.path)
	if err != nil {
		return nil, 0, policy.quarantine("state cannot be read")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var envelope durableRevocationEnvelope
	if err := decoder.Decode(&envelope); err != nil {
		return nil, 0, policy.quarantine("state cannot be decoded")
	}
	if err := requireRevocationJSONEOF(decoder); err != nil {
		return nil, 0, policy.quarantine("state contains trailing data")
	}
	payload := durableRevocationPayload{
		Entries: envelope.Entries, Format: envelope.Format,
		FormatVersion: envelope.FormatVersion, Generation: envelope.Generation,
	}
	canonical, err := canonicalJSON(payload)
	if err != nil {
		return nil, 0, policy.quarantine("state cannot be canonicalized")
	}
	digest := sha256.Sum256(canonical)
	if envelope.Checksum != "sha256:"+hex.EncodeToString(digest[:]) {
		return nil, 0, policy.quarantine("state checksum mismatch")
	}
	if envelope.Format != durableRevocationFormat || envelope.FormatVersion != DurableRevocationFormatVersion {
		return nil, 0, policy.quarantine("unsupported state format")
	}
	if len(envelope.Entries) > policy.maxEntries {
		return nil, 0, policy.quarantine("state exceeds configured entry capacity")
	}
	for _, rawEntry := range envelope.Entries {
		entry := rawEntry
		if err := entry.normalizeAndValidate(); err != nil {
			return nil, 0, policy.quarantine("revocation entry is invalid")
		}
		key := revocationKey(entry.Kind, entry.Value)
		if _, exists := entries[key]; exists {
			return nil, 0, policy.quarantine("revocation entry is duplicated")
		}
		entries[key] = entry
	}
	return entries, envelope.Generation, nil
}

func (policy *DurableRevocationPolicy) quarantine(reason string) error {
	target := fmt.Sprintf("%s.corrupt-%d-%d", policy.path, time.Now().Unix(), os.Getpid())
	if err := os.Rename(policy.path, target); err != nil {
		return securityError("security_state_quarantine_failed", "durable security state is invalid and could not be quarantined", map[string]any{"reason": fmt.Sprintf("%T", err)})
	}
	return securityError("security_state_corrupt", "durable security state is invalid and was quarantined", map[string]any{"reason": reason, "quarantine": filepath.Base(target)})
}

func revocationKey(kind RevocationKind, value string) string {
	return string(kind) + "\x00" + value
}

func cloneRevocations(source map[string]RevocationEntry) map[string]RevocationEntry {
	clone := make(map[string]RevocationEntry, len(source))
	for key, entry := range source {
		clone[key] = entry
	}
	return clone
}

func sortedRevocations(entries map[string]RevocationEntry) []RevocationEntry {
	keys := make([]string, 0, len(entries))
	for key := range entries {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	result := make([]RevocationEntry, 0, len(keys))
	for _, key := range keys {
		result = append(result, entries[key])
	}
	return result
}

func requireRevocationJSONEOF(decoder *json.Decoder) error {
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return errors.New("expected EOF")
	}
	return nil
}
