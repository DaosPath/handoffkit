//go:build go1.26

package security

// Go 1.26 exposes the negotiated TLS group through ConnectionState.CurveID.
const canObserveNegotiatedHybridPQ = true
