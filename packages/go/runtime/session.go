package runtime

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/DaosPath/handoffkit/go/contract"
)

const maxPendingAcks = 4096

type deliveryResult struct {
	ack  *contract.DeliveryAck
	nack *contract.DeliveryNack
}

type Diagnostics struct {
	SessionID            string `json:"session_id"`
	ChannelCount         int    `json:"channel_count"`
	QueuedMessages       int    `json:"queued_messages"`
	ProcessCount         int    `json:"process_count"`
	PendingAckCount      int    `json:"pending_ack_count"`
	PendingEnvelopeCount int    `json:"pending_envelope_count"`
	DedupCount           int    `json:"dedup_count"`
	Cancelled            bool   `json:"cancelled"`
	Closed               bool   `json:"closed"`
}

type Session struct {
	config contract.SessionConfig
	ctx    context.Context
	cancel context.CancelFunc
	store  DedupStore
	mu     sync.Mutex
	channels map[string]*Channel
	processes map[string]*ProcessHandle
	pendingAcks map[string]chan deliveryResult
	pendingEnvelopes map[string]contract.MessageEnvelope
	dedup map[string]struct{}
	dedupOrder []string
	closed atomic.Bool
	sequence atomic.Uint64
}

func NewSession(parent context.Context, config contract.SessionConfig, store DedupStore) (*Session, error) {
	if err := config.Validate(); err != nil {
		return nil, err
	}
	var ctx context.Context
	var cancel context.CancelFunc
	if config.Deadline != nil {
		deadline, _ := time.Parse(time.RFC3339Nano, *config.Deadline)
		ctx, cancel = context.WithDeadline(parent, deadline)
	} else {
		ctx, cancel = context.WithCancel(parent)
	}
	return &Session{
		config: config, ctx: ctx, cancel: cancel, store: store,
		channels: map[string]*Channel{}, processes: map[string]*ProcessHandle{},
		pendingAcks: map[string]chan deliveryResult{}, pendingEnvelopes: map[string]contract.MessageEnvelope{},
		dedup: map[string]struct{}{},
	}, nil
}

func (s *Session) ID() string { return s.config.SessionID }

func (s *Session) Context() context.Context { return s.ctx }

func (s *Session) Channel(name string, capacity int, requiresAck bool) (*Channel, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed.Load() {
		return nil, runtimeError("session_closed", "session is closed", false)
	}
	if existing := s.channels[name]; existing != nil {
		return existing, nil
	}
	if capacity == 0 {
		capacity = s.config.ChannelCapacity
	}
	channel, err := NewChannel(contract.ChannelConfig{
		Name: name, Capacity: capacity, OverflowPolicy: contract.OverflowBlock,
		RequiresAck: requiresAck, Metadata: map[string]any{},
	}, s.config.MaxMessageBytes)
	if err != nil {
		return nil, err
	}
	s.channels[name] = channel
	return channel, nil
}

func (s *Session) Send(ctx context.Context, channelName string, envelope contract.MessageEnvelope) error {
	if envelope.SessionID != s.ID() {
		return errors.New("envelope belongs to a different session")
	}
	if err := s.ctx.Err(); err != nil {
		return err
	}
	clampDeadline(&envelope, s.config.Deadline)
	channel, err := s.Channel(channelName, 0, envelope.RequiresAck)
	if err != nil {
		return err
	}
	merged, cancel := mergeContexts(ctx, s.ctx)
	defer cancel()
	return channel.Send(merged, envelope)
}

func (s *Session) Receive(ctx context.Context, channelName string) (contract.MessageEnvelope, error) {
	channel, err := s.Channel(channelName, 0, false)
	if err != nil {
		return contract.MessageEnvelope{}, err
	}
	for {
		merged, cancel := mergeContexts(ctx, s.ctx)
		envelope, receiveErr := channel.Receive(merged)
		cancel()
		if receiveErr != nil {
			return contract.MessageEnvelope{}, receiveErr
		}
		key := envelope.MessageID
		if envelope.IdempotencyKey != nil {
			key = *envelope.IdempotencyKey
		}
		fresh, err := s.claim(key)
		if err != nil {
			return contract.MessageEnvelope{}, err
		}
		if !fresh {
			s.Ack(envelope, map[string]any{"duplicate": true})
			continue
		}
		s.mu.Lock()
		s.pendingEnvelopes[envelope.MessageID] = envelope
		s.mu.Unlock()
		return envelope, nil
	}
}

func (s *Session) Ack(envelope contract.MessageEnvelope, metadata map[string]any) contract.DeliveryAck {
	ack := contract.DeliveryAck{MessageID: envelope.MessageID, ProcessedAt: contract.UTCNow(), Metadata: metadata}
	s.mu.Lock()
	delete(s.pendingEnvelopes, envelope.MessageID)
	pending := s.pendingAcks[envelope.MessageID]
	s.mu.Unlock()
	if pending != nil {
		select {
		case pending <- deliveryResult{ack: &ack}:
		default:
		}
	}
	return ack
}

func (s *Session) Nack(envelope contract.MessageEnvelope, code, message string, retryable bool, metadata map[string]any) (contract.DeliveryNack, error) {
	nack := contract.DeliveryNack{
		MessageID: envelope.MessageID, Code: code, Message: contract.SanitizeError(message),
		Retryable: retryable, ProcessedAt: contract.UTCNow(), Metadata: metadata,
	}
	s.mu.Lock()
	delete(s.pendingEnvelopes, envelope.MessageID)
	pending := s.pendingAcks[envelope.MessageID]
	s.mu.Unlock()
	if retryable {
		key := envelope.MessageID
		if envelope.IdempotencyKey != nil {
			key = *envelope.IdempotencyKey
		}
		if err := s.release(key); err != nil {
			return nack, err
		}
	}
	if pending != nil {
		select {
		case pending <- deliveryResult{nack: &nack}:
		default:
		}
	}
	return nack, nil
}

func (s *Session) SendWithAck(ctx context.Context, channelName string, original contract.MessageEnvelope) (contract.DeliveryAck, error) {
	if !original.RequiresAck {
		return contract.DeliveryAck{}, errors.New("SendWithAck requires requires_ack=true")
	}
	current := original
	policy := s.config.RetryPolicy
	for attempt := 1; attempt <= policy.MaxAttempts; attempt++ {
		pending := make(chan deliveryResult, 1)
		s.mu.Lock()
		if len(s.pendingAcks) >= maxPendingAcks {
			s.mu.Unlock()
			return contract.DeliveryAck{}, errors.New("pending ACK capacity exceeded")
		}
		s.pendingAcks[current.MessageID] = pending
		s.mu.Unlock()
		if err := s.Send(ctx, channelName, current); err != nil {
			s.removePendingAck(current.MessageID)
			return contract.DeliveryAck{}, err
		}
		timer := time.NewTimer(time.Duration(s.config.AckTimeoutMS) * time.Millisecond)
		var result deliveryResult
		select {
		case <-ctx.Done():
			timer.Stop()
			s.removePendingAck(current.MessageID)
			return contract.DeliveryAck{}, ctx.Err()
		case <-s.ctx.Done():
			timer.Stop()
			s.removePendingAck(current.MessageID)
			return contract.DeliveryAck{}, s.ctx.Err()
		case result = <-pending:
			timer.Stop()
		case <-timer.C:
			result.nack = &contract.DeliveryNack{MessageID: current.MessageID, Code: "ack_timeout", Message: "Acknowledgement deadline elapsed.", Retryable: true, ProcessedAt: contract.UTCNow(), Metadata: map[string]any{}}
		}
		s.removePendingAck(current.MessageID)
		if result.ack != nil {
			return *result.ack, nil
		}
		if result.nack == nil || !result.nack.Retryable || attempt >= policy.MaxAttempts {
			return contract.DeliveryAck{}, errors.New("message was not acknowledged")
		}
		delay := policy.BaseDelayMS << (attempt - 1)
		if delay > policy.MaxDelayMS {
			delay = policy.MaxDelayMS
		}
		if delay > 0 {
			select {
			case <-ctx.Done():
				return contract.DeliveryAck{}, ctx.Err()
			case <-time.After(time.Duration(delay) * time.Millisecond):
			}
		}
		current = current.NextAttempt()
	}
	return contract.DeliveryAck{}, errors.New("retry loop exited unexpectedly")
}

func (s *Session) Spawn(name string, handler func(ProcessContext) error) (*ProcessHandle, error) {
	if name == "" {
		return nil, errors.New("process name must not be empty")
	}
	s.mu.Lock()
	if _, exists := s.processes[name]; exists {
		s.mu.Unlock()
		return nil, errors.New("process already exists")
	}
	ctx, cancel := context.WithCancel(s.ctx)
	handle := &ProcessHandle{name: name, done: make(chan struct{}), cancel: cancel}
	s.processes[name] = handle
	s.mu.Unlock()
	go func() {
		handle.mu.Lock()
		handle.err = handler(ProcessContext{session: s, processID: name, ctx: ctx})
		handle.mu.Unlock()
		s.mu.Lock()
		delete(s.processes, name)
		s.mu.Unlock()
		close(handle.done)
	}()
	return handle, nil
}

func (s *Session) Cancel() { s.cancel() }

func (s *Session) Close() error {
	if !s.closed.CompareAndSwap(false, true) {
		return nil
	}
	s.cancel()
	s.mu.Lock()
	channels := make([]*Channel, 0, len(s.channels))
	processes := make([]*ProcessHandle, 0, len(s.processes))
	for _, channel := range s.channels {
		channels = append(channels, channel)
	}
	for _, process := range s.processes {
		processes = append(processes, process)
	}
	s.mu.Unlock()
	for _, channel := range channels {
		channel.Close()
	}
	deadline := time.NewTimer(2 * time.Second)
	defer deadline.Stop()
	for _, process := range processes {
		select {
		case <-process.done:
		case <-deadline.C:
			return errors.New("process shutdown timed out")
		}
	}
	return nil
}

func (s *Session) Diagnostics() Diagnostics {
	s.mu.Lock()
	defer s.mu.Unlock()
	queued := 0
	processCount := 0
	for _, channel := range s.channels {
		queued += channel.Len()
	}
	for _, process := range s.processes {
		if !process.Done() {
			processCount++
		}
	}
	return Diagnostics{
		SessionID: s.ID(), ChannelCount: len(s.channels), QueuedMessages: queued,
		ProcessCount: processCount, PendingAckCount: len(s.pendingAcks),
		PendingEnvelopeCount: len(s.pendingEnvelopes), DedupCount: len(s.dedup),
		Cancelled: s.ctx.Err() != nil, Closed: s.closed.Load(),
	}
}

func (s *Session) Envelope(channel, kind, source, payloadType string, payload any) contract.MessageEnvelope {
	sequence := s.sequence.Add(1)
	messageID := fmt.Sprintf("msg-%d", sequence)
	key := messageID
	return contract.MessageEnvelope{
		ProtocolVersion: contract.ProtocolVersion, MessageID: messageID, SessionID: s.ID(),
		Channel: channel, Kind: kind, Source: source, Sequence: sequence,
		CreatedAt: contract.UTCNow(), Deadline: s.config.Deadline, IdempotencyKey: &key,
		Attempt: 1, PayloadType: payloadType, Payload: payload, Metadata: map[string]any{},
	}
}

func (s *Session) claim(key string) (bool, error) {
	s.mu.Lock()
	if _, exists := s.dedup[key]; exists {
		s.mu.Unlock()
		return false, nil
	}
	if s.store == nil {
		s.rememberDedupLocked(key)
		s.mu.Unlock()
		return true, nil
	}
	s.mu.Unlock()
	if s.store != nil {
		fresh, err := s.store.Claim(key)
		if err != nil || !fresh {
			return fresh, err
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.rememberDedupLocked(key)
	return true, nil
}

func (s *Session) rememberDedupLocked(key string) {
	s.dedup[key] = struct{}{}
	s.dedupOrder = append(s.dedupOrder, key)
	for len(s.dedupOrder) > s.config.DedupCapacity {
		delete(s.dedup, s.dedupOrder[0])
		s.dedupOrder = s.dedupOrder[1:]
	}
}

func (s *Session) release(key string) error {
	s.mu.Lock()
	delete(s.dedup, key)
	for index, current := range s.dedupOrder {
		if current == key {
			s.dedupOrder = append(s.dedupOrder[:index], s.dedupOrder[index+1:]...)
			break
		}
	}
	s.mu.Unlock()
	if s.store != nil {
		_, err := s.store.Release(key)
		return err
	}
	return nil
}

func (s *Session) removePendingAck(messageID string) {
	s.mu.Lock()
	delete(s.pendingAcks, messageID)
	s.mu.Unlock()
}

type ProcessHandle struct {
	name   string
	done   chan struct{}
	cancel context.CancelFunc
	mu     sync.Mutex
	err    error
}

func (h *ProcessHandle) Cancel() { h.cancel() }

func (h *ProcessHandle) Wait(ctx context.Context) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-h.done:
		h.mu.Lock()
		defer h.mu.Unlock()
		return h.err
	}
}

func (h *ProcessHandle) Done() bool {
	select {
	case <-h.done:
		return true
	default:
		return false
	}
}

type ProcessContext struct {
	session   *Session
	processID string
	ctx       context.Context
}

func (p ProcessContext) Context() context.Context { return p.ctx }
func (p ProcessContext) ProcessID() string { return p.processID }
func (p ProcessContext) Send(channel string, envelope contract.MessageEnvelope) error { return p.session.Send(p.ctx, channel, envelope) }
func (p ProcessContext) Receive(channel string) (contract.MessageEnvelope, error) { return p.session.Receive(p.ctx, channel) }
func (p ProcessContext) Ack(envelope contract.MessageEnvelope, metadata map[string]any) contract.DeliveryAck { return p.session.Ack(envelope, metadata) }
func (p ProcessContext) Nack(envelope contract.MessageEnvelope, code, message string, retryable bool, metadata map[string]any) (contract.DeliveryNack, error) { return p.session.Nack(envelope, code, message, retryable, metadata) }

func clampDeadline(envelope *contract.MessageEnvelope, sessionDeadline *string) {
	if sessionDeadline == nil {
		return
	}
	if envelope.Deadline == nil {
		value := *sessionDeadline
		envelope.Deadline = &value
		return
	}
	sessionTime, sessionErr := time.Parse(time.RFC3339Nano, *sessionDeadline)
	envelopeTime, envelopeErr := time.Parse(time.RFC3339Nano, *envelope.Deadline)
	if sessionErr == nil && envelopeErr == nil && sessionTime.Before(envelopeTime) {
		value := *sessionDeadline
		envelope.Deadline = &value
	}
}

func mergeContexts(first, second context.Context) (context.Context, context.CancelFunc) {
	ctx, cancel := context.WithCancel(first)
	go func() {
		select {
		case <-second.Done():
			cancel()
		case <-ctx.Done():
		}
	}()
	return ctx, cancel
}
