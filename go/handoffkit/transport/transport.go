package transport

import (
	"bufio"
	"context"
	"crypto/tls"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os/exec"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/DaosPath/handoffkit/go/contract"
	"github.com/DaosPath/handoffkit/go/security"
)

type Config struct {
	MaxMessageBytes  int
	ConnectTimeout   time.Duration
	IOTimeout        time.Duration
	RetryPolicy      contract.RetryPolicy
	SecurityConfig   *security.SecurityConfig
	IdentityPolicy   *security.CertificateIdentityPolicy
	CapabilityPolicy *security.CapabilityPolicy
	ReplayProtection *security.ReplayProtection
	ServerName       string
}

func DefaultConfig() Config {
	return Config{
		MaxMessageBytes: contract.DefaultMaxMessageBytes,
		ConnectTimeout:  5 * time.Second,
		IOTimeout:       30 * time.Second,
		RetryPolicy:     contract.DefaultRetryPolicy(),
		SecurityConfig:  security.NewDefaultSecurityConfig(),
	}
}

func (c Config) Validate() error {
	if c.MaxMessageBytes < contract.MinMessageBytes || c.MaxMessageBytes > contract.DefaultMaxMessageBytes {
		return errors.New("max message bytes is outside protocol limits")
	}
	if c.ConnectTimeout <= 0 || c.IOTimeout <= 0 {
		return errors.New("network timeouts must be positive")
	}
	if c.SecurityConfig != nil {
		switch c.SecurityConfig.Profile {
		case security.SecurityProfileLocal, security.SecurityProfileStandard:
		case security.SecurityProfileHybridPQ:
			if !security.DetectHybridPQSupport() {
				return &security.SecurityError{
					Code:    "security_profile_unavailable",
					Message: "hybrid-pq is unavailable in the active Go crypto/tls provider",
					Details: map[string]any{
						"profile":        c.SecurityConfig.Profile,
						"required_group": "X25519MLKEM768",
					},
				}
			}
		case security.SecurityProfileResearch:
			return &security.SecurityError{
				Code:    "security_profile_unavailable",
				Message: "research security profile has no production TLS provider",
				Details: map[string]any{"profile": c.SecurityConfig.Profile},
			}
		default:
			return &security.SecurityError{
				Code:    "security_profile_unavailable",
				Message: "security profile is not recognized by this runtime",
				Details: map[string]any{"profile": c.SecurityConfig.Profile},
			}
		}
	}
	if c.secure() {
		if c.IdentityPolicy == nil || c.CapabilityPolicy == nil || c.ReplayProtection == nil {
			return errors.New("secure network transport requires identity, capability, and replay policies")
		}
		if c.IdentityPolicy.TrustDomain != c.SecurityConfig.TrustDomain {
			return errors.New("identity policy trust domain must match security config")
		}
	}
	return c.RetryPolicy.Validate()
}

func (c Config) secure() bool {
	return c.SecurityConfig != nil && (c.SecurityConfig.Profile == security.SecurityProfileStandard || c.SecurityConfig.Profile == security.SecurityProfileHybridPQ)
}

type NDJSON struct {
	reader *bufio.Reader
	writer io.Writer
	closer io.Closer
	max    int
	sendMu sync.Mutex
	recvMu sync.Mutex
	closed atomic.Bool
}

func NewNDJSON(reader io.Reader, writer io.Writer, closer io.Closer, maxMessageBytes int) (*NDJSON, error) {
	if maxMessageBytes < contract.MinMessageBytes || maxMessageBytes > contract.DefaultMaxMessageBytes {
		return nil, errors.New("max message bytes is outside protocol limits")
	}
	return &NDJSON{reader: bufio.NewReaderSize(reader, 64*1024), writer: writer, closer: closer, max: maxMessageBytes}, nil
}

func (t *NDJSON) Send(ctx context.Context, envelope contract.MessageEnvelope) error {
	if t.closed.Load() {
		return errors.New("transport is closed")
	}
	data, err := envelope.Encode()
	if err != nil {
		return err
	}
	data = append(data, '\n')
	if len(data) > t.max {
		return fmt.Errorf("NDJSON frame exceeds %d bytes", t.max)
	}
	t.sendMu.Lock()
	defer t.sendMu.Unlock()
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}
	for len(data) > 0 {
		written, writeErr := t.writer.Write(data)
		if writeErr != nil {
			return writeErr
		}
		if written == 0 {
			return io.ErrShortWrite
		}
		data = data[written:]
	}
	return nil
}

func (t *NDJSON) Receive(ctx context.Context) (contract.MessageEnvelope, error) {
	if t.closed.Load() {
		return contract.MessageEnvelope{}, errors.New("transport is closed")
	}
	t.recvMu.Lock()
	defer t.recvMu.Unlock()
	select {
	case <-ctx.Done():
		return contract.MessageEnvelope{}, ctx.Err()
	default:
	}
	data, err := readLineBounded(t.reader, t.max)
	if err != nil {
		return contract.MessageEnvelope{}, err
	}
	return contract.DecodeEnvelope(data)
}

func (t *NDJSON) Close() error {
	if !t.closed.CompareAndSwap(false, true) || t.closer == nil {
		return nil
	}
	return t.closer.Close()
}

type LengthDelimited struct {
	connection        net.Conn
	config            Config
	AuthenticatedPeer *security.PeerIdentity
	sendMu            sync.Mutex
	recvMu            sync.Mutex
	closed            atomic.Bool
}

func NewLengthDelimited(connection net.Conn, config Config) (*LengthDelimited, error) {
	if err := config.Validate(); err != nil {
		return nil, err
	}
	transport := &LengthDelimited{connection: connection, config: config}
	if config.secure() {
		tlsConnection, ok := connection.(*tls.Conn)
		if !ok {
			return nil, &security.SecurityError{Code: "tls_required", Message: "secure network transport requires a TLS connection", Details: map[string]any{}}
		}
		if err := tlsConnection.SetDeadline(time.Now().Add(config.ConnectTimeout)); err != nil {
			return nil, err
		}
		peer, err := security.AuthenticateTLSConnection(tlsConnection, config.IdentityPolicy)
		if clearErr := tlsConnection.SetDeadline(time.Time{}); err == nil && clearErr != nil {
			err = clearErr
		}
		if err != nil {
			return nil, err
		}
		if config.SecurityConfig.Profile == security.SecurityProfileHybridPQ && !hybridPQNegotiated(tlsConnection) {
			return nil, &security.SecurityError{
				Code:    "security_profile_mismatch",
				Message: "TLS connection did not negotiate the required hybrid-pq group",
				Details: map[string]any{"required_group": "X25519MLKEM768"},
			}
		}
		transport.AuthenticatedPeer = peer
	}
	return transport, nil
}

func (t *LengthDelimited) Send(ctx context.Context, envelope contract.MessageEnvelope) error {
	if t.closed.Load() {
		return errors.New("transport is closed")
	}
	payload, err := envelope.Encode()
	if err != nil {
		return err
	}
	if len(payload) > t.config.MaxMessageBytes {
		return fmt.Errorf("network frame exceeds %d bytes", t.config.MaxMessageBytes)
	}
	frame := make([]byte, 4+len(payload))
	binary.BigEndian.PutUint32(frame[:4], uint32(len(payload)))
	copy(frame[4:], payload)
	t.sendMu.Lock()
	defer t.sendMu.Unlock()
	return t.writeContext(ctx, frame)
}

func (t *LengthDelimited) Receive(ctx context.Context) (contract.MessageEnvelope, error) {
	if t.closed.Load() {
		return contract.MessageEnvelope{}, errors.New("transport is closed")
	}
	t.recvMu.Lock()
	defer t.recvMu.Unlock()
	header := make([]byte, 4)
	if err := t.readContext(ctx, header); err != nil {
		return contract.MessageEnvelope{}, err
	}
	size := int(binary.BigEndian.Uint32(header))
	if size > t.config.MaxMessageBytes {
		return contract.MessageEnvelope{}, fmt.Errorf("network frame exceeds %d bytes", t.config.MaxMessageBytes)
	}
	payload := make([]byte, size)
	if err := t.readContext(ctx, payload); err != nil {
		return contract.MessageEnvelope{}, err
	}
	envelope, err := contract.DecodeEnvelope(payload)
	if err != nil {
		return contract.MessageEnvelope{}, err
	}
	if err := t.validateSecureEnvelope(envelope); err != nil {
		return contract.MessageEnvelope{}, err
	}
	return envelope, nil
}

func (t *LengthDelimited) validateSecureEnvelope(envelope contract.MessageEnvelope) error {
	if !t.config.secure() {
		return nil
	}
	if t.AuthenticatedPeer == nil {
		return &security.SecurityError{Code: "authenticated_peer_missing", Message: "secure envelope has no authenticated transport peer", Details: map[string]any{}}
	}
	declaredValue, ok := envelope.Metadata["peer_identity"]
	if !ok {
		return &security.SecurityError{Code: "declared_identity_missing", Message: "secure envelope requires peer_identity", Details: map[string]any{}}
	}
	encoded, err := json.Marshal(declaredValue)
	if err != nil {
		return &security.SecurityError{Code: "declared_identity_invalid", Message: "declared peer_identity is invalid", Details: map[string]any{}}
	}
	var declared security.PeerIdentity
	if err := json.Unmarshal(encoded, &declared); err != nil {
		return &security.SecurityError{Code: "declared_identity_invalid", Message: "declared peer_identity is invalid", Details: map[string]any{}}
	}
	if err := security.ValidateDeclaredPeerIdentity(t.AuthenticatedPeer, &declared); err != nil {
		return err
	}
	if envelope.Source != t.AuthenticatedPeer.PeerID {
		return &security.SecurityError{Code: "declared_identity_mismatch", Message: "envelope source does not match authenticated peer_id", Details: map[string]any{"fields": []string{"peer_id"}}}
	}
	nonce, ok := envelope.Metadata["security_nonce"].(string)
	if !ok || nonce == "" || len(nonce) > 256 {
		return &security.SecurityError{Code: "security_nonce_missing", Message: "secure envelope requires a bounded non-empty security_nonce", Details: map[string]any{}}
	}
	createdAt, err := time.Parse(time.RFC3339Nano, envelope.CreatedAt)
	if err != nil {
		return err
	}
	scope := t.AuthenticatedPeer.CredentialFingerprint + "|" + envelope.SessionID
	if err := t.config.ReplayProtection.CheckAndRecord(scope, envelope.Sequence, nonce, createdAt.Unix()); err != nil {
		return err
	}
	operation, ok := envelope.Metadata["operation"].(string)
	if !ok || strings.TrimSpace(operation) == "" {
		return &security.SecurityError{Code: "operation_missing", Message: "secure envelope requires an explicit operation", Details: map[string]any{}}
	}
	if !t.config.CapabilityPolicy.IsOperationAuthorized(operation, t.AuthenticatedPeer) {
		return &security.SecurityError{Code: "authorization_denied", Message: "authenticated peer is not authorized for operation", Details: map[string]any{"peer_id": t.AuthenticatedPeer.PeerID, "operation": operation}}
	}
	return nil
}

func (t *LengthDelimited) writeContext(ctx context.Context, payload []byte) error {
	deadline := time.Now().Add(t.config.IOTimeout)
	if contextDeadline, ok := ctx.Deadline(); ok && contextDeadline.Before(deadline) {
		deadline = contextDeadline
	}
	if err := t.connection.SetWriteDeadline(deadline); err != nil {
		return err
	}
	for len(payload) > 0 {
		written, err := t.connection.Write(payload)
		if err != nil {
			return err
		}
		payload = payload[written:]
	}
	return nil
}

func (t *LengthDelimited) readContext(ctx context.Context, payload []byte) error {
	deadline := time.Now().Add(t.config.IOTimeout)
	if contextDeadline, ok := ctx.Deadline(); ok && contextDeadline.Before(deadline) {
		deadline = contextDeadline
	}
	if err := t.connection.SetReadDeadline(deadline); err != nil {
		return err
	}
	_, err := io.ReadFull(t.connection, payload)
	return err
}

func (t *LengthDelimited) Close() error {
	if !t.closed.CompareAndSwap(false, true) {
		return nil
	}
	return t.connection.Close()
}

func (t *LengthDelimited) TLSState() (tls.ConnectionState, bool) {
	connection, ok := t.connection.(*tls.Conn)
	if !ok {
		return tls.ConnectionState{}, false
	}
	return connection.ConnectionState(), true
}

func DialTCP(ctx context.Context, address string, config Config) (*LengthDelimited, error) {
	return dial(ctx, "tcp", address, config)
}

func ListenTCP(address string, config Config) (net.Listener, error) {
	if err := config.Validate(); err != nil {
		return nil, err
	}
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return nil, err
	}
	securityConfig := config.SecurityConfig
	if securityConfig == nil {
		securityConfig = security.NewDefaultSecurityConfig()
	}
	if err := securityConfig.ValidateListenAddress(host); err != nil {
		return nil, err
	}
	listener, err := net.Listen("tcp", address)
	if err != nil {
		return nil, err
	}
	tlsConfig, err := security.BuildTLSConfig(securityConfig, true)
	if err != nil {
		_ = listener.Close()
		return nil, err
	}
	if tlsConfig != nil {
		return tls.NewListener(listener, tlsConfig), nil
	}
	return listener, nil
}

func DialUnix(ctx context.Context, path string, config Config) (*LengthDelimited, error) {
	return dial(ctx, "unix", path, config)
}

func DialTCPWithRetry(ctx context.Context, address string, config Config) (*LengthDelimited, error) {
	if err := config.Validate(); err != nil {
		return nil, err
	}
	var last error
	for attempt := 1; attempt <= config.RetryPolicy.MaxAttempts; attempt++ {
		transport, err := DialTCP(ctx, address, config)
		if err == nil {
			return transport, nil
		}
		last = err
		if attempt == config.RetryPolicy.MaxAttempts {
			break
		}
		delay := config.RetryPolicy.BaseDelayMS << (attempt - 1)
		if delay > config.RetryPolicy.MaxDelayMS {
			delay = config.RetryPolicy.MaxDelayMS
		}
		timer := time.NewTimer(time.Duration(delay) * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil, ctx.Err()
		case <-timer.C:
		}
	}
	return nil, fmt.Errorf("TCP connection failed after retries: %s", contract.SanitizeError(last.Error()))
}

func dial(ctx context.Context, network, address string, config Config) (*LengthDelimited, error) {
	if err := config.Validate(); err != nil {
		return nil, err
	}
	if network != "tcp" && config.secure() {
		return nil, errors.New("secure profiles are supported only by the TCP transport")
	}
	dialer := net.Dialer{Timeout: config.ConnectTimeout}
	connection, err := dialer.DialContext(ctx, network, address)
	if err != nil {
		return nil, err
	}
	if network == "tcp" {
		securityConfig := config.SecurityConfig
		if securityConfig == nil {
			securityConfig = security.NewDefaultSecurityConfig()
		}
		serverName := config.ServerName
		if serverName == "" {
			serverName, _, err = net.SplitHostPort(address)
			if err != nil {
				_ = connection.Close()
				return nil, err
			}
		}
		tlsConfig, tlsErr := security.BuildTLSConfig(securityConfig, false, serverName)
		if tlsErr != nil {
			_ = connection.Close()
			return nil, tlsErr
		}
		if tlsConfig != nil {
			connection = tls.Client(connection, tlsConfig)
		}
	}
	transport, err := NewLengthDelimited(connection, config)
	if err != nil {
		_ = connection.Close()
		return nil, err
	}
	return transport, nil
}

type Subprocess struct {
	*NDJSON
	command *exec.Cmd
	stdin   io.WriteCloser
}

func Spawn(ctx context.Context, argv []string, maxMessageBytes int) (*Subprocess, error) {
	if len(argv) == 0 {
		return nil, errors.New("argv must not be empty")
	}
	command := exec.CommandContext(ctx, argv[0], argv[1:]...)
	stdin, err := command.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := command.StdoutPipe()
	if err != nil {
		return nil, err
	}
	command.Stderr = io.Discard
	if err := command.Start(); err != nil {
		return nil, err
	}
	ndjson, err := NewNDJSON(stdout, stdin, stdin, maxMessageBytes)
	if err != nil {
		_ = command.Process.Kill()
		return nil, err
	}
	return &Subprocess{NDJSON: ndjson, command: command, stdin: stdin}, nil
}

func (s *Subprocess) Close() error {
	_ = s.NDJSON.Close()
	done := make(chan error, 1)
	go func() { done <- s.command.Wait() }()
	select {
	case <-time.After(2 * time.Second):
		_ = s.command.Process.Kill()
		<-done
		return nil
	case err := <-done:
		return err
	}
}

func readLineBounded(reader *bufio.Reader, maximum int) ([]byte, error) {
	line := make([]byte, 0, min(maximum, 64*1024))
	for {
		chunk, err := reader.ReadSlice('\n')
		if len(line)+len(chunk) > maximum {
			return nil, fmt.Errorf("NDJSON frame exceeds %d bytes", maximum)
		}
		line = append(line, chunk...)
		if err == nil {
			line = line[:len(line)-1]
			if len(line) > 0 && line[len(line)-1] == '\r' {
				line = line[:len(line)-1]
			}
			if len(line) == 0 {
				continue
			}
			return line, nil
		}
		if errors.Is(err, bufio.ErrBufferFull) {
			continue
		}
		if errors.Is(err, io.EOF) {
			return nil, io.EOF
		}
		return nil, err
	}
}
