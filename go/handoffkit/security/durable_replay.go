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
	"time"
)

const (
	DurableReplayFormatVersion = 1
	durableReplayFormat        = "handoffkit.security.replay"
)

var atomicReplaceState = atomicReplace

type ReplayContext struct {
	PeerID                string `json:"peer_id"`
	SessionID             string `json:"session_id"`
	CredentialFingerprint string `json:"credential_fingerprint"`
	SecurityProfile       string `json:"security_profile"`
}

func (context ReplayContext) validate() error {
	if context.PeerID == "" || context.SessionID == "" || context.CredentialFingerprint == "" || context.SecurityProfile == "" {
		return securityError("replay_context_missing", "durable replay state requires authenticated context", nil)
	}
	return nil
}

type DurableReplayOptions struct {
	WindowSeconds       uint64
	MaxClockSkewSeconds uint64
	MaxSeenNonces       int
	MaxScopes           int
	StateTTLSeconds     uint64
	MaxFileBytes        int64
}

func DefaultDurableReplayOptions() DurableReplayOptions {
	return DurableReplayOptions{
		WindowSeconds:       300,
		MaxClockSkewSeconds: 10,
		MaxSeenNonces:       10_000,
		MaxScopes:           10_000,
		StateTTLSeconds:     86_400,
		MaxFileBytes:        4 * 1024 * 1024,
	}
}

type durableReplayNonce struct {
	SeenAt int64  `json:"seen_at"`
	Value  string `json:"value"`
}

type durableReplayRecord struct {
	CredentialFingerprint string               `json:"credential_fingerprint"`
	ExpiresAt             int64                `json:"expires_at"`
	LastSequence          uint64               `json:"last_sequence"`
	Nonces                []durableReplayNonce `json:"nonces"`
	PeerID                string               `json:"peer_id"`
	Scope                 string               `json:"scope"`
	SecurityProfile       string               `json:"security_profile"`
	SessionID             string               `json:"session_id"`
	UpdatedAt             int64                `json:"updated_at"`
}

type durableReplayPayload struct {
	Format        string                `json:"format"`
	FormatVersion int                   `json:"format_version"`
	Generation    uint64                `json:"generation"`
	Records       []durableReplayRecord `json:"records"`
}

type durableReplayEnvelope struct {
	Checksum      string                `json:"checksum"`
	Format        string                `json:"format"`
	FormatVersion int                   `json:"format_version"`
	Generation    uint64                `json:"generation"`
	Records       []durableReplayRecord `json:"records"`
}

type durableReplayState struct {
	path            string
	maxFileBytes    int64
	maxScopes       int
	stateTTLSeconds uint64
	generation      uint64
	records         map[string]durableReplayRecord
}

type DurableReplayStatus struct {
	Format        string `json:"format"`
	FormatVersion int    `json:"format_version"`
	Generation    uint64 `json:"generation"`
	Scopes        int    `json:"scopes"`
	Nonces        int    `json:"nonces"`
}

func NewDurableReplayProtection(path string, options DurableReplayOptions) (*ReplayProtection, error) {
	if options.WindowSeconds == 0 || options.MaxSeenNonces < 1 || options.MaxScopes < 1 ||
		options.StateTTLSeconds < options.WindowSeconds || options.MaxFileBytes < 1024 {
		return nil, fmt.Errorf("durable replay bounds are invalid")
	}
	state := &durableReplayState{
		path:            filepath.Clean(path),
		maxFileBytes:    options.MaxFileBytes,
		maxScopes:       options.MaxScopes,
		stateTTLSeconds: options.StateTTLSeconds,
		records:         map[string]durableReplayRecord{},
	}
	sequences, nonces, err := state.load()
	if err != nil {
		return nil, err
	}
	return &ReplayProtection{
		WindowSeconds:       options.WindowSeconds,
		MaxClockSkewSeconds: options.MaxClockSkewSeconds,
		MaxSeenNonces:       options.MaxSeenNonces,
		seenNonces:          nonces,
		lastSequences:       sequences,
		durable:             state,
	}, nil
}

func (rp *ReplayProtection) DurableStatus() (DurableReplayStatus, bool) {
	rp.mu.Lock()
	defer rp.mu.Unlock()
	if rp.durable == nil {
		return DurableReplayStatus{}, false
	}
	return DurableReplayStatus{
		Format:        durableReplayFormat,
		FormatVersion: DurableReplayFormatVersion,
		Generation:    rp.durable.generation,
		Scopes:        len(rp.durable.records),
		Nonces:        len(rp.seenNonces),
	}, true
}

func (rp *ReplayProtection) CompactDurable(now time.Time) error {
	rp.mu.Lock()
	defer rp.mu.Unlock()
	if rp.durable == nil {
		return securityError("replay_state_not_durable", "replay protection has no durable backend", nil)
	}
	nowUnix := now.Unix()
	candidateSequences := cloneSequences(rp.lastSequences)
	candidateNonces := cloneNonces(rp.seenNonces)
	cutoff := nowUnix - int64(rp.WindowSeconds)
	for key, seenAt := range candidateNonces {
		if seenAt < cutoff {
			delete(candidateNonces, key)
		}
	}
	records := cloneReplayRecords(rp.durable.records)
	changed := len(candidateNonces) != len(rp.seenNonces)
	for scope, record := range records {
		if record.ExpiresAt <= nowUnix {
			delete(records, scope)
			delete(candidateSequences, scope)
			for key := range candidateNonces {
				if strings.HasPrefix(key, scope+"\x00") {
					delete(candidateNonces, key)
				}
			}
			changed = true
			continue
		}
		record.Nonces = nonceEntries(scope, candidateNonces)
		records[scope] = record
	}
	if !changed {
		return nil
	}
	if err := rp.durable.commit(records, rp.durable.generation+1); err != nil {
		return err
	}
	rp.lastSequences = candidateSequences
	rp.seenNonces = candidateNonces
	return nil
}

func (state *durableReplayState) commitCandidate(
	scope string,
	sequence uint64,
	sequences map[string]uint64,
	nonces map[string]int64,
	context *ReplayContext,
	now int64,
) error {
	records := cloneReplayRecords(state.records)
	for recordScope, record := range records {
		if record.ExpiresAt <= now {
			delete(records, recordScope)
		}
	}
	existing, hasExisting := records[scope]
	if !hasExisting && len(records) >= state.maxScopes {
		return securityError("replay_state_capacity", "durable replay scope capacity is exhausted", map[string]any{"max_scopes": state.maxScopes})
	}
	resolved := ReplayContext{}
	if context != nil {
		resolved = *context
	} else if hasExisting {
		resolved = ReplayContext{
			PeerID:                existing.PeerID,
			SessionID:             existing.SessionID,
			CredentialFingerprint: existing.CredentialFingerprint,
			SecurityProfile:       existing.SecurityProfile,
		}
	}
	if err := resolved.validate(); err != nil {
		return err
	}
	records[scope] = durableReplayRecord{
		CredentialFingerprint: resolved.CredentialFingerprint,
		ExpiresAt:             now + int64(state.stateTTLSeconds),
		LastSequence:          sequence,
		Nonces:                nonceEntries(scope, nonces),
		PeerID:                resolved.PeerID,
		Scope:                 scope,
		SecurityProfile:       resolved.SecurityProfile,
		SessionID:             resolved.SessionID,
		UpdatedAt:             now,
	}
	if sequences[scope] != sequence {
		return securityError("replay_state_invalid", "candidate replay sequence is inconsistent", nil)
	}
	return state.commit(records, state.generation+1)
}

func (state *durableReplayState) commit(records map[string]durableReplayRecord, generation uint64) error {
	payload := durableReplayPayload{
		Format:        durableReplayFormat,
		FormatVersion: DurableReplayFormatVersion,
		Generation:    generation,
		Records:       sortedRecords(records),
	}
	payloadBytes, err := canonicalJSON(payload)
	if err != nil {
		return securityError("security_state_encode", "durable security state cannot be encoded", nil)
	}
	digest := sha256.Sum256(payloadBytes)
	envelope := durableReplayEnvelope{
		Checksum:      "sha256:" + hex.EncodeToString(digest[:]),
		Format:        payload.Format,
		FormatVersion: payload.FormatVersion,
		Generation:    payload.Generation,
		Records:       payload.Records,
	}
	encoded, err := canonicalJSON(envelope)
	if err != nil {
		return securityError("security_state_encode", "durable security state cannot be encoded", nil)
	}
	encoded = append(encoded, '\n')
	if int64(len(encoded)) > state.maxFileBytes {
		return securityError("security_state_limit", "durable security state exceeds configured byte limit", map[string]any{"limit_bytes": state.maxFileBytes})
	}
	if err := atomicWriteState(state.path, encoded); err != nil {
		return err
	}
	state.records = records
	state.generation = generation
	return nil
}

func (state *durableReplayState) load() (map[string]uint64, map[string]int64, error) {
	sequences := map[string]uint64{}
	nonces := map[string]int64{}
	if err := ensureStateParent(state.path); err != nil {
		return nil, nil, err
	}
	info, err := os.Lstat(state.path)
	if errors.Is(err, os.ErrNotExist) {
		return sequences, nonces, nil
	}
	if err != nil {
		return nil, nil, securityError("security_state_read_failed", "durable security state cannot be inspected", map[string]any{"reason": fmt.Sprintf("%T", err)})
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return nil, nil, securityError("security_state_path_unsafe", "durable security state must be a regular non-symlink file", map[string]any{"name": filepath.Base(state.path)})
	}
	if runtime.GOOS != "windows" && info.Mode().Perm()&0o077 != 0 {
		return nil, nil, securityError("security_state_permissions", "durable security state grants group or other permissions", map[string]any{"name": filepath.Base(state.path)})
	}
	if info.Size() > state.maxFileBytes {
		return nil, nil, state.quarantine("state exceeds configured byte limit")
	}
	raw, err := os.ReadFile(state.path)
	if err != nil {
		return nil, nil, state.quarantine("state cannot be read")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var envelope durableReplayEnvelope
	if err := decoder.Decode(&envelope); err != nil {
		return nil, nil, state.quarantine("state cannot be decoded")
	}
	if err := requireJSONEOF(decoder); err != nil {
		return nil, nil, state.quarantine("state contains trailing data")
	}
	payload := durableReplayPayload{
		Format:        envelope.Format,
		FormatVersion: envelope.FormatVersion,
		Generation:    envelope.Generation,
		Records:       envelope.Records,
	}
	payloadBytes, err := canonicalJSON(payload)
	if err != nil {
		return nil, nil, state.quarantine("state cannot be canonicalized")
	}
	digest := sha256.Sum256(payloadBytes)
	if envelope.Checksum != "sha256:"+hex.EncodeToString(digest[:]) {
		return nil, nil, state.quarantine("state checksum mismatch")
	}
	if envelope.Format != durableReplayFormat || envelope.FormatVersion != DurableReplayFormatVersion {
		return nil, nil, state.quarantine("unsupported state format")
	}
	if len(envelope.Records) > state.maxScopes {
		return nil, nil, state.quarantine("state exceeds configured scope capacity")
	}
	for _, record := range envelope.Records {
		if record.Scope == "" || record.PeerID == "" || record.SessionID == "" || record.CredentialFingerprint == "" || record.SecurityProfile == "" {
			return nil, nil, state.quarantine("record context is invalid")
		}
		if _, exists := state.records[record.Scope]; exists {
			return nil, nil, state.quarantine("record scope is duplicated")
		}
		state.records[record.Scope] = record
		sequences[record.Scope] = record.LastSequence
		for _, entry := range record.Nonces {
			if entry.Value == "" || entry.SeenAt < 0 {
				return nil, nil, state.quarantine("nonce entry is invalid")
			}
			key := record.Scope + "\x00" + entry.Value
			if _, exists := nonces[key]; exists {
				return nil, nil, state.quarantine("nonce entry is duplicated")
			}
			nonces[key] = entry.SeenAt
		}
	}
	state.generation = envelope.Generation
	return sequences, nonces, nil
}

func (state *durableReplayState) quarantine(reason string) error {
	target := fmt.Sprintf("%s.corrupt-%d-%d", state.path, time.Now().Unix(), os.Getpid())
	if err := os.Rename(state.path, target); err != nil {
		return securityError("security_state_quarantine_failed", "durable security state is invalid and could not be quarantined", map[string]any{"name": filepath.Base(state.path), "reason": fmt.Sprintf("%T", err)})
	}
	return securityError("security_state_corrupt", "durable security state is invalid and was quarantined", map[string]any{"name": filepath.Base(state.path), "reason": reason, "quarantine": filepath.Base(target)})
}

func ensureStateParent(path string) error {
	parent := filepath.Dir(path)
	if err := os.MkdirAll(parent, 0o700); err != nil {
		return securityError("security_state_path_unsafe", "durable security state parent cannot be created", map[string]any{"reason": fmt.Sprintf("%T", err)})
	}
	info, err := os.Lstat(parent)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return securityError("security_state_path_unsafe", "durable security state parent must be a regular directory", map[string]any{"name": filepath.Base(path)})
	}
	return nil
}

func atomicWriteState(path string, encoded []byte) error {
	return atomicWriteVersionedState(
		path,
		encoded,
		"replay_state_durability_uncertain",
		"durable replay state committed but directory sync was uncertain",
	)
}

func atomicWriteVersionedState(path string, encoded []byte, uncertainCode, uncertainMessage string) error {
	if err := ensureStateParent(path); err != nil {
		return err
	}
	temporary := filepath.Join(filepath.Dir(path), "."+filepath.Base(path)+".tmp-"+fmt.Sprint(time.Now().UnixNano()))
	file, err := os.OpenFile(temporary, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return securityError("security_state_write_failed", "durable security state write failed before commit", map[string]any{"reason": fmt.Sprintf("%T", err)})
	}
	committed := false
	defer func() {
		_ = file.Close()
		if !committed {
			_ = os.Remove(temporary)
		}
	}()
	if _, err := file.Write(encoded); err != nil {
		return securityError("security_state_write_failed", "durable security state write failed before commit", map[string]any{"reason": fmt.Sprintf("%T", err)})
	}
	if err := file.Sync(); err != nil {
		return securityError("security_state_write_failed", "durable security state write failed before commit", map[string]any{"reason": fmt.Sprintf("%T", err)})
	}
	if err := file.Close(); err != nil {
		return securityError("security_state_write_failed", "durable security state write failed before commit", map[string]any{"reason": fmt.Sprintf("%T", err)})
	}
	if err := atomicReplaceState(temporary, path); err != nil {
		return securityError("security_state_write_failed", "durable security state write failed before commit", map[string]any{"reason": fmt.Sprintf("%T", err)})
	}
	committed = true
	if runtime.GOOS != "windows" {
		directory, err := os.Open(filepath.Dir(path))
		if err != nil {
			return securityError(uncertainCode, uncertainMessage, map[string]any{"reason": fmt.Sprintf("%T", err)})
		}
		defer directory.Close()
		if err := directory.Sync(); err != nil {
			return securityError(uncertainCode, uncertainMessage, map[string]any{"reason": fmt.Sprintf("%T", err)})
		}
	}
	return nil
}

func canonicalJSON(value any) ([]byte, error) {
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		return nil, err
	}
	return bytes.TrimSuffix(buffer.Bytes(), []byte("\n")), nil
}

func requireJSONEOF(decoder *json.Decoder) error {
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return fmt.Errorf("expected EOF")
	}
	return nil
}

func nonceEntries(scope string, nonces map[string]int64) []durableReplayNonce {
	prefix := scope + "\x00"
	entries := make([]durableReplayNonce, 0)
	for key, seenAt := range nonces {
		if strings.HasPrefix(key, prefix) {
			entries = append(entries, durableReplayNonce{SeenAt: seenAt, Value: strings.TrimPrefix(key, prefix)})
		}
	}
	sort.Slice(entries, func(left, right int) bool {
		if entries[left].SeenAt == entries[right].SeenAt {
			return entries[left].Value < entries[right].Value
		}
		return entries[left].SeenAt < entries[right].SeenAt
	})
	return entries
}

func sortedRecords(records map[string]durableReplayRecord) []durableReplayRecord {
	keys := make([]string, 0, len(records))
	for key := range records {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	result := make([]durableReplayRecord, 0, len(keys))
	for _, key := range keys {
		result = append(result, records[key])
	}
	return result
}

func cloneReplayRecords(source map[string]durableReplayRecord) map[string]durableReplayRecord {
	clone := make(map[string]durableReplayRecord, len(source))
	for key, value := range source {
		value.Nonces = append([]durableReplayNonce(nil), value.Nonces...)
		clone[key] = value
	}
	return clone
}
