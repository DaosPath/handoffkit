// Command handoffkit-cpp-tcp-client is a real TLS 1.3 + mTLS framed client
// used by the C++ cross-runtime interoperability gate.
package main

import (
	"crypto/tls"
	"crypto/x509"
	"encoding/binary"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net"
	"os"
	"time"
)

func main() {
	server := flag.Bool("server", false, "run a TLS server instead of a client")
	host := flag.String("host", "127.0.0.1", "TLS host")
	port := flag.Int("port", 0, "TLS port")
	caPath := flag.String("ca", "", "CA PEM")
	certPath := flag.String("cert", "", "certificate PEM")
	keyPath := flag.String("key", "", "private key PEM")
	worker := flag.String("worker", "cpp-ml-worker-interoperability", "worker id")
	source := flag.String("source", "client-peer", "certificate peer id")
	session := flag.String("session", "go-cpp-tcp", "session id")
	nonce := flag.String("nonce", "go-cpp-tcp-nonce", "replay nonce")
	flag.Parse()
	if *port < 1 || *port > 65535 || *caPath == "" || *certPath == "" || *keyPath == "" {
		fatal("usage: handoffkit-cpp-tcp-client --port PORT --ca CA --cert CERT --key KEY")
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
		fatal("load client certificate: %v", err)
	}
	if *server {
		runServer(*host, *port, roots, certificate)
		return
	}
	config := &tls.Config{
		MinVersion:         tls.VersionTLS13,
		MaxVersion:         tls.VersionTLS13,
		ServerName:         "localhost",
		RootCAs:            roots,
		Certificates:       []tls.Certificate{certificate},
		InsecureSkipVerify: false,
	}
	connection, err := tls.DialWithDialer(&net.Dialer{Timeout: 10 * time.Second}, "tcp", fmt.Sprintf("%s:%d", *host, *port), config)
	if err != nil {
		fatal("TLS dial: %v", err)
	}
	defer connection.Close()
	if connection.ConnectionState().Version != tls.VersionTLS13 || !connection.ConnectionState().HandshakeComplete {
		fatal("TLS policy mismatch: version=%x complete=%v", connection.ConnectionState().Version, connection.ConnectionState().HandshakeComplete)
	}

	envelope := map[string]any{
		"protocol_version": "1.0", "message_id": *session + "-1", "session_id": *session,
		"channel": "control", "kind": "worker_capabilities", "source": *source, "target": *worker,
		"sequence": 1, "created_at": time.Now().UTC().Format(time.RFC3339Nano), "deadline": nil,
		"correlation_id": nil, "causation_id": nil, "idempotency_key": *session + "-1", "attempt": 1,
		"requires_ack": false, "payload_type": "worker_capabilities", "payload": map[string]any{},
		"metadata": map[string]any{"nonce": *nonce},
	}
	payload, err := json.Marshal(envelope)
	if err != nil {
		fatal("encode envelope: %v", err)
	}
	if len(payload) > int(^uint32(0)) {
		fatal("envelope too large")
	}
	header := make([]byte, 4)
	binary.BigEndian.PutUint32(header, uint32(len(payload)))
	if _, err = connection.Write(append(header, payload...)); err != nil {
		fatal("write frame: %v", err)
	}
	if _, err = io.ReadFull(connection, header); err != nil {
		fatal("read frame header: %v", err)
	}
	size := binary.BigEndian.Uint32(header)
	if size > 8*1024*1024 {
		fatal("response frame too large: %d", size)
	}
	responseBytes := make([]byte, size)
	if _, err = io.ReadFull(connection, responseBytes); err != nil {
		fatal("read frame: %v", err)
	}
	var response map[string]any
	if err = json.Unmarshal(responseBytes, &response); err != nil {
		fatal("decode response: %v", err)
	}
	if response["kind"] != "worker_capabilities" || response["source"] != *worker {
		fatal("unexpected C++ response: %s", responseBytes)
	}
	encoded, _ := json.Marshal(map[string]any{"runtime": "go", "protocol": "TLSv1.3", "response_kind": response["kind"], "response_source": response["source"]})
	fmt.Println(string(encoded))
}

func fatal(format string, args ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", args...)
	os.Exit(1)
}

func runServer(host string, port int, roots *x509.CertPool, certificate tls.Certificate) {
	config := &tls.Config{
		MinVersion: tls.VersionTLS13, MaxVersion: tls.VersionTLS13,
		Certificates: []tls.Certificate{certificate}, ClientCAs: roots,
		ClientAuth: tls.RequireAndVerifyClientCert,
	}
	listener, err := tls.Listen("tcp", fmt.Sprintf("%s:%d", host, port), config)
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
	if tlsConnection.ConnectionState().Version != tls.VersionTLS13 {
		fatal("TLS policy mismatch: version=%x", tlsConnection.ConnectionState().Version)
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
	binary.BigEndian.PutUint32(header, uint32(len(responseBytes)))
	if _, err = tlsConnection.Write(append(header, responseBytes...)); err != nil {
		fatal("write response: %v", err)
	}
	encoded, _ := json.Marshal(map[string]any{"runtime": "go", "protocol": "TLSv1.3", "authorized": true})
	fmt.Println(string(encoded))
}
