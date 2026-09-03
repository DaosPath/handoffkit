package security

import (
	"errors"
	"sync"
	"time"
)

// CredentialRotationPolicy accepts the current credential and, for one
// bounded transition, the immediately previous credential.
type CredentialRotationPolicy struct {
	mu                  sync.RWMutex
	current             string
	previous            string
	transitionUntil     int64
	maxClockSkewSeconds int64
}

func NewCredentialRotationPolicy(currentFingerprint string, maxClockSkewSeconds int64) (*CredentialRotationPolicy, error) {
	if currentFingerprint == "" {
		return nil, errors.New("current fingerprint must not be empty")
	}
	if maxClockSkewSeconds < 0 {
		return nil, errors.New("max clock skew must not be negative")
	}
	return &CredentialRotationPolicy{
		current:             NormalizeFingerprint(currentFingerprint),
		maxClockSkewSeconds: maxClockSkewSeconds,
	}, nil
}

func (policy *CredentialRotationPolicy) Rotate(newFingerprint string, transitionUntil int64) error {
	if newFingerprint == "" {
		return errors.New("new fingerprint must not be empty")
	}
	if transitionUntil < 0 {
		return errors.New("transition deadline must not be negative")
	}
	policy.mu.Lock()
	defer policy.mu.Unlock()
	policy.previous = policy.current
	policy.current = NormalizeFingerprint(newFingerprint)
	policy.transitionUntil = transitionUntil
	return nil
}

func (policy *CredentialRotationPolicy) IsAllowed(fingerprint string, now int64) bool {
	if now == 0 {
		now = time.Now().Unix()
	}
	normalized := NormalizeFingerprint(fingerprint)
	policy.mu.RLock()
	defer policy.mu.RUnlock()
	return normalized == policy.current || (policy.previous != "" &&
		normalized == policy.previous &&
		now <= policy.transitionUntil+policy.maxClockSkewSeconds)
}

func (policy *CredentialRotationPolicy) SetTransitionUntil(transitionUntil int64) error {
	if transitionUntil < 0 {
		return errors.New("transition deadline must not be negative")
	}
	policy.mu.Lock()
	defer policy.mu.Unlock()
	policy.transitionUntil = transitionUntil
	return nil
}

func (policy *CredentialRotationPolicy) Status(now int64) map[string]any {
	if now == 0 {
		now = time.Now().Unix()
	}
	policy.mu.RLock()
	defer policy.mu.RUnlock()
	return map[string]any{
		"current_fingerprint":  policy.current,
		"previous_fingerprint": nullableString(policy.previous),
		"transition_until":     policy.transitionUntil,
		"previous_accepted": policy.previous != "" &&
			now <= policy.transitionUntil+policy.maxClockSkewSeconds,
	}
}

func nullableString(value string) any {
	if value == "" {
		return nil
	}
	return value
}
