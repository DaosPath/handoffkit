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
	TLSProvider      *security.ReloadableTLSConfig
	ServerName       string
	now              func() time.Time
}

type tlsIdentityConnection struct {
	*tls.Conn
	localIdentity *security.PeerIdentity
}

type tlsSnapshotListener struct {
	net.Listener
	fixed    *tls.Config
	provider *security.ReloadableTLSConfig
}

func (listener *tlsSnapshotListener) Accept() (net.Conn, error) {
	connection, err := listener.Listener.Accept()
	if err != nil {
		return nil, err
	}
	var tlsConfig *tls.Config
	var identity *security.PeerIdentity
	if listener.provider != nil {
		tlsConfig, identity, err = listener.provider.ServerSnapshot(nil)
	} else {
		tlsConfig = listener.fixed.Clone()
		identity, err = security.PeerIdentityFromTLSConfig(tlsConfig, nil)
	}
	if err != nil {
		_ = connection.Close()
		return nil, err
	}
	return &tlsIdentityConnection{
		Conn:          tls.Server(connection, tlsConfig),
		localIdentity: identity,
	}, nil
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

func (c Config) currentTime() time.Time {
	if c.now != nil {
		return c.now()
	}
	return time.Now()
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
	localIdentity     *security.PeerIdentity
	tlsVersion        string
	sendMu            sync.Mutex
	recvMu            sync.Mutex
	closed            atomic.Bool
}

type SecurityObservation struct {
	TLSVersion                 string
	NegotiatedGroup            *string
	SecurityProfile            security.SecurityProfile
	HybridPQProviderSupported  bool
	RevocationPolicyConfigured bool
	RevocationState            string
	RotationStatus             map[string]any
}

func (t *LengthDelimited) LocalIdentity() *security.PeerIdentity {
	return t.localIdentity
}

func NewLengthDelimited(connection net.Conn, config Config) (*LengthDelimited, error) {
	if err := config.Validate(); err != nil {
		return nil, err
	}
	transport := &LengthDelimited{connection: connection, config: config}
	if config.secure() {
		var tlsConnection *tls.Conn
		var snapshotIdentity *security.PeerIdentity
		switch typed := connection.(type) {
		case *tls.Conn:
			tlsConnection = typed
		case *tlsIdentityConnection:
			tlsConnection = typed.Conn
			snapshotIdentity = typed.localIdentity
		}
		ok := tlsConnection != nil
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
		if snapshotIdentity != nil {
			transport.localIdentity = snapshotIdentity
		} else if config.TLSProvider != nil {
			transport.localIdentity, err = config.TLSProvider.LocalIdentity(nil)
		} else if config.SecurityConfig.CertPath != "" {
			transport.localIdentity, err = security.PeerIdentityFromCertificatePath(config.SecurityConfig.CertPath, nil)
		}
		if err != nil {
			return nil, err
		}
		transport.tlsVersion = "TLSv1.3"
	}
	return transport, nil
}

func (t *LengthDelimited) Send(ctx context.Context, envelope contract.MessageEnvelope) error {
	if t.closed.Load() {
		return errors.New("transport is closed")
	}
	var err error
	if t.AuthenticatedPeer != nil && t.localIdentity != nil {
		envelope, err = t.withSecurityTranscript(envelope)
		if err != nil {
			return err
		}
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
	if err := t.validateLivePeerCredential(); err != nil {
		return err
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
	transcriptValue, ok := envelope.Metadata["security_transcript"]
	if !ok {
		return &security.SecurityError{Code: "security_transcript_missing", Message: "secure envelope requires an authenticated security_transcript extension", Details: map[string]any{}}
	}
	if t.localIdentity == nil || t.tlsVersion == "" {
		return &security.SecurityError{Code: "security_transcript_unavailable", Message: "secure transcript requires authenticated TLS endpoints", Details: map[string]any{}}
	}
	if _, err := security.VerifySecurityTranscript(transcriptValue, security.SecurityTranscriptInput{
		ProtocolVersion:  envelope.ProtocolVersion,
		RequestedProfile: t.config.SecurityConfig.Profile,
		SelectedProfile:  t.config.SecurityConfig.Profile,
		Sender:           t.AuthenticatedPeer,
		Receiver:         t.localIdentity,
		TLSVersion:       t.tlsVersion,
		NegotiatedGroup:  t.negotiatedGroup(),
		SessionID:        envelope.SessionID,
		HandshakeNonce:   nonce,
		Timestamp:        envelope.CreatedAt,
	}); err != nil {
		return err
	}
	createdAt, err := time.Parse(time.RFC3339Nano, envelope.CreatedAt)
	if err != nil {
		return err
	}
	scope := t.AuthenticatedPeer.CredentialFingerprint + "|" + envelope.SessionID
	if err := t.config.ReplayProtection.CheckAndRecordContext(
		scope,
		envelope.Sequence,
		nonce,
		createdAt.Unix(),
		&security.ReplayContext{
			PeerID:                t.AuthenticatedPeer.PeerID,
			SessionID:             envelope.SessionID,
			CredentialFingerprint: t.AuthenticatedPeer.CredentialFingerprint,
			SecurityProfile:       string(t.config.SecurityConfig.Profile),
		},
	); err != nil {
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

func (t *LengthDelimited) validateLivePeerCredential() error {
	peer := t.AuthenticatedPeer
	policy := t.config.IdentityPolicy
	if peer == nil || policy == nil {
		return &security.SecurityError{Code: "authenticated_peer_missing", Message: "secure envelope has no authenticated peer policy", Details: map[string]any{}}
	}
	now := t.config.currentTime().Unix()
	if !peer.IsValidAt(now) {
		return &security.SecurityError{Code: "credential_expired", Message: "authenticated TLS certificate is outside its validity period", Details: map[string]any{}}
	}
	fingerprint := security.NormalizeFingerprint(peer.CredentialFingerprint)
	if policy.RevokedFingerprints[fingerprint] {
		return &security.SecurityError{Code: "credential_revoked", Message: "authenticated TLS certificate is revoked by local policy", Details: map[string]any{}}
	}
	if policy.RevocationPolicy != nil {
		checks := []struct {
			kind  security.RevocationKind
			value string
		}{
			{security.RevocationCertificateFingerprint, fingerprint},
			{security.RevocationPeerID, peer.PeerID},
			{security.RevocationTrustDomain, peer.TrustDomain},
		}
		if state, ok := t.TLSState(); ok && len(state.PeerCertificates) > 0 {
			checks = append(checks, struct {
				kind  security.RevocationKind
				value string
			}{security.RevocationIssuer, state.PeerCertificates[0].Issuer.String()})
		}
		for _, check := range checks {
			revoked, err := policy.RevocationPolicy.IsRevoked(check.kind, check.value, now)
			if err != nil {
				return err
			}
			if revoked {
				return &security.SecurityError{Code: "credential_revoked", Message: "authenticated TLS identity is revoked by durable local policy", Details: map[string]any{}}
			}
		}
	}
	if policy.RotationPolicy != nil && !policy.RotationPolicy.IsAllowed(fingerprint, now) {
		return &security.SecurityError{Code: "credential_rotation_rejected", Message: "authenticated TLS credential is outside the configured rotation window", Details: map[string]any{}}
	}
	return nil
}

func (t *LengthDelimited) withSecurityTranscript(envelope contract.MessageEnvelope) (contract.MessageEnvelope, error) {
	declaredValue, ok := envelope.Metadata["peer_identity"]
	if !ok {
		return contract.MessageEnvelope{}, &security.SecurityError{Code: "declared_identity_missing", Message: "secure envelope requires peer_identity", Details: map[string]any{}}
	}
	encoded, err := json.Marshal(declaredValue)
	if err != nil {
		return contract.MessageEnvelope{}, err
	}
	var declared security.PeerIdentity
	if err := json.Unmarshal(encoded, &declared); err != nil {
		return contract.MessageEnvelope{}, err
	}
	nonce, ok := envelope.Metadata["security_nonce"].(string)
	if !ok || nonce == "" || len(nonce) > 256 {
		return contract.MessageEnvelope{}, &security.SecurityError{Code: "security_nonce_missing", Message: "secure envelope requires a bounded non-empty security_nonce", Details: map[string]any{}}
	}
	sender := *t.localIdentity
	sender.Capabilities = append([]string(nil), declared.Capabilities...)
	transcript, err := security.BuildSecurityTranscript(security.SecurityTranscriptInput{
		ProtocolVersion:  envelope.ProtocolVersion,
		RequestedProfile: t.config.SecurityConfig.Profile,
		SelectedProfile:  t.config.SecurityConfig.Profile,
		Sender:           &sender,
		Receiver:         t.AuthenticatedPeer,
		TLSVersion:       t.tlsVersion,
		NegotiatedGroup:  t.negotiatedGroup(),
		SessionID:        envelope.SessionID,
		HandshakeNonce:   nonce,
		Timestamp:        envelope.CreatedAt,
	})
	if err != nil {
		return contract.MessageEnvelope{}, err
	}
	metadata := make(map[string]any, len(envelope.Metadata)+1)
	for key, value := range envelope.Metadata {
		metadata[key] = value
	}
	metadata["security_transcript"] = transcript
	envelope.Metadata = metadata
	return envelope, nil
}

func (t *LengthDelimited) negotiatedGroup() *string {
	if t.config.SecurityConfig.Profile != security.SecurityProfileHybridPQ {
		return nil
	}
	group := "X25519MLKEM768"
	return &group
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
	var connection *tls.Conn
	switch typed := t.connection.(type) {
	case *tls.Conn:
		connection = typed
	case *tlsIdentityConnection:
		connection = typed.Conn
	}
	if connection == nil {
		return tls.ConnectionState{}, false
	}
	return connection.ConnectionState(), true
}

func (t *LengthDelimited) SecurityObservation() (SecurityObservation, bool) {
	if t.AuthenticatedPeer == nil || t.config.SecurityConfig == nil || t.tlsVersion == "" {
		return SecurityObservation{}, false
	}
	revocationState := "not-configured"
	if t.config.IdentityPolicy != nil && t.config.IdentityPolicy.RevocationPolicy != nil {
		revocationState = "not-revoked"
	}
	var rotationStatus map[string]any
	if t.config.IdentityPolicy != nil && t.config.IdentityPolicy.RotationPolicy != nil {
		rotationStatus = t.config.IdentityPolicy.RotationPolicy.Status(t.config.currentTime().Unix())
	}
	return SecurityObservation{
		TLSVersion:                 t.tlsVersion,
		NegotiatedGroup:            t.negotiatedGroup(),
		SecurityProfile:            t.config.SecurityConfig.Profile,
		HybridPQProviderSupported:  security.DetectHybridPQSupport(),
		RevocationPolicyConfigured: t.config.IdentityPolicy != nil && t.config.IdentityPolicy.RevocationPolicy != nil,
		RevocationState:            revocationState,
		RotationStatus:             rotationStatus,
	}, true
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
	var tlsConfig *tls.Config
	if config.TLSProvider != nil {
		tlsConfig, err = config.TLSProvider.ServerConfig()
	} else {
		tlsConfig, err = security.BuildTLSConfig(securityConfig, true)
	}
	if err != nil {
		_ = listener.Close()
		return nil, err
	}
	if tlsConfig != nil {
		return &tlsSnapshotListener{
			Listener: listener,
			fixed:    tlsConfig,
			provider: config.TLSProvider,
		}, nil
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
		var tlsConfig *tls.Config
		var tlsErr error
		var localIdentity *security.PeerIdentity
		if config.TLSProvider != nil {
			tlsConfig, localIdentity, tlsErr = config.TLSProvider.ClientSnapshot(serverName, nil)
		} else {
			tlsConfig, tlsErr = security.BuildTLSConfig(securityConfig, false, serverName)
			if tlsErr == nil && tlsConfig != nil && len(tlsConfig.Certificates) > 0 {
				localIdentity, tlsErr = security.PeerIdentityFromTLSConfig(tlsConfig, nil)
			}
		}
		if tlsErr != nil {
			_ = connection.Close()
			return nil, tlsErr
		}
		if tlsConfig != nil {
			connection = &tlsIdentityConnection{
				Conn:          tls.Client(connection, tlsConfig),
				localIdentity: localIdentity,
			}
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
	command   *exec.Cmd
	stdin     io.WriteCloser
	stderr    *boundedProcessBuffer
	closeOnce sync.Once
	closeDone chan struct{}
	closeErr  error
}

type boundedProcessBuffer struct {
	mu   sync.Mutex
	data []byte
	max  int
}

func (buffer *boundedProcessBuffer) Write(value []byte) (int, error) {
	buffer.mu.Lock()
	defer buffer.mu.Unlock()
	remaining := buffer.max - len(buffer.data)
	if remaining > 0 {
		buffer.data = append(buffer.data, value[:min(len(value), remaining)]...)
	}
	return len(value), nil
}

func (buffer *boundedProcessBuffer) String() string {
	buffer.mu.Lock()
	defer buffer.mu.Unlock()
	return contract.SanitizeError(string(buffer.data))
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
	stderr := &boundedProcessBuffer{max: 4096}
	command.Stderr = stderr
	if err := command.Start(); err != nil {
		return nil, err
	}
	ndjson, err := NewNDJSON(stdout, stdin, stdin, maxMessageBytes)
	if err != nil {
		_ = command.Process.Kill()
		return nil, err
	}
	return &Subprocess{
		NDJSON: ndjson, command: command, stdin: stdin, stderr: stderr, closeDone: make(chan struct{}),
	}, nil
}

func (s *Subprocess) Close() error {
	s.closeOnce.Do(func() {
		_ = s.NDJSON.Close()
		done := make(chan error, 1)
		go func() { done <- s.command.Wait() }()
		select {
		case <-time.After(2 * time.Second):
			_ = s.command.Process.Kill()
			s.closeErr = <-done
		case err := <-done:
			s.closeErr = err
		}
		close(s.closeDone)
	})
	<-s.closeDone
	return s.closeErr
}

// Terminate stops a local subprocess immediately. It is used by supervisors
// after a worker crash or an unresponsive shutdown; no shell is involved.
func (s *Subprocess) Terminate() error {
	if s.command.Process == nil {
		return nil
	}
	return s.command.Process.Kill()
}

// Stderr returns a bounded, sanitized diagnostic captured from the local
// subprocess. It must not be forwarded directly to an untrusted peer.
func (s *Subprocess) Stderr() string {
	if s.stderr == nil {
		return ""
	}
	return s.stderr.String()
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
