//go:build !go1.26

package transport

import "crypto/tls"

func hybridPQNegotiated(_ *tls.Conn) bool {
	return false
}
