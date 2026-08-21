package real

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"

	"github.com/DaosPath/handoffkit/go/contract"
	"github.com/DaosPath/handoffkit/go/security"
	"github.com/DaosPath/handoffkit/go/transport"
)

const (
	ControlChannel   = "browser.control"
	ControlOperation = "browser:control"
)

// Client talks Browser Core commands to the supervised Node service.
// Dispatch is an explicit test adapter. Transport is the TLS path.
type Client struct {
	Dispatch    func(command map[string]any) (map[string]any, error)
	Transport   *transport.LengthDelimited
	Fingerprint string
	Identity    *security.PeerIdentity
	seq         uint64
}

func DialTLS(ctx context.Context, address string, config transport.Config, fingerprint string) (*Client, error) {
	wire, err := transport.DialTCP(ctx, address, config)
	if err != nil {
		return nil, err
	}
	identity := wire.LocalIdentity()
	fp := fingerprint
	if identity != nil && fp == "" {
		fp = identity.CredentialFingerprint
	}
	if identity != nil && config.IdentityPolicy != nil {
		key := security.NormalizeFingerprint(identity.CredentialFingerprint)
		if caps, ok := config.IdentityPolicy.CapabilitiesByFingerprint[key]; ok {
			cloned := *identity
			cloned.Capabilities = append([]string{}, caps...)
			identity = &cloned
		}
	}
	return &Client{Transport: wire, Fingerprint: fp, Identity: identity}, nil
}

func (c *Client) Send(command map[string]any) (map[string]any, error) {
	if c != nil && c.Dispatch != nil {
		return c.Dispatch(command)
	}
	if c == nil || c.Transport == nil {
		return nil, errNoDispatch
	}
	if c.Fingerprint == "" && (c.Identity == nil || c.Identity.PeerID == "") {
		return nil, &clientError{"TLS client identity fingerprint is required"}
	}
	c.seq++
	nonce := make([]byte, 16)
	_, _ = rand.Read(nonce)
	sessionID, _ := command["session_id"].(string)
	if sessionID == "" {
		sessionID = fmt.Sprintf("sess-%d", time.Now().UnixNano())
	}
	source := "cert:" + c.Fingerprint
	peer := map[string]any{}
	if c.Identity != nil {
		if c.Identity.PeerID != "" {
			source = c.Identity.PeerID
		}
		peer = map[string]any{
			"peer_id":                 c.Identity.PeerID,
			"node_id":                 c.Identity.NodeID,
			"worker_id":               c.Identity.WorkerID,
			"trust_domain":            c.Identity.TrustDomain,
			"credential_fingerprint":  c.Identity.CredentialFingerprint,
			"capabilities":            c.Identity.Capabilities,
			"issued_at":               c.Identity.IssuedAt,
			"expires_at":              c.Identity.ExpiresAt,
		}
	}
	env := contract.MessageEnvelope{
		ProtocolVersion: contract.ProtocolVersion,
		MessageID:       fmt.Sprintf("msg-%d", time.Now().UnixNano()),
		SessionID:       sessionID,
		Channel:         ControlChannel,
		Kind:            "request",
		Source:          source,
		Sequence:        c.seq,
		CreatedAt:       time.Now().UTC().Format(time.RFC3339),
		Attempt:         1,
		PayloadType:     "browser.command",
		Payload:         command,
		Metadata: map[string]any{
			"nonce":                   hex.EncodeToString(nonce),
			"security_nonce":          hex.EncodeToString(nonce),
			"operation":               ControlOperation,
			"certificate_fingerprint": c.Fingerprint,
			"peer_identity":           peer,
		},
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if err := c.Transport.Send(ctx, env); err != nil {
		return nil, err
	}
	response, err := c.Transport.Receive(ctx)
	if err != nil {
		return nil, err
	}
	if payload, ok := response.Payload.(map[string]any); ok {
		return payload, nil
	}
	return map[string]any{"payload": response.Payload}, nil
}

var errNoDispatch = &clientError{"browser real client requires a dispatch function or TLS transport"}

type clientError struct{ msg string }

func (e *clientError) Error() string { return e.msg }

func EncodeCommand(command map[string]any) ([]byte, error) {
	return json.Marshal(command)
}
