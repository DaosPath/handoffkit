//go:build cppmlintegration

package mlgateway

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/DaosPath/handoffkit/go/artifactgate"
	"github.com/DaosPath/handoffkit/go/contract"
	"github.com/DaosPath/handoffkit/go/edgeprofile"
	"github.com/DaosPath/handoffkit/go/internal/testsupport"
	"github.com/DaosPath/handoffkit/go/security"
	"github.com/DaosPath/handoffkit/go/studioevents"
	"github.com/DaosPath/handoffkit/go/transport"
)

const gatewayTrustDomain = "handoffkit.internal"

type gatewayHarness struct {
	t                  *testing.T
	root               string
	tlsRoot            string
	listener           net.Listener
	gateway            *Gateway
	cancel             context.CancelFunc
	clientConfig       transport.Config
	clientIdentity     security.PeerIdentity
	inputSigner        *security.ArtifactSigner
	inputTrust         *security.ArtifactTrustPolicy
	resultTrust        *security.ArtifactTrustPolicy
	dataset            contract.ArtifactRef
	unauthorizedOutput string
	studioPath         string
}

func TestSecureCppMLGatewayProcessRoute(t *testing.T) {
	harness := newGatewayHarness(t)
	defer harness.close()

	t.Run("mTLS training progress checkpoint signature and durable reconnect", func(t *testing.T) {
		client := harness.dial(t)
		request := harness.trainingEnvelope(t, "session-train", "job-train", "idem-train", 1, harness.dataset, 4)
		if err := client.Send(context.Background(), request); err != nil {
			t.Fatal(err)
		}
		responses := receiveJob(t, client, "job-train", 30*time.Second, harness.gateway.workerDiagnostic)
		if !responses.progress || !responses.accepted || responses.result == nil {
			t.Fatalf("incomplete remote route: %#v; worker: %s", responses, harness.gateway.workerDiagnostic())
		}
		harness.verifySignedResult(t, responses.result)
		if _, err := os.Stat(harness.unauthorizedOutput); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("remote output path was not overridden: %v", err)
		}
		_ = client.Close()

		reconnected := harness.dial(t)
		replay := harness.trainingEnvelope(t, "session-reconnect", "job-train", "idem-train", 1, harness.dataset, 4)
		if err := reconnected.Send(context.Background(), replay); err != nil {
			t.Fatal(err)
		}
		stored := receiveJob(t, reconnected, "job-train", 5*time.Second, harness.gateway.workerDiagnostic)
		if stored.result == nil || stored.progress {
			t.Fatalf("durable result was not replayed without rerunning compute: %#v", stored)
		}
		if stored.result.URI != responses.result.URI {
			t.Fatalf("durable result URI changed: %s != %s", stored.result.URI, responses.result.URI)
		}
		_ = reconnected.Close()
	})

	t.Run("artifact rejection happens before worker consumption", func(t *testing.T) {
		client := harness.dial(t)
		bad := harness.dataset
		bad.SHA256 = strings.Repeat("0", 64)
		request := harness.trainingEnvelope(t, "session-bad", "job-bad", "idem-bad", 1, bad, 1)
		if err := client.Send(context.Background(), request); err != nil {
			t.Fatal(err)
		}
		response := receiveEnvelope(t, client, 5*time.Second)
		if response.Kind != "delivery_nack" || response.Payload.(map[string]any)["code"] != "artifact_integrity_mismatch" {
			t.Fatalf("unexpected artifact rejection: %#v", response)
		}
		_ = client.Close()
	})

	t.Run("cancel and deadline are delivered through the real process", func(t *testing.T) {
		client := harness.dial(t)
		request := harness.trainingEnvelope(t, "session-cancel", "job-cancel", "idem-cancel", 1, harness.dataset, 100000)
		if err := client.Send(context.Background(), request); err != nil {
			t.Fatal(err)
		}
		waitForProgress(t, client, "job-cancel", 10*time.Second)
		cancelID := "cancel-request"
		cancel := harness.secureEnvelope(
			"session-cancel", cancelID, "job_cancel", 2, "job:cancel",
			map[string]any{"job_id": "job-cancel"}, nil)
		if err := client.Send(context.Background(), cancel); err != nil {
			t.Fatal(err)
		}
		code := waitForNack(t, client, "job-cancel", 10*time.Second)
		if code != "job_cancelled" {
			t.Fatalf("cancel returned %s", code)
		}
		_ = client.Close()

		deadlineClient := harness.dial(t)
		deadline := harness.trainingEnvelope(t, "session-deadline", "job-deadline", "idem-deadline", 1, harness.dataset, 100000)
		value := time.Now().Add(250 * time.Millisecond).UTC().Format(time.RFC3339Nano)
		deadline.Deadline = &value
		job := decodeTrainingJob(t, deadline.Payload)
		job.Deadline = &value
		deadline.Payload = job
		if err := deadlineClient.Send(context.Background(), deadline); err != nil {
			t.Fatal(err)
		}
		if code := waitForNack(t, deadlineClient, "job-deadline", 10*time.Second); code != "deadline_exceeded" {
			t.Fatalf("deadline returned %s", code)
		}
		_ = deadlineClient.Close()
	})

	t.Run("worker crash is structured and next process reconnects", func(t *testing.T) {
		client := harness.dial(t)
		request := harness.trainingEnvelope(t, "session-crash", "job-crash", "idem-crash", 1, harness.dataset, 100000)
		if err := client.Send(context.Background(), request); err != nil {
			t.Fatal(err)
		}
		waitForProgress(t, client, "job-crash", 10*time.Second)
		harness.gateway.workerMu.Lock()
		worker := harness.gateway.worker
		harness.gateway.workerMu.Unlock()
		if worker == nil {
			t.Fatal("cpp-ml worker process is not running")
		}
		if err := worker.Terminate(); err != nil {
			t.Fatal(err)
		}
		if code := waitForNack(t, client, "job-crash", 10*time.Second); code != "worker_crashed" {
			t.Fatalf("worker crash returned %s", code)
		}
		_ = client.Close()

		restarted := harness.dial(t)
		next := harness.trainingEnvelope(t, "session-after-crash", "job-after-crash", "idem-after-crash", 1, harness.dataset, 1)
		if err := restarted.Send(context.Background(), next); err != nil {
			t.Fatal(err)
		}
		responses := receiveJob(t, restarted, "job-after-crash", 20*time.Second, harness.gateway.workerDiagnostic)
		if responses.result == nil {
			t.Fatalf("replacement worker did not finish: %#v", responses)
		}
		_ = restarted.Close()
	})

	t.Run("replay and operation mismatch are visible after real rejection", func(t *testing.T) {
		client := harness.dial(t)
		request := harness.secureEnvelope(
			"session-replay", "inspect-replay", "worker_capabilities", 1,
			"worker:inspect", map[string]any{}, nil)
		if err := client.Send(context.Background(), request); err != nil {
			t.Fatal(err)
		}
		if response := receiveEnvelope(t, client, 5*time.Second); response.Kind != "worker_capabilities" {
			t.Fatalf("unexpected worker inspection response: %#v", response)
		}
		if err := client.Send(context.Background(), request); err != nil {
			t.Fatal(err)
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if _, err := client.Receive(ctx); err == nil {
			t.Fatal("replayed authenticated frame remained connected")
		}
		_ = client.Close()

		mismatchClient := harness.dial(t)
		mismatch := harness.secureEnvelope(
			"session-authorization", "inspect-mismatch", "worker_capabilities", 1,
			"job:training", map[string]any{}, nil)
		if err := mismatchClient.Send(context.Background(), mismatch); err != nil {
			t.Fatal(err)
		}
		response := receiveEnvelope(t, mismatchClient, 5*time.Second)
		if response.Kind != "delivery_nack" || response.Payload.(map[string]any)["code"] != "operation_mismatch" {
			t.Fatalf("unexpected operation mismatch response: %#v", response)
		}
		_ = mismatchClient.Close()
	})

	t.Run("Studio stream contains only real sanitized route evidence", func(t *testing.T) {
		deadline := time.Now().Add(5 * time.Second)
		var events []studioevents.Event
		for time.Now().Before(deadline) {
			data, err := os.ReadFile(harness.studioPath)
			if err == nil {
				events, err = studioevents.ParseNDJSON(data)
				if err == nil && len(events) >= 20 {
					break
				}
			}
			time.Sleep(25 * time.Millisecond)
		}
		if len(events) < 20 {
			t.Fatalf("Studio stream did not receive the real gateway route: %d events", len(events))
		}
		var sessionTLS, progress, completed, reconnect, replay, authorization bool
		var verifiedArtifact, rejectedArtifact, runtimeStatus, actualWorker bool
		for _, event := range events {
			switch event.EventType {
			case studioevents.EventSessionObserved, studioevents.EventSessionReconnected:
				var payload studioevents.Session
				if err := json.Unmarshal(event.Payload, &payload); err != nil {
					t.Fatal(err)
				}
				if payload.PeerID == harness.clientIdentity.PeerID && payload.TLSVersion == "TLSv1.3" &&
					payload.IdentitySource == "certificate-san" && payload.SecurityProfile == "standard" {
					sessionTLS = true
				}
				if event.EventType == studioevents.EventSessionReconnected && payload.Reconnects > 0 {
					reconnect = true
				}
			case studioevents.EventSecurityRejected:
				var payload studioevents.Rejection
				if err := json.Unmarshal(event.Payload, &payload); err != nil {
					t.Fatal(err)
				}
				replay = replay || payload.Category == "replay"
				authorization = authorization || payload.Category == "authorization"
			case studioevents.EventJobUpdated:
				var payload studioevents.Job
				if err := json.Unmarshal(event.Payload, &payload); err != nil {
					t.Fatal(err)
				}
				progress = progress || payload.Status == "running" && payload.Progress > 0
				completed = completed || payload.Status == "completed"
				actualWorker = actualWorker || payload.WorkerID != nil && *payload.WorkerID == "cpp-ml-worker-1"
			case studioevents.EventArtifactVerified:
				var payload studioevents.Artifact
				if err := json.Unmarshal(event.Payload, &payload); err != nil {
					t.Fatal(err)
				}
				verifiedArtifact = verifiedArtifact || payload.Verification == "verified" &&
					payload.IdentitySource == "verified-signer" && payload.SignerFingerprint != nil
				rejectedArtifact = rejectedArtifact || payload.Verification == "rejected" &&
					payload.ErrorCode != nil && *payload.ErrorCode == "artifact_integrity_mismatch"
			case studioevents.EventRuntimeStatus:
				runtimeStatus = true
			}
		}
		if !sessionTLS || !progress || !completed || !reconnect || !replay || !authorization ||
			!verifiedArtifact || !rejectedArtifact || !runtimeStatus || !actualWorker {
			t.Fatalf("incomplete Studio evidence: session=%v progress=%v completed=%v reconnect=%v replay=%v authorization=%v verified=%v rejected=%v runtime=%v worker=%v",
				sessionTLS, progress, completed, reconnect, replay, authorization,
				verifiedArtifact, rejectedArtifact, runtimeStatus, actualWorker)
		}
		raw, err := os.ReadFile(harness.studioPath)
		if err != nil {
			t.Fatal(err)
		}
		for _, forbidden := range []string{
			harness.root, harness.tlsRoot, harness.dataset.URI,
			harness.clientIdentity.CredentialFingerprint, "PRIVATE KEY", "public_key_pem",
		} {
			if forbidden != "" && strings.Contains(string(raw), forbidden) {
				t.Fatalf("Studio stream exposed forbidden runtime material: %q", forbidden)
			}
		}
	})
}

func newGatewayHarness(t *testing.T) *gatewayHarness {
	t.Helper()
	workerBinary := os.Getenv("HANDOFFKIT_CPP_ML_WORKER")
	if workerBinary == "" {
		t.Fatal("HANDOFFKIT_CPP_ML_WORKER must point to the built cpp-ml worker")
	}
	workerBinary, err := filepath.Abs(workerBinary)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(workerBinary); err != nil {
		t.Fatalf("cpp-ml worker is unavailable: %v", err)
	}
	tlsRoot, cleanupTLS, err := testsupport.GenerateTLSFixtures()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(cleanupTLS)
	root := t.TempDir()
	originalRoot := filepath.Join(root, "inputs")
	gatewaySnapshots := filepath.Join(root, "gateway-input-snapshots")
	cppSnapshots := filepath.Join(root, "cpp-snapshots")
	outputRoot := filepath.Join(root, "outputs")
	resultSnapshots := filepath.Join(root, "result-artifacts")
	for _, directory := range []string{originalRoot, gatewaySnapshots, cppSnapshots, outputRoot, resultSnapshots} {
		if err := os.MkdirAll(directory, 0o700); err != nil {
			t.Fatal(err)
		}
	}

	inputPublic, inputPrivate, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	inputIdentity := "spiffe://handoffkit.internal/producer/test-dataset"
	inputSigner := &security.ArtifactSigner{PrivateKey: inputPrivate, SignerIdentity: inputIdentity}
	revocations, err := security.NewDurableRevocationPolicy(
		filepath.Join(root, "revocations.json"), security.DefaultDurableRevocationOptions())
	if err != nil {
		t.Fatal(err)
	}
	inputTrust := security.NewArtifactTrustPolicy([]security.ArtifactSigningCredential{{
		SignerIdentity: inputIdentity, PublicKey: inputPublic,
		ValidFrom: time.Now().Add(-time.Hour).Unix(), ValidUntil: time.Now().Add(time.Hour).Unix(),
	}})
	inputTrust.RevocationPolicy = revocations
	inputGate, err := artifactgate.New(artifactgate.Policy{
		HashRequired: true, SignatureRequirement: artifactgate.SignatureRequired,
		TrustedProducers:  map[string]bool{inputIdentity: true},
		TrustedSigners:    map[string]bool{inputIdentity: true},
		AllowedMediaTypes: map[string]bool{"application/x-ndjson": true},
		MaxSizeBytes:      1024 * 1024, AllowedRoots: []string{originalRoot},
		SnapshotDirectory: gatewaySnapshots, QuarantineDirectory: filepath.Join(root, "input-quarantine"),
		SignaturePolicy: inputTrust,
	})
	if err != nil {
		t.Fatal(err)
	}

	resultPublic, resultPrivate, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	resultIdentity := "spiffe://handoffkit.internal/producer/ml-gateway"
	resultSigner := &security.ArtifactSigner{PrivateKey: resultPrivate, SignerIdentity: resultIdentity}
	resultTrust := security.NewArtifactTrustPolicy([]security.ArtifactSigningCredential{{
		SignerIdentity: resultIdentity, PublicKey: resultPublic,
		ValidFrom: time.Now().Add(-time.Hour).Unix(), ValidUntil: time.Now().Add(time.Hour).Unix(),
	}})
	resultGate, err := artifactgate.New(artifactgate.Policy{
		HashRequired: true, SignatureRequirement: artifactgate.SignatureOptional,
		AllowedMediaTypes: map[string]bool{
			"application/vnd.handoffkit.checkpoint": true, "application/json": true,
		},
		MaxSizeBytes: 64 * 1024 * 1024, AllowedRoots: []string{outputRoot},
		SnapshotDirectory: resultSnapshots, QuarantineDirectory: filepath.Join(root, "result-quarantine"),
	})
	if err != nil {
		t.Fatal(err)
	}

	datasetPath := filepath.Join(originalRoot, "dataset.jsonl")
	datasetData := []byte("{\"prompt\":\"P:\",\"completion\":\" MARK42\"}\n{\"prompt\":\"Q:\",\"completion\":\" ANSWER\"}\n")
	if err := os.WriteFile(datasetPath, datasetData, 0o600); err != nil {
		t.Fatal(err)
	}
	signedDataset, err := inputSigner.SignArtifact("dataset-1", datasetData, time.Now().Unix())
	if err != nil {
		t.Fatal(err)
	}
	dataset := contract.ArtifactRef{
		ArtifactID: "dataset-1", URI: testFileURI(datasetPath),
		SHA256: signedDataset.ContentHash, SizeBytes: uint64(len(datasetData)),
		MediaType: "application/x-ndjson",
		Metadata: map[string]any{
			"producer_identity": inputIdentity, "signed_artifact": signedDataset,
		},
	}

	publicDER, err := x509.MarshalPKIXPublicKey(inputPublic)
	if err != nil {
		t.Fatal(err)
	}
	publicPEM := string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: publicDER}))
	workerPolicyPath := filepath.Join(root, "cpp-worker-policy.json")
	workerPolicy := map[string]any{
		"format": "handoffkit-cpp-ml-worker-policy", "version": 1,
		"worker_id": "cpp-ml-worker-1", "worker_threads": 1, "queue_capacity": 4,
		"output_root": outputRoot, "hash_required": true, "signature_requirement": "required",
		"trusted_producers": []string{inputIdentity}, "trusted_signers": []string{inputIdentity},
		"allowed_media_types": []string{"application/x-ndjson", "application/vnd.handoffkit.checkpoint"},
		"max_size_bytes":      64 * 1024 * 1024, "allowed_roots": []string{gatewaySnapshots},
		"snapshot_directory": cppSnapshots, "quarantine_directory": filepath.Join(root, "cpp-quarantine"),
		"signing_credentials": []map[string]any{{
			"signer_identity": inputIdentity, "public_key_pem": publicPEM,
			"valid_from": time.Now().Add(-time.Hour).Unix(), "valid_until": time.Now().Add(time.Hour).Unix(),
			"revoked": false,
		}},
	}
	writeJSON(t, workerPolicyPath, workerPolicy)

	serverCapabilities := []string{"job:result", "worker:inspect"}
	clientCapabilities := []string{"job:training", "job:evaluation", "job:cancel", "worker:inspect"}
	serverIdentity := fixtureIdentity(t, tlsRoot, "server", serverCapabilities)
	clientIdentity := fixtureIdentity(t, tlsRoot, "client", clientCapabilities)
	serverConfig := secureGatewayTransportConfig(t, tlsRoot, "server", "client", clientCapabilities, []string{
		"job:training", "job:evaluation", "job:cancel", "worker:inspect",
	}, filepath.Join(root, "server-replay.json"))
	clientConfig := secureGatewayTransportConfig(t, tlsRoot, "client", "server", serverCapabilities, []string{
		"job:result", "worker:inspect",
	}, filepath.Join(root, "client-replay.json"))
	clientConfig.ServerName = "localhost"
	profile, err := edgeprofile.Preset(edgeprofile.EdgeStandard)
	if err != nil {
		t.Fatal(err)
	}
	serverConfig, err = profile.ApplyTransport(serverConfig)
	if err != nil {
		t.Fatal(err)
	}
	clientConfig, err = profile.ApplyTransport(clientConfig)
	if err != nil {
		t.Fatal(err)
	}
	listener, err := transport.ListenTCP("127.0.0.1:0", serverConfig)
	if err != nil {
		t.Fatal(err)
	}
	store, err := NewJobStore(filepath.Join(root, "jobs.json"), DefaultJobStoreOptions())
	if err != nil {
		t.Fatal(err)
	}
	studioPath := filepath.Join(root, "studio", "security-events.ndjson")
	studioSink, err := studioevents.NewFileSink(studioPath, studioevents.DefaultFileOptions())
	if err != nil {
		t.Fatal(err)
	}
	gateway, err := New(Config{
		Transport: serverConfig, WorkerCommand: []string{workerBinary, "--policy", workerPolicyPath},
		WorkerIdentity: "cpp-ml-worker-1",
		ArtifactGate:   inputGate, ResultGate: resultGate, ResultSigner: resultSigner,
		JobStore: store, EdgeProfile: &profile, LocalIdentity: &serverIdentity, MaxConnections: 8,
		WorkerMaxMessageBytes: contract.DefaultMaxMessageBytes, StudioEvents: studioSink,
	})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	serveResult := make(chan error, 1)
	go func() { serveResult <- gateway.Serve(ctx, listener) }()
	t.Cleanup(func() {
		cancel()
		_ = listener.Close()
		_ = gateway.Close()
		select {
		case err := <-serveResult:
			if err != nil {
				t.Errorf("gateway serve failed: %v", err)
			}
		case <-time.After(5 * time.Second):
			t.Error("gateway did not stop")
		}
	})
	return &gatewayHarness{
		t: t, root: root, tlsRoot: tlsRoot, listener: listener, gateway: gateway, cancel: cancel,
		clientConfig: clientConfig, clientIdentity: clientIdentity,
		inputSigner: inputSigner, inputTrust: inputTrust, resultTrust: resultTrust,
		dataset: dataset, unauthorizedOutput: filepath.Join(root, "unauthorized-output"),
		studioPath: studioPath,
	}
}

func (harness *gatewayHarness) close() {}

func (harness *gatewayHarness) dial(t *testing.T) *transport.LengthDelimited {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	wire, err := transport.DialTCP(ctx, harness.listener.Addr().String(), harness.clientConfig)
	if err != nil {
		t.Fatal(err)
	}
	return wire
}

func (harness *gatewayHarness) trainingEnvelope(
	t *testing.T,
	session, jobID, idempotency string,
	sequence uint64,
	dataset contract.ArtifactRef,
	epochs int,
) contract.MessageEnvelope {
	t.Helper()
	job := contract.TrainingJob{
		JobID: jobID, Dataset: dataset, Output: testFileURI(harness.unauthorizedOutput),
		Config: map[string]any{
			"epochs": epochs, "block_size": 16, "n_embd": 16, "n_head": 2, "n_layer": 1,
			"lr": 0.01, "allow_tiny": true, "require_loss_drop": false,
			"tokenizer": "byte", "device": "cpu", "profile": "test", "log_every": 1,
		},
		RequestedCapabilities: []string{"cpu"}, IdempotencyKey: idempotency,
		Metadata: map[string]any{},
	}
	return harness.secureEnvelope(
		session, jobID+"-request", "training_job", sequence, "job:training", job, &idempotency)
}

func (harness *gatewayHarness) secureEnvelope(
	session, messageID, kind string,
	sequence uint64,
	operation string,
	payload any,
	idempotency *string,
) contract.MessageEnvelope {
	return contract.MessageEnvelope{
		ProtocolVersion: contract.ProtocolVersion, MessageID: messageID, SessionID: session,
		Channel: "jobs", Kind: kind, Source: harness.clientIdentity.PeerID,
		Sequence: sequence, CreatedAt: contract.UTCNow(), IdempotencyKey: idempotency,
		Attempt: 1, PayloadType: "json", Payload: payload,
		Metadata: map[string]any{
			"peer_identity": harness.clientIdentity, "security_nonce": fmt.Sprintf("nonce-%s-%d", session, sequence),
			"operation": operation,
		},
	}
}

type jobResponses struct {
	accepted bool
	progress bool
	result   *contract.ArtifactRef
}

func receiveJob(
	t *testing.T,
	wire *transport.LengthDelimited,
	jobID string,
	timeout time.Duration,
	diagnostic func() string,
) jobResponses {
	t.Helper()
	deadline := time.Now().Add(timeout)
	result := jobResponses{}
	for time.Now().Before(deadline) {
		envelope := receiveEnvelope(t, wire, time.Until(deadline))
		switch envelope.Kind {
		case "job_accepted":
			result.accepted = true
		case "job_progress":
			payload := envelope.Payload.(map[string]any)
			if payload["job_id"] == jobID {
				result.progress = true
			}
		case "job_result":
			var reference contract.ArtifactRef
			if err := remarshal(envelope.Payload, &reference); err != nil {
				t.Fatal(err)
			}
			result.result = &reference
			return result
		case "delivery_nack":
			t.Fatalf("job %s failed: %#v; worker: %s", jobID, envelope.Payload, diagnostic())
		}
	}
	t.Fatalf("timed out waiting for job %s", jobID)
	return result
}

func waitForProgress(t *testing.T, wire *transport.LengthDelimited, jobID string, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		envelope := receiveEnvelope(t, wire, time.Until(deadline))
		if envelope.Kind == "job_progress" && envelope.Payload.(map[string]any)["job_id"] == jobID {
			return
		}
		if envelope.Kind == "delivery_nack" {
			t.Fatalf("job failed before progress: %#v", envelope.Payload)
		}
	}
	t.Fatalf("timed out waiting for progress for %s", jobID)
}

func waitForNack(t *testing.T, wire *transport.LengthDelimited, jobID string, timeout time.Duration) string {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		envelope := receiveEnvelope(t, wire, time.Until(deadline))
		if envelope.Kind != "delivery_nack" {
			continue
		}
		payload := envelope.Payload.(map[string]any)
		metadata, _ := payload["metadata"].(map[string]any)
		if metadata["job_id"] == jobID {
			return payload["code"].(string)
		}
	}
	t.Fatalf("timed out waiting for failure for %s", jobID)
	return ""
}

func receiveEnvelope(t *testing.T, wire *transport.LengthDelimited, timeout time.Duration) contract.MessageEnvelope {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	envelope, err := wire.Receive(ctx)
	if err != nil {
		t.Fatal(err)
	}
	return envelope
}

func (harness *gatewayHarness) verifySignedResult(t *testing.T, reference *contract.ArtifactRef) {
	t.Helper()
	path := testFilePath(t, reference.URI)
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var signed security.SignedArtifact
	if err := remarshal(reference.Metadata["signed_artifact"], &signed); err != nil {
		t.Fatal(err)
	}
	if err := security.VerifySignedArtifact(data, signed, harness.resultTrust, time.Now().Unix()); err != nil {
		t.Fatal(err)
	}
	if reference.Metadata["producer_identity"] != signed.SignerIdentity {
		t.Fatal("result producer is not bound to its verified signer")
	}
}

func secureGatewayTransportConfig(
	t *testing.T,
	tlsRoot, own, accepted string,
	acceptedCapabilities, allowedOperations []string,
	replayPath string,
) transport.Config {
	t.Helper()
	acceptedCertificate := fixtureCertificate(t, tlsRoot, accepted)
	grants := map[string][]string{
		security.CertificateFingerprint(acceptedCertificate): acceptedCapabilities,
	}
	identityPolicy := security.NewCertificateIdentityPolicy(gatewayTrustDomain, grants)
	identityPolicy.AllowedIssuerNames[acceptedCertificate.Issuer.String()] = true
	revocations, err := security.NewDurableRevocationPolicy(
		replayPath+".revocations", security.DefaultDurableRevocationOptions())
	if err != nil {
		t.Fatal(err)
	}
	identityPolicy.RevocationPolicy = revocations
	replayOptions := security.DefaultDurableReplayOptions()
	replayOptions.WindowSeconds = 60
	replayOptions.MaxClockSkewSeconds = 5
	replay, err := security.NewDurableReplayProtection(replayPath, replayOptions)
	if err != nil {
		t.Fatal(err)
	}
	config := transport.DefaultConfig()
	config.ConnectTimeout = 3 * time.Second
	config.IOTimeout = 30 * time.Second
	config.ServerName = "localhost"
	config.SecurityConfig = &security.SecurityConfig{
		Profile: security.SecurityProfileStandard, RequireMTLS: true, TrustDomain: gatewayTrustDomain,
		CACertPath: filepath.Join(tlsRoot, "ca_cert.pem"),
		CertPath:   filepath.Join(tlsRoot, own+"_cert.pem"), KeyPath: filepath.Join(tlsRoot, own+"_key.pem"),
		ReplayWindowSeconds: 60, MaxClockSkewSeconds: 5,
	}
	config.IdentityPolicy = identityPolicy
	config.CapabilityPolicy = security.NewCapabilityPolicy(allowedOperations, nil)
	config.ReplayProtection = replay
	return config
}

func fixtureCertificate(t *testing.T, root, name string) *x509.Certificate {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(root, name+"_cert.pem"))
	if err != nil {
		t.Fatal(err)
	}
	block, _ := pem.Decode(data)
	if block == nil {
		t.Fatal("fixture has no certificate")
	}
	certificate, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		t.Fatal(err)
	}
	return certificate
}

func fixtureIdentity(t *testing.T, root, name string, capabilities []string) security.PeerIdentity {
	t.Helper()
	certificate := fixtureCertificate(t, root, name)
	if len(certificate.URIs) != 1 {
		t.Fatal("fixture must have one URI SAN")
	}
	parts := strings.FieldsFunc(certificate.URIs[0].Path, func(value rune) bool { return value == '/' })
	identity := security.PeerIdentity{
		PeerID: parts[1], NodeID: parts[3], TrustDomain: certificate.URIs[0].Hostname(),
		CredentialFingerprint: security.CertificateFingerprint(certificate),
		Capabilities:          append([]string(nil), capabilities...),
		IssuedAt:              certificate.NotBefore.Unix(), ExpiresAt: certificate.NotAfter.Unix(),
	}
	if len(parts) == 6 {
		identity.WorkerID = parts[5]
	}
	return identity
}

func writeJSON(t *testing.T, path string, value any) {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
}

func testFileURI(path string) string {
	value := filepath.ToSlash(path)
	if runtime.GOOS == "windows" && !strings.HasPrefix(value, "/") {
		value = "/" + value
	}
	return (&url.URL{Scheme: "file", Path: value}).String()
}

func testFilePath(t *testing.T, raw string) string {
	t.Helper()
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "file" {
		t.Fatalf("invalid file URI: %s", raw)
	}
	path := filepath.FromSlash(parsed.Path)
	if runtime.GOOS == "windows" && len(path) >= 3 && path[0] == filepath.Separator && path[2] == ':' {
		path = path[1:]
	}
	return path
}

func decodeTrainingJob(t *testing.T, value any) contract.TrainingJob {
	t.Helper()
	var job contract.TrainingJob
	if err := remarshal(value, &job); err != nil {
		t.Fatal(err)
	}
	return job
}
