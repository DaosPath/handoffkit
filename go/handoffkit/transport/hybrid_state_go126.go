//go:build go1.26

package transport

import "crypto/tls"

func hybridPQNegotiated(connection *tls.Conn) bool {
	state := connection.ConnectionState()
	return state.Version == tls.VersionTLS13 && state.CurveID == tls.X25519MLKEM768
}
