//go:build !go1.26

package security

// Older supported toolchains cannot attest the negotiated hybrid group.
const canObserveNegotiatedHybridPQ = false
