// Command handoffkit-cpp-tcp-server is an independent real TLS 1.3 + mTLS
// framed reverse server used by the C++ cross-runtime interoperability gate.
// It loads the CA/cert/key, requires and verifies a client certificate,
// accepts a single connection, reads one uint32 big-endian framed HK-CSP JSON
// request, replies with an interop_echo response, prints one JSON evidence
// line, and exits.
package main

import (
	"crypto/tls"
	"crypto/x509"
	"encoding/binary"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"time"
)

func main() {
	host := flag.String("host", "127.0.0.1", "TLS listen host")
	port := flag.Int("port", 0, "TLS listen port")
	caPath := flag.String("ca", "", "CA PEM used to verify the client certificate")
	certPath := flag.String("cert", "", "server certificate PEM")
	keyPath := flag.String("key", "", "server private key PEM")
	flag.Parse()
	if *port < 1 || *port > 65535 || *caPath == "" || *certPath == "" || *keyPath == "" {
		fatal("usage: handoffkit-cpp-tcp-server --port PORT --ca CA --cert CERT --key KEY")
	}

	caBytes, err := os.ReadFile(*caPath)
	if err != nil {
		fatal("read CA: %v", err)
	}
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM(caBytes) {
		fatal("CA PEM contains no usable certificate")
	}
	certificate, err := tls.LoadX509KeyPair(*certPath, *keyPath)
	if err != nil {
		fatal("load server certificate: %v", err)
	}

	config := &tls.Config{
		MinVersion:   tls.VersionTLS13,
		MaxVersion:   tls.VersionTLS13,
		Certificates: []tls.Certificate{certificate},
		ClientCAs:    roots,
		ClientAuth:   tls.RequireAndVerifyClientCert,
	}
	listener, err := tls.Listen("tcp", fmt.Sprintf("%s:%d", *host, *port), config)
	if err != nil {
		fatal("TLS listen: %v", err)
	}
	defer listener.Close()

	connection, err := listener.Accept()
	if err != nil {
		fatal("TLS accept: %v", err)
	}
	defer connection.Close()
	tlsConnection, ok := connection.(*tls.Conn)
	if !ok {
		fatal("TLS listener returned an unexpected connection type")
	}
	if err = tlsConnection.Handshake(); err != nil {
		fatal("TLS handshake: %v", err)
	}
	state := tlsConnection.ConnectionState()
	if state.Version != tls.VersionTLS13 || !state.HandshakeComplete {
		fatal("TLS policy mismatch: version=%x complete=%v", state.Version, state.HandshakeComplete)
	}
	if len(state.PeerCertificates) == 0 {
		fatal("TLS policy mismatch: no verified client certificate")
	}

	header := make([]byte, 4)
	if _, err = io.ReadFull(tlsConnection, header); err != nil {
		fatal("read request header: %v", err)
	}
	size := binary.BigEndian.Uint32(header)
	if size > 8*1024*1024 {
		fatal("request frame too large: %d", size)
	}
	requestBytes := make([]byte, size)
	if _, err = io.ReadFull(tlsConnection, requestBytes); err != nil {
		fatal("read request: %v", err)
	}
	var request map[string]any
	if err = json.Unmarshal(requestBytes, &request); err != nil {
		fatal("decode request: %v", err)
	}

	response := map[string]any{
		"protocol_version": "1.0", "message_id": "go-reverse-response",
		"session_id": request["session_id"], "channel": "control", "kind": "interop_echo",
		"source": "go-server", "target": request["source"], "sequence": 1,
		"created_at": time.Now().UTC().Format(time.RFC3339Nano), "deadline": nil,
		"correlation_id": request["message_id"], "causation_id": request["message_id"],
		"idempotency_key": request["idempotency_key"], "attempt": 1, "requires_ack": false,
		"payload_type": "interop_echo", "payload": map[string]any{"runtime": "go", "request_kind": request["kind"]},
		"metadata": map[string]any{"nonce": "go-reverse-response"},
	}
	responseBytes, err := json.Marshal(response)
	if err != nil {
		fatal("encode response: %v", err)
	}
	if len(responseBytes) > int(^uint32(0)) {
		fatal("response too large")
	}
	binary.BigEndian.PutUint32(header, uint32(len(responseBytes)))
	if _, err = tlsConnection.Write(append(header, responseBytes...)); err != nil {
		fatal("write response: %v", err)
	}
	evidence, _ := json.Marshal(map[string]any{"runtime": "go", "protocol": "TLSv1.3", "authorized": true})
	fmt.Println(string(evidence))
}

func fatal(format string, args ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", args...)
	os.Exit(1)
}
