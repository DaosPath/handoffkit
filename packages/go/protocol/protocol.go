package protocol

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/DaosPath/handoffkit/go/contract"
)

type EnvelopeTransport interface {
	Send(context.Context, contract.MessageEnvelope) error
	Receive(context.Context) (contract.MessageEnvelope, error)
	Close() error
}

type HandshakeInfo struct {
	ProtocolVersion string                 `json:"protocol_version"`
	Runtime         string                 `json:"runtime"`
	SessionConfig   contract.SessionConfig `json:"session_config"`
	Capabilities    []string               `json:"capabilities"`
}

type HandshakeResult struct {
	ProtocolVersion string   `json:"protocol_version"`
	SessionID       string   `json:"session_id"`
	PeerRuntime     string   `json:"peer_runtime"`
	Capabilities    []string `json:"capabilities"`
}

func NegotiateVersion(remote string) (string, error) {
	if strings.SplitN(remote, ".", 2)[0] != strings.SplitN(contract.ProtocolVersion, ".", 2)[0] {
		return "", fmt.Errorf("unsupported protocol version %q", remote)
	}
	return contract.ProtocolVersion, nil
}

func (h HandshakeInfo) Validate() error {
	if strings.TrimSpace(h.Runtime) == "" {
		return errors.New("peer runtime name is required")
	}
	if _, err := NegotiateVersion(h.ProtocolVersion); err != nil {
		return err
	}
	return h.SessionConfig.Validate()
}

func ClientHandshake(ctx context.Context, transport EnvelopeTransport, config contract.SessionConfig, runtime string, capabilities []string) (HandshakeResult, error) {
	info := HandshakeInfo{ProtocolVersion: contract.ProtocolVersion, Runtime: runtime, SessionConfig: config, Capabilities: capabilities}
	if err := info.Validate(); err != nil {
		return HandshakeResult{}, err
	}
	request, err := controlEnvelope(config.SessionID, "session_open", runtime, info, nil)
	if err != nil {
		return HandshakeResult{}, err
	}
	if err := transport.Send(ctx, request); err != nil {
		return HandshakeResult{}, err
	}
	response, err := transport.Receive(ctx)
	if err != nil {
		return HandshakeResult{}, err
	}
	if response.SessionID != config.SessionID || response.CorrelationID == nil || *response.CorrelationID != request.MessageID {
		return HandshakeResult{}, errors.New("handshake response does not match request")
	}
	if response.Kind == "session_reject" {
		return HandshakeResult{}, errors.New("peer rejected session")
	}
	if response.Kind != "session_ready" {
		return HandshakeResult{}, fmt.Errorf("expected session_ready, got %q", response.Kind)
	}
	var result HandshakeResult
	if err := remarshal(response.Payload, &result); err != nil {
		return HandshakeResult{}, err
	}
	if _, err := NegotiateVersion(result.ProtocolVersion); err != nil {
		return HandshakeResult{}, err
	}
	return result, nil
}

func ServerHandshake(ctx context.Context, transport EnvelopeTransport, runtime string, capabilities []string) (HandshakeInfo, error) {
	request, err := transport.Receive(ctx)
	if err != nil {
		return HandshakeInfo{}, err
	}
	if request.Kind != "session_open" {
		_ = reject(ctx, transport, request, runtime, "handshake_required", "first message must be session_open")
		return HandshakeInfo{}, errors.New("first message must be session_open")
	}
	var info HandshakeInfo
	if err := remarshal(request.Payload, &info); err != nil {
		_ = reject(ctx, transport, request, runtime, "invalid_handshake", err.Error())
		return HandshakeInfo{}, err
	}
	if err := info.Validate(); err != nil {
		_ = reject(ctx, transport, request, runtime, "invalid_handshake", err.Error())
		return HandshakeInfo{}, err
	}
	if info.SessionConfig.SessionID != request.SessionID {
		_ = reject(ctx, transport, request, runtime, "session_mismatch", "handshake session IDs differ")
		return HandshakeInfo{}, errors.New("handshake session IDs differ")
	}
	result := HandshakeResult{ProtocolVersion: contract.ProtocolVersion, SessionID: request.SessionID, PeerRuntime: runtime, Capabilities: capabilities}
	response, err := controlEnvelope(request.SessionID, "session_ready", runtime, result, &request.MessageID)
	if err != nil {
		return HandshakeInfo{}, err
	}
	if err := transport.Send(ctx, response); err != nil {
		return HandshakeInfo{}, err
	}
	return info, nil
}

func ResponseFor(request contract.MessageEnvelope, source, kind, payloadType string, payload any) contract.MessageEnvelope {
	correlation := request.MessageID
	return contract.MessageEnvelope{
		ProtocolVersion: contract.ProtocolVersion, MessageID: request.MessageID + "-response",
		SessionID: request.SessionID, Channel: request.Channel, Kind: kind, Source: source,
		Target: &request.Source, Sequence: request.Sequence, CreatedAt: contract.UTCNow(),
		CorrelationID: &correlation, CausationID: &correlation, Attempt: 1,
		PayloadType: payloadType, Payload: payload, Metadata: map[string]any{},
	}
}

func NackFor(request contract.MessageEnvelope, source, code, message string, retryable bool) contract.MessageEnvelope {
	return ResponseFor(request, source, "nack", "delivery_nack", map[string]any{
		"message_id": request.MessageID, "code": code,
		"message": contract.SanitizeError(message), "retryable": retryable,
		"processed_at": contract.UTCNow(), "metadata": map[string]any{},
	})
}

func controlEnvelope(sessionID, kind, source string, payload any, correlationID *string) (contract.MessageEnvelope, error) {
	encoded, err := json.Marshal(payload)
	if err != nil {
		return contract.MessageEnvelope{}, err
	}
	var wire any
	if err := json.Unmarshal(encoded, &wire); err != nil {
		return contract.MessageEnvelope{}, err
	}
	return contract.MessageEnvelope{
		ProtocolVersion: contract.ProtocolVersion, MessageID: kind + "-go", SessionID: sessionID,
		Channel: "control", Kind: kind, Source: source, Sequence: 0, CreatedAt: contract.UTCNow(),
		CorrelationID: correlationID, Attempt: 1, PayloadType: "json", Payload: wire, Metadata: map[string]any{},
	}, nil
}

func reject(ctx context.Context, transport EnvelopeTransport, request contract.MessageEnvelope, runtime, code, message string) error {
	response, err := controlEnvelope(request.SessionID, "session_reject", runtime, map[string]any{"code": code, "message": contract.SanitizeError(message)}, &request.MessageID)
	if err != nil {
		return err
	}
	return transport.Send(ctx, response)
}

func remarshal(value any, target any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, target)
}
