package mlgateway

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/DaosPath/handoffkit/go/artifactgate"
	"github.com/DaosPath/handoffkit/go/contract"
	"github.com/DaosPath/handoffkit/go/edgeprofile"
	"github.com/DaosPath/handoffkit/go/security"
	"github.com/DaosPath/handoffkit/go/studioevents"
	"github.com/DaosPath/handoffkit/go/transport"
)

type Config struct {
	Transport             transport.Config
	WorkerCommand         []string
	WorkerIdentity        string
	ArtifactGate          *artifactgate.Gate
	ResultGate            *artifactgate.Gate
	ResultSigner          *security.ArtifactSigner
	JobStore              *JobStore
	EdgeProfile           *edgeprofile.Profile
	LocalIdentity         *security.PeerIdentity
	MaxConnections        int
	WorkerMaxMessageBytes int
	StudioEvents          studioevents.Sink
}

func (config Config) Validate() error {
	if err := config.Transport.Validate(); err != nil {
		return err
	}
	if config.Transport.SecurityConfig == nil ||
		(config.Transport.SecurityConfig.Profile != security.SecurityProfileStandard &&
			config.Transport.SecurityConfig.Profile != security.SecurityProfileHybridPQ) {
		return gatewayError("secure_gateway_required", "ML gateway requires a secure TLS profile")
	}
	if len(config.WorkerCommand) == 0 || strings.TrimSpace(config.WorkerCommand[0]) == "" {
		return gatewayError("worker_command_missing", "ML gateway requires an explicit local worker command")
	}
	if !validRuntimeID(config.WorkerIdentity) {
		return gatewayError("worker_identity_invalid", "ML gateway requires a bounded local worker identity")
	}
	if config.ArtifactGate == nil || config.ResultGate == nil || config.ResultSigner == nil || config.JobStore == nil {
		return gatewayError("gateway_policy_incomplete", "ML gateway requires artifact, result-signing, and durable job policies")
	}
	if config.EdgeProfile == nil {
		return gatewayError("edge_profile_missing", "ML gateway requires an explicit operational profile")
	}
	if err := config.EdgeProfile.Validate(); err != nil {
		return gatewayError("edge_profile_invalid", "ML gateway operational profile is invalid")
	}
	profile := config.EdgeProfile
	if config.Transport.MaxMessageBytes != profile.MaxFrameBytes ||
		config.Transport.ConnectTimeout != time.Duration(profile.Timeout.ConnectMS)*time.Millisecond ||
		config.Transport.IOTimeout != time.Duration(profile.Timeout.IOMS)*time.Millisecond ||
		config.Transport.RetryPolicy.MaxAttempts != profile.Reconnect.MaxAttempts ||
		config.Transport.RetryPolicy.BaseDelayMS != profile.Reconnect.BaseDelayMS ||
		config.Transport.RetryPolicy.MaxDelayMS != profile.Reconnect.MaxDelayMS {
		return gatewayError("edge_profile_not_applied", "ML gateway transport limits do not match its operational profile")
	}
	if config.ArtifactGate.Policy().MaxSizeBytes > profile.ArtifactLimitBytes ||
		config.ResultGate.Policy().MaxSizeBytes > profile.ArtifactLimitBytes {
		return gatewayError("edge_profile_not_applied", "artifact gate exceeds the operational profile limit")
	}
	storeOptions := config.JobStore.Options()
	if storeOptions.MaxFileBytes > profile.DurableStateLimitBytes {
		return gatewayError("edge_profile_not_applied", "durable job store exceeds the operational profile disk limit")
	}
	if config.LocalIdentity == nil || config.LocalIdentity.PeerID == "" || config.LocalIdentity.NodeID == "" || config.LocalIdentity.CredentialFingerprint == "" {
		return gatewayError("gateway_identity_missing", "ML gateway requires its certificate-derived local identity")
	}
	if config.MaxConnections < 1 || config.MaxConnections > config.EdgeProfile.ConnectionLimit {
		return gatewayError("gateway_policy_incomplete", "ML gateway connection limit must be positive")
	}
	if config.WorkerMaxMessageBytes < contract.MinMessageBytes || config.WorkerMaxMessageBytes > contract.DefaultMaxMessageBytes {
		return gatewayError("gateway_policy_incomplete", "local worker message limit is outside protocol bounds")
	}
	return nil
}

type Gateway struct {
	config Config

	workerMu         sync.Mutex
	worker           *transport.Subprocess
	workerGeneration uint64
	workerContext    context.Context

	routesMu sync.Mutex
	routes   map[string]*workerRoute
	active   map[string]*workerRoute
	reserved int

	sessionsMu          sync.Mutex
	seenPeerConnections map[string]uint64

	requestSequence         atomic.Uint64
	responseSequence        atomic.Uint64
	activeConnections       atomic.Int64
	replayRejections        atomic.Uint64
	authorizationRejections atomic.Uint64
	reconnects              atomic.Uint64
	closed                  atomic.Bool
	diagnosticMu            sync.Mutex
	lastDiagnostic          string
}

type clientSession struct {
	wire             *transport.LengthDelimited
	identity         security.PeerIdentity
	peer             security.PeerIdentity
	sequence         *atomic.Uint64
	closed           atomic.Bool
	reconnected      bool
	reconnectCount   int
	currentSessionID string
	observedSessions map[string]bool
}

type workerRoute struct {
	mu              sync.Mutex
	localRequestID  string
	idempotencyHash string
	jobID           string
	remoteRequest   contract.MessageEnvelope
	session         *clientSession
	artifacts       []*artifactgate.VerifiedArtifact
	control         bool
}

func New(config Config) (*Gateway, error) {
	if err := config.Validate(); err != nil {
		return nil, err
	}
	identity := *config.LocalIdentity
	identity.Capabilities = append([]string(nil), config.LocalIdentity.Capabilities...)
	config.LocalIdentity = &identity
	gateway := &Gateway{
		config: config, routes: map[string]*workerRoute{}, active: map[string]*workerRoute{},
		seenPeerConnections: map[string]uint64{},
	}
	gateway.responseSequence.Store(uint64(time.Now().UnixNano()))
	return gateway, nil
}

func (gateway *Gateway) Serve(ctx context.Context, listener net.Listener) error {
	if listener == nil {
		return errors.New("listener is required")
	}
	gateway.workerMu.Lock()
	gateway.workerContext = ctx
	gateway.workerMu.Unlock()
	semaphore := make(chan struct{}, gateway.config.MaxConnections)
	go func() {
		<-ctx.Done()
		_ = listener.Close()
	}()
	for {
		connection, err := listener.Accept()
		if err != nil {
			if ctx.Err() != nil || errors.Is(err, net.ErrClosed) {
				return nil
			}
			return err
		}
		select {
		case semaphore <- struct{}{}:
			go func() {
				defer func() { <-semaphore }()
				gateway.serveConnection(ctx, connection)
			}()
		default:
			_ = connection.Close()
		}
	}
}

func (gateway *Gateway) Close() error {
	if !gateway.closed.CompareAndSwap(false, true) {
		return nil
	}
	gateway.workerMu.Lock()
	worker := gateway.worker
	gateway.worker = nil
	gateway.workerMu.Unlock()
	if worker != nil {
		return worker.Close()
	}
	return nil
}

func (gateway *Gateway) serveConnection(ctx context.Context, connection net.Conn) {
	wire, err := transport.NewLengthDelimited(connection, gateway.config.Transport)
	if err != nil {
		_ = connection.Close()
		gateway.emitRejection(nil, "authentication", "tls_authentication_failed")
		return
	}
	defer wire.Close()
	if wire.AuthenticatedPeer == nil {
		gateway.emitRejection(nil, "authentication", "authenticated_peer_missing")
		return
	}
	peer := *wire.AuthenticatedPeer
	peer.Capabilities = append([]string(nil), wire.AuthenticatedPeer.Capabilities...)
	reconnected, reconnectCount := gateway.registerPeerConnection(peer.CredentialFingerprint)
	session := &clientSession{
		wire: wire, identity: *gateway.config.LocalIdentity, peer: peer,
		sequence: &gateway.responseSequence, reconnected: reconnected,
		reconnectCount: reconnectCount, observedSessions: map[string]bool{},
	}
	gateway.activeConnections.Add(1)
	gateway.emitRuntimeStatus()
	defer func() {
		session.closed.Store(true)
		gateway.activeConnections.Add(-1)
		gateway.emitRuntimeStatus()
	}()
	for {
		request, err := wire.Receive(ctx)
		if err != nil {
			gateway.observeSecurityFailure(session, err)
			return
		}
		session.currentSessionID = request.SessionID
		gateway.observeSession(session, request.SessionID)
		if err := gateway.handleRequest(ctx, session, request); err != nil {
			gateway.observeSecurityFailure(session, err)
			_ = session.sendNack(ctx, request, errorCode(err), contract.SanitizeError(err.Error()), false)
		}
	}
}

func (gateway *Gateway) handleRequest(
	ctx context.Context,
	session *clientSession,
	request contract.MessageEnvelope,
) error {
	expectedOperation := map[string]string{
		"training_job": "job:training", "evaluation_job": "job:evaluation",
		"job_cancel": "job:cancel", "worker_capabilities": "worker:inspect",
	}[request.Kind]
	if expectedOperation == "" {
		return gatewayError("unknown_message_kind", "ML gateway does not support this message kind")
	}
	operation, _ := request.Metadata["operation"].(string)
	if operation != expectedOperation {
		return gatewayError("operation_mismatch", "message kind does not match the authorized operation")
	}
	if request.Kind == "training_job" || request.Kind == "evaluation_job" {
		return gateway.handleJob(ctx, session, request)
	}
	return gateway.forwardControl(ctx, session, request)
}

func (gateway *Gateway) handleJob(
	ctx context.Context,
	session *clientSession,
	request contract.MessageEnvelope,
) error {
	if request.IdempotencyKey == nil || strings.TrimSpace(*request.IdempotencyKey) == "" {
		return gatewayError("idempotency_key_missing", "remote ML jobs require an idempotency key")
	}
	peer := session.wire.AuthenticatedPeer
	storeKey := idempotencyHash(peer.CredentialFingerprint, *request.IdempotencyKey)
	_, known := gateway.config.JobStore.Record(storeKey)
	reserved := false
	if !known {
		if !gateway.reserveJobSlot() {
			return gatewayError("gateway_backpressure", "ML gateway reached its bounded edge queue capacity")
		}
		reserved = true
		defer func() {
			if reserved {
				gateway.releaseJobSlot()
			}
		}()
	}
	jobID, payload, artifacts, err := gateway.verifyJobArtifacts(request)
	if err != nil {
		closeArtifacts(artifacts)
		gateway.emitRejectedArtifacts(request, errorCode(err))
		return err
	}
	for _, artifact := range artifacts {
		gateway.emitVerifiedArtifact(artifact.Snapshot, jobID)
	}
	requestHash, err := hashJobRequest(request.Kind, request.Payload)
	if err != nil {
		closeArtifacts(artifacts)
		return err
	}
	record, found, err := gateway.config.JobStore.LookupOrBegin(
		peer.CredentialFingerprint, *request.IdempotencyKey, requestHash, jobID, time.Now().Unix())
	if err != nil {
		closeArtifacts(artifacts)
		return err
	}
	if found {
		closeArtifacts(artifacts)
		if record.State == JobActive {
			gateway.routesMu.Lock()
			route := gateway.active[record.IdempotencyHash]
			gateway.routesMu.Unlock()
			if route == nil {
				return gatewayError("job_state_inconsistent", "active durable job has no live worker route")
			}
			route.mu.Lock()
			route.remoteRequest = request
			route.session = session
			route.mu.Unlock()
			return session.send(ctx, request, StoredResponse{
				Kind: "job_active", PayloadType: "json",
				Payload: map[string]any{"job_id": jobID, "state": "active", "reconnected": true},
			})
		}
		if record.Response == nil {
			return gatewayError("job_state_corrupt", "terminal durable job has no stored response")
		}
		return session.send(ctx, request, *record.Response)
	}

	localRequest := gateway.localEnvelope(request.Kind, payload, request.IdempotencyKey)
	route := &workerRoute{
		localRequestID: localRequest.MessageID, idempotencyHash: record.IdempotencyHash,
		jobID: jobID, remoteRequest: request, session: session, artifacts: artifacts,
	}
	gateway.routesMu.Lock()
	gateway.routes[route.localRequestID] = route
	gateway.active[route.idempotencyHash] = route
	if reserved {
		gateway.reserved--
		reserved = false
	}
	gateway.routesMu.Unlock()
	gateway.emitJob(route, "queued", 0, nil, nil)
	gateway.emitRuntimeStatus()
	if err := gateway.sendWorker(ctx, localRequest); err != nil {
		gateway.failRoute(route, "worker_unavailable", "Local cpp-ml worker is unavailable.", true)
		return err
	}
	return nil
}

func (gateway *Gateway) verifyJobArtifacts(
	request contract.MessageEnvelope,
) (string, any, []*artifactgate.VerifiedArtifact, error) {
	if request.Kind == "training_job" {
		var job contract.TrainingJob
		if err := remarshal(request.Payload, &job); err != nil {
			return "", nil, nil, gatewayError("invalid_training_job", "training job payload is invalid")
		}
		if err := job.Validate(); err != nil {
			return "", nil, nil, gatewayError("invalid_training_job", "training job payload is invalid")
		}
		if request.IdempotencyKey == nil || job.IdempotencyKey != *request.IdempotencyKey {
			return "", nil, nil, gatewayError("idempotency_mismatch", "job and envelope idempotency keys differ")
		}
		verified, err := gateway.config.ArtifactGate.Ingest(job.Dataset, time.Now().Unix())
		if err != nil {
			return "", nil, nil, err
		}
		job.Dataset = verified.Snapshot
		return job.JobID, job, []*artifactgate.VerifiedArtifact{verified}, nil
	}
	var job contract.EvaluationJob
	if err := remarshal(request.Payload, &job); err != nil {
		return "", nil, nil, gatewayError("invalid_evaluation_job", "evaluation job payload is invalid")
	}
	if err := job.Validate(); err != nil {
		return "", nil, nil, gatewayError("invalid_evaluation_job", "evaluation job payload is invalid")
	}
	if request.IdempotencyKey == nil || job.IdempotencyKey != *request.IdempotencyKey {
		return "", nil, nil, gatewayError("idempotency_mismatch", "job and envelope idempotency keys differ")
	}
	model, err := gateway.config.ArtifactGate.Ingest(job.Model, time.Now().Unix())
	if err != nil {
		return "", nil, nil, err
	}
	dataset, err := gateway.config.ArtifactGate.Ingest(job.Dataset, time.Now().Unix())
	if err != nil {
		_ = model.Close()
		return "", nil, nil, err
	}
	job.Model = model.Snapshot
	job.Dataset = dataset.Snapshot
	return job.JobID, job, []*artifactgate.VerifiedArtifact{model, dataset}, nil
}

func (gateway *Gateway) forwardControl(
	ctx context.Context,
	session *clientSession,
	request contract.MessageEnvelope,
) error {
	payload := request.Payload
	if request.Kind == "job_cancel" {
		jobID, _ := payload.(map[string]any)["job_id"].(string)
		if jobID == "" {
			return gatewayError("invalid_cancel", "job_cancel requires job_id")
		}
	}
	local := gateway.localEnvelope(request.Kind, payload, request.IdempotencyKey)
	route := &workerRoute{
		localRequestID: local.MessageID, remoteRequest: request, session: session, control: true,
	}
	gateway.routesMu.Lock()
	gateway.routes[route.localRequestID] = route
	gateway.routesMu.Unlock()
	if err := gateway.sendWorker(ctx, local); err != nil {
		gateway.removeRoute(route)
		return err
	}
	return nil
}

func (gateway *Gateway) localEnvelope(kind string, payload any, idempotencyKey *string) contract.MessageEnvelope {
	sequence := gateway.requestSequence.Add(1)
	target := gateway.config.WorkerIdentity
	return contract.MessageEnvelope{
		ProtocolVersion: contract.ProtocolVersion,
		MessageID:       fmt.Sprintf("ml-gateway-%d", sequence),
		SessionID:       "ml-gateway-local",
		Channel:         "jobs",
		Kind:            kind,
		Source:          gateway.config.LocalIdentity.PeerID,
		Target:          &target,
		Sequence:        sequence,
		CreatedAt:       contract.UTCNow(),
		IdempotencyKey:  idempotencyKey,
		Attempt:         1,
		PayloadType:     "json",
		Payload:         payload,
		Metadata: map[string]any{
			"authenticated_gateway": gateway.config.LocalIdentity.PeerID,
		},
	}
}

func (gateway *Gateway) sendWorker(ctx context.Context, envelope contract.MessageEnvelope) error {
	worker, err := gateway.ensureWorker(ctx)
	if err != nil {
		return err
	}
	if err := worker.Send(ctx, envelope); err != nil {
		gateway.recordWorkerDiagnostic(contract.SanitizeError(err.Error()))
		gateway.workerFailed(worker, err)
		return gatewayError("worker_unavailable", "local cpp-ml worker could not receive the request")
	}
	return nil
}

func (gateway *Gateway) ensureWorker(ctx context.Context) (*transport.Subprocess, error) {
	gateway.workerMu.Lock()
	defer gateway.workerMu.Unlock()
	if gateway.closed.Load() {
		return nil, gatewayError("gateway_closed", "ML gateway is closed")
	}
	if gateway.worker != nil {
		return gateway.worker, nil
	}
	workerContext := gateway.workerContext
	if workerContext == nil {
		workerContext = ctx
	}
	worker, err := transport.Spawn(
		workerContext, gateway.config.WorkerCommand, gateway.config.WorkerMaxMessageBytes)
	if err != nil {
		return nil, gatewayError("worker_unavailable", "local cpp-ml worker could not be started")
	}
	gateway.worker = worker
	gateway.workerGeneration++
	generation := gateway.workerGeneration
	go gateway.receiveWorker(workerContext, worker, generation)
	return worker, nil
}

func (gateway *Gateway) receiveWorker(
	ctx context.Context,
	worker *transport.Subprocess,
	generation uint64,
) {
	for {
		envelope, err := worker.Receive(ctx)
		if err != nil {
			gateway.workerFailedGeneration(worker, generation, err)
			return
		}
		gateway.handleWorkerEnvelope(ctx, envelope)
	}
}

func (gateway *Gateway) handleWorkerEnvelope(ctx context.Context, envelope contract.MessageEnvelope) {
	if envelope.CorrelationID == nil {
		return
	}
	gateway.routesMu.Lock()
	route := gateway.routes[*envelope.CorrelationID]
	gateway.routesMu.Unlock()
	if route == nil {
		return
	}
	payload, ok := envelope.Payload.(map[string]any)
	if !ok {
		gateway.failRoute(route, "worker_protocol_error", "Local worker returned an invalid payload.", false)
		return
	}
	response := StoredResponse{Kind: envelope.Kind, PayloadType: envelope.PayloadType, Payload: payload}
	terminal := envelope.Kind == "job_result" || envelope.Kind == "delivery_nack"
	if envelope.Kind == "job_result" && !route.control {
		signed, err := gateway.signResult(payload, route.jobID)
		if err != nil {
			gateway.failRoute(route, errorCode(err), contract.SanitizeError(err.Error()), false)
			return
		}
		response.Payload = signed
	}
	workerID := envelope.Source
	if envelope.Kind == "job_accepted" && !route.control {
		gateway.emitJob(route, "running", 0, &workerID, nil)
	}
	if envelope.Kind == "job_progress" && !route.control {
		var progress contract.JobProgress
		if err := remarshal(payload, &progress); err == nil && progress.Validate() == nil {
			gateway.emitJob(route, "running", progress.Progress, &workerID, nil)
		}
	}
	if terminal && !route.control {
		state := JobCompleted
		studioState := "completed"
		progress := 1.0
		var failureCode *string
		if envelope.Kind == "delivery_nack" {
			state = JobFailed
			studioState = "failed"
			progress = 0
			if code, ok := payload["code"].(string); ok {
				failureCode = &code
				if code == "job_cancelled" {
					studioState = "cancelled"
				}
			}
		}
		if err := gateway.config.JobStore.Complete(
			route.idempotencyHash, state, response, time.Now().Unix()); err != nil {
			gateway.failRoute(route, errorCode(err), contract.SanitizeError(err.Error()), false)
			return
		}
		gateway.emitJob(route, studioState, progress, &workerID, failureCode)
	}
	route.mu.Lock()
	session := route.session
	request := route.remoteRequest
	route.mu.Unlock()
	if session != nil && !session.closed.Load() {
		_ = session.send(ctx, request, response)
	}
	if terminal || route.control {
		gateway.removeRoute(route)
	}
}

func (gateway *Gateway) signResult(payload map[string]any, jobID string) (map[string]any, error) {
	var reference contract.ArtifactRef
	if err := remarshal(payload, &reference); err != nil {
		return nil, gatewayError("worker_protocol_error", "local worker result is not an ArtifactRef")
	}
	verified, err := gateway.config.ResultGate.Ingest(reference, time.Now().Unix())
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(verified.SnapshotPath)
	if err != nil {
		_ = verified.Close()
		return nil, gatewayError("artifact_unavailable", "verified result snapshot cannot be read")
	}
	signed, err := gateway.config.ResultSigner.SignArtifact(
		verified.Snapshot.ArtifactID, data, time.Now().Unix())
	if err != nil {
		_ = verified.Close()
		return nil, err
	}
	result := verified.Snapshot
	if result.Metadata == nil {
		result.Metadata = map[string]any{}
	}
	result.Metadata["producer_identity"] = signed.SignerIdentity
	result.Metadata["signed_artifact"] = signed
	encoded, err := json.Marshal(result)
	if err != nil {
		_ = verified.Close()
		return nil, err
	}
	var wire map[string]any
	if err := json.Unmarshal(encoded, &wire); err != nil {
		_ = verified.Close()
		return nil, err
	}
	gateway.emitVerifiedArtifact(result, jobID)
	// The verified snapshot is the durable result artifact. Its lifecycle is tied
	// to the durable job record, not the source file owned by the C++ process.
	return wire, nil
}

func (gateway *Gateway) failRoute(
	route *workerRoute,
	code, message string,
	retryable bool,
) {
	response := StoredResponse{
		Kind: "delivery_nack", PayloadType: "delivery_nack",
		Payload: map[string]any{
			"message_id": route.remoteRequest.MessageID, "code": code,
			"message": contract.SanitizeError(message), "retryable": retryable,
			"processed_at": contract.UTCNow(), "metadata": map[string]any{"job_id": route.jobID},
		},
	}
	if !route.control && route.idempotencyHash != "" {
		_ = gateway.config.JobStore.Complete(
			route.idempotencyHash, JobFailed, response, time.Now().Unix())
		studioState := "failed"
		if code == "job_cancelled" {
			studioState = "cancelled"
		} else if code == "worker_crashed" || code == "worker_unavailable" {
			studioState = "interrupted"
		}
		gateway.emitJob(route, studioState, 0, nil, &code)
	}
	route.mu.Lock()
	session := route.session
	request := route.remoteRequest
	route.mu.Unlock()
	if session != nil && !session.closed.Load() {
		_ = session.send(context.Background(), request, response)
	}
	gateway.removeRoute(route)
}

func (gateway *Gateway) removeRoute(route *workerRoute) {
	gateway.routesMu.Lock()
	delete(gateway.routes, route.localRequestID)
	if route.idempotencyHash != "" {
		delete(gateway.active, route.idempotencyHash)
	}
	gateway.routesMu.Unlock()
	closeArtifacts(route.artifacts)
	gateway.emitRuntimeStatus()
}

func (gateway *Gateway) reserveJobSlot() bool {
	gateway.routesMu.Lock()
	defer gateway.routesMu.Unlock()
	if len(gateway.active)+gateway.reserved >= gateway.config.EdgeProfile.ChannelCapacity {
		return false
	}
	gateway.reserved++
	return true
}

func (gateway *Gateway) releaseJobSlot() {
	gateway.routesMu.Lock()
	if gateway.reserved > 0 {
		gateway.reserved--
	}
	gateway.routesMu.Unlock()
}

func (gateway *Gateway) registerPeerConnection(fingerprint string) (bool, int) {
	gateway.sessionsMu.Lock()
	previous := gateway.seenPeerConnections[fingerprint]
	gateway.seenPeerConnections[fingerprint] = previous + 1
	gateway.sessionsMu.Unlock()
	if previous > 0 {
		gateway.reconnects.Add(1)
	}
	return previous > 0, int(previous)
}

func (gateway *Gateway) observeSession(session *clientSession, sessionID string) {
	if gateway.config.StudioEvents == nil || session.observedSessions[sessionID] {
		return
	}
	session.observedSessions[sessionID] = true
	observation, ok := session.wire.SecurityObservation()
	if !ok {
		return
	}
	fingerprint, err := studioevents.TruncateFingerprint(session.peer.CredentialFingerprint)
	if err != nil {
		gateway.recordStudioDiagnostic()
		return
	}
	var workerID *string
	if session.peer.WorkerID != "" {
		value := session.peer.WorkerID
		workerID = &value
	}
	eventType := studioevents.EventSessionObserved
	if session.reconnected {
		eventType = studioevents.EventSessionReconnected
	}
	gateway.emitStudio(eventType, studioevents.Session{
		SessionID: sessionID, PeerID: session.peer.PeerID, NodeID: session.peer.NodeID,
		WorkerID: workerID, IdentitySource: "certificate-san",
		TrustDomain: session.peer.TrustDomain, CredentialFingerprint: fingerprint,
		CertificateExpiresAt: time.Unix(session.peer.ExpiresAt, 0).UTC().Format(time.RFC3339Nano),
		CertificateState:     "valid", SecurityProfile: string(observation.SecurityProfile),
		TLSVersion: observation.TLSVersion, NegotiatedGroup: observation.NegotiatedGroup,
		HybridPQProviderState: hybridProviderState(
			observation.HybridPQProviderSupported, observation.NegotiatedGroup),
		RevocationState: observation.RevocationState,
		Rotation:        rotationObservation(observation.RotationStatus),
		Queue:           gateway.queueObservation(), Reconnects: session.reconnectCount,
	})
}

func (gateway *Gateway) observeSecurityFailure(session *clientSession, err error) {
	var securityErr *security.SecurityError
	if !errors.As(err, &securityErr) {
		return
	}
	var sessionID *string
	if session != nil && session.currentSessionID != "" {
		value := session.currentSessionID
		sessionID = &value
	}
	gateway.emitRejection(sessionID, categoryForCode(securityErr.Code), securityErr.Code)
}

func (gateway *Gateway) emitRejection(sessionID *string, category, code string) {
	if gateway.config.StudioEvents == nil {
		return
	}
	if category == "replay" {
		gateway.replayRejections.Add(1)
	}
	if category == "authorization" {
		gateway.authorizationRejections.Add(1)
	}
	gateway.emitStudio(studioevents.EventSecurityRejected, studioevents.Rejection{
		SessionID: sessionID, Category: category, Code: code,
		Message: studioRejectionMessage(category),
	})
	gateway.emitRuntimeStatus()
}

func (gateway *Gateway) emitVerifiedArtifact(reference contract.ArtifactRef, jobID string) {
	if gateway.config.StudioEvents == nil || reference.Metadata == nil {
		return
	}
	var signed security.SignedArtifact
	if err := remarshal(reference.Metadata["signed_artifact"], &signed); err != nil {
		return
	}
	fingerprint, err := studioevents.TruncateFingerprint(signed.KeyFingerprint)
	if err != nil {
		gateway.recordStudioDiagnostic()
		return
	}
	gateway.emitStudio(studioevents.EventArtifactVerified, studioevents.Artifact{
		ArtifactID: reference.ArtifactID, JobID: jobID, MediaType: reference.MediaType,
		Verification: "verified", ProducerIdentity: &signed.SignerIdentity,
		IdentitySource: "verified-signer", SignerFingerprint: &fingerprint,
	})
}

func (gateway *Gateway) emitRejectedArtifacts(request contract.MessageEnvelope, code string) {
	if gateway.config.StudioEvents == nil {
		return
	}
	var jobID string
	var references []contract.ArtifactRef
	if request.Kind == "training_job" {
		var job contract.TrainingJob
		if remarshal(request.Payload, &job) == nil {
			jobID = job.JobID
			references = append(references, job.Dataset)
		}
	} else if request.Kind == "evaluation_job" {
		var job contract.EvaluationJob
		if remarshal(request.Payload, &job) == nil {
			jobID = job.JobID
			references = append(references, job.Model, job.Dataset)
		}
	}
	for _, reference := range references {
		failureCode := code
		gateway.emitStudio(studioevents.EventArtifactVerified, studioevents.Artifact{
			ArtifactID: reference.ArtifactID, JobID: jobID, MediaType: reference.MediaType,
			Verification: "rejected", IdentitySource: "unverified", ErrorCode: &failureCode,
		})
	}
}

func (gateway *Gateway) emitJob(
	route *workerRoute,
	status string,
	progress float64,
	workerID *string,
	errorCode *string,
) {
	if gateway.config.StudioEvents == nil || route.control {
		return
	}
	operation := "training"
	if route.remoteRequest.Kind == "evaluation_job" {
		operation = "evaluation"
	}
	gateway.emitStudio(studioevents.EventJobUpdated, studioevents.Job{
		JobID: route.jobID, Operation: operation, Status: status, Progress: progress,
		WorkerID: workerID, ErrorCode: errorCode,
	})
}

func (gateway *Gateway) emitRuntimeStatus() {
	if gateway.config.StudioEvents == nil {
		return
	}
	gateway.emitStudio(studioevents.EventRuntimeStatus, studioevents.RuntimeStatus{
		Connections: int(gateway.activeConnections.Load()), ConnectionLimit: gateway.config.MaxConnections,
		Queue: gateway.queueObservation(), ReplayRejections: int(gateway.replayRejections.Load()),
		AuthorizationRejections: int(gateway.authorizationRejections.Load()),
		Reconnects:              int(gateway.reconnects.Load()),
		HybridPQProviderState:   hybridProviderState(security.DetectHybridPQSupport(), nil),
	})
}

func (gateway *Gateway) emitStudio(eventType string, payload any) {
	if gateway.config.StudioEvents == nil {
		return
	}
	event, err := studioevents.New("go", gateway.config.EdgeProfile.Name, eventType, payload)
	if err != nil {
		gateway.recordStudioDiagnostic()
		return
	}
	if err := gateway.config.StudioEvents.Emit(event); err != nil {
		gateway.recordStudioDiagnostic()
	}
}

func (gateway *Gateway) recordStudioDiagnostic() {
	gateway.diagnosticMu.Lock()
	gateway.lastDiagnostic = "Studio event sink rejected a sanitized runtime event."
	gateway.diagnosticMu.Unlock()
}

func (gateway *Gateway) queueObservation() studioevents.Queue {
	gateway.routesMu.Lock()
	pending := len(gateway.active) + gateway.reserved
	gateway.routesMu.Unlock()
	return studioevents.Queue{Pending: pending, Capacity: gateway.config.EdgeProfile.ChannelCapacity}
}

func categoryForCode(code string) string {
	switch {
	case strings.HasPrefix(code, "replay_"):
		return "replay"
	case code == "credential_revoked":
		return "revocation"
	case strings.Contains(code, "authorization") || code == "operation_mismatch" || code == "unknown_message_kind":
		return "authorization"
	case strings.Contains(code, "transcript") || code == "security_profile_mismatch":
		return "transcript"
	case strings.HasPrefix(code, "artifact_") || code == "invalid_artifact_ref" || code == "invalid_signed_artifact":
		return "artifact"
	case strings.HasPrefix(code, "worker_") || strings.HasPrefix(code, "job_") || code == "gateway_backpressure":
		return "worker"
	default:
		return "authentication"
	}
}

func studioRejectionMessage(category string) string {
	return map[string]string{
		"authentication": "Authenticated transport request rejected.",
		"authorization":  "Local capability policy rejected the request.",
		"replay":         "Authenticated replay protection rejected the frame.",
		"revocation":     "Durable revocation policy rejected the credential.",
		"transcript":     "Authenticated security transcript validation failed.",
		"artifact":       "Artifact ingestion policy rejected the artifact.",
		"worker":         "Bounded local worker route rejected the request.",
	}[category]
}

func hybridProviderState(providerSupported bool, negotiatedGroup *string) string {
	if negotiatedGroup != nil && *negotiatedGroup != "" {
		return "negotiated"
	}
	if providerSupported {
		return "available-not-selected"
	}
	return "unavailable"
}

func rotationObservation(status map[string]any) studioevents.Rotation {
	if status == nil {
		return studioevents.Rotation{Status: "not-configured"}
	}
	result := studioevents.Rotation{Status: "current"}
	if value, ok := status["current_fingerprint"].(string); ok {
		if fingerprint, err := studioevents.TruncateFingerprint(value); err == nil {
			result.CurrentFingerprint = &fingerprint
		}
	}
	if value, ok := status["previous_fingerprint"].(string); ok && value != "" {
		if fingerprint, err := studioevents.TruncateFingerprint(value); err == nil {
			result.PreviousFingerprint = &fingerprint
		}
	}
	result.PreviousAccepted, _ = status["previous_accepted"].(bool)
	if result.PreviousAccepted {
		result.Status = "transition"
	}
	if value := int64Value(status["transition_until"]); value > 0 {
		timestamp := time.Unix(value, 0).UTC().Format(time.RFC3339Nano)
		result.TransitionUntil = &timestamp
	}
	return result
}

func int64Value(value any) int64 {
	switch typed := value.(type) {
	case int:
		return int64(typed)
	case int64:
		return typed
	case float64:
		return int64(typed)
	default:
		return 0
	}
}

func validRuntimeID(value string) bool {
	if len(value) < 1 || len(value) > 128 {
		return false
	}
	for _, character := range value {
		if (character >= 'a' && character <= 'z') || (character >= 'A' && character <= 'Z') ||
			(character >= '0' && character <= '9') || strings.ContainsRune("._:@-", character) {
			continue
		}
		return false
	}
	return true
}

func (gateway *Gateway) workerFailed(worker *transport.Subprocess, cause error) {
	gateway.recordWorkerDiagnostic(contract.SanitizeError(cause.Error()))
	gateway.recordWorkerDiagnostic(worker.Stderr())
	gateway.workerMu.Lock()
	if gateway.worker == worker {
		gateway.worker = nil
	}
	gateway.workerMu.Unlock()
	if closeErr := worker.Close(); closeErr != nil {
		gateway.recordWorkerDiagnostic(contract.SanitizeError(closeErr.Error()))
	}
	gateway.failAllActive(cause)
}

func (gateway *Gateway) workerFailedGeneration(
	worker *transport.Subprocess,
	generation uint64,
	cause error,
) {
	gateway.recordWorkerDiagnostic(contract.SanitizeError(cause.Error()))
	gateway.recordWorkerDiagnostic(worker.Stderr())
	gateway.workerMu.Lock()
	current := gateway.worker == worker && gateway.workerGeneration == generation
	if current {
		gateway.worker = nil
	}
	gateway.workerMu.Unlock()
	if closeErr := worker.Close(); closeErr != nil {
		gateway.recordWorkerDiagnostic(contract.SanitizeError(closeErr.Error()))
	}
	if current && !gateway.closed.Load() {
		gateway.failAllActive(cause)
	}
}

func (gateway *Gateway) recordWorkerDiagnostic(value string) {
	if strings.TrimSpace(value) == "" {
		return
	}
	gateway.diagnosticMu.Lock()
	gateway.lastDiagnostic = value
	gateway.diagnosticMu.Unlock()
}

func (gateway *Gateway) workerDiagnostic() string {
	gateway.diagnosticMu.Lock()
	defer gateway.diagnosticMu.Unlock()
	return gateway.lastDiagnostic
}

func (gateway *Gateway) failAllActive(cause error) {
	gateway.routesMu.Lock()
	routes := make([]*workerRoute, 0, len(gateway.routes))
	for _, route := range gateway.routes {
		routes = append(routes, route)
	}
	gateway.routesMu.Unlock()
	_ = cause
	for _, route := range routes {
		gateway.failRoute(route, "worker_crashed", "Local cpp-ml worker terminated unexpectedly.", true)
	}
}

func (session *clientSession) send(
	ctx context.Context,
	request contract.MessageEnvelope,
	response StoredResponse,
) error {
	sequence := session.sequence.Add(1)
	target := request.Source
	correlation := request.MessageID
	nonce, err := randomNonce()
	if err != nil {
		return err
	}
	responseOperation := "job:result"
	if request.Kind == "worker_capabilities" {
		responseOperation = "worker:inspect"
	}
	envelope := contract.MessageEnvelope{
		ProtocolVersion: contract.ProtocolVersion,
		MessageID:       fmt.Sprintf("ml-gateway-response-%d", sequence),
		SessionID:       request.SessionID,
		Channel:         request.Channel,
		Kind:            response.Kind,
		Source:          session.identity.PeerID,
		Target:          &target,
		Sequence:        sequence,
		CreatedAt:       contract.UTCNow(),
		CorrelationID:   &correlation,
		CausationID:     &correlation,
		IdempotencyKey:  request.IdempotencyKey,
		Attempt:         1,
		PayloadType:     response.PayloadType,
		Payload:         response.Payload,
		Metadata: map[string]any{
			"peer_identity":  session.identity,
			"security_nonce": nonce,
			"operation":      responseOperation,
		},
	}
	return session.wire.Send(ctx, envelope)
}

func (session *clientSession) sendNack(
	ctx context.Context,
	request contract.MessageEnvelope,
	code, message string,
	retryable bool,
) error {
	return session.send(ctx, request, StoredResponse{
		Kind: "delivery_nack", PayloadType: "delivery_nack",
		Payload: map[string]any{
			"message_id": request.MessageID, "code": code, "message": message,
			"retryable": retryable, "processed_at": contract.UTCNow(),
			"metadata": map[string]any{},
		},
	})
}

func hashJobRequest(kind string, payload any) (string, error) {
	data, err := json.Marshal(struct {
		Kind    string `json:"kind"`
		Payload any    `json:"payload"`
	}{Kind: kind, Payload: payload})
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(data)
	return "sha256:" + hex.EncodeToString(digest[:]), nil
}

func randomNonce() (string, error) {
	value := make([]byte, 24)
	if _, err := io.ReadFull(rand.Reader, value); err != nil {
		return "", err
	}
	return hex.EncodeToString(value), nil
}

func remarshal(value any, target any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	decoder := json.NewDecoder(strings.NewReader(string(data)))
	decoder.DisallowUnknownFields()
	return decoder.Decode(target)
}

func closeArtifacts(artifacts []*artifactgate.VerifiedArtifact) {
	for _, artifact := range artifacts {
		if artifact != nil {
			_ = artifact.Close()
		}
	}
}

func errorCode(err error) string {
	var securityErr *security.SecurityError
	if errors.As(err, &securityErr) {
		return securityErr.Code
	}
	return "ml_gateway_error"
}
