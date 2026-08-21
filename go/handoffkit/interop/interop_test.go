package interop_test

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	goruntime "runtime"
	"testing"
	"time"

	"github.com/DaosPath/handoffkit/go/contract"
	"github.com/DaosPath/handoffkit/go/protocol"
	"github.com/DaosPath/handoffkit/go/transport"
)

func repositoryRoot(t *testing.T) string {
	t.Helper()
	_, filename, _, ok := goruntime.Caller(0)
	if !ok {
		t.Fatal("cannot locate interoperability test")
	}
	return filepath.Clean(filepath.Join(filepath.Dir(filename), "..", "..", ".."))
}

func fixture(t *testing.T, root string) any {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(root, "shared", "contracts", "fixtures", "handoff_state.json"))
	if err != nil {
		t.Fatal(err)
	}
	var value any
	if err := json.Unmarshal(data, &value); err != nil {
		t.Fatal(err)
	}
	return value
}

func exerciseWorker(t *testing.T, argv []string, expectedRuntime string, wrapped bool) {
	t.Helper()
	if os.Getenv("HANDOFFKIT_RUN_INTEROP_TESTS") != "1" {
		t.Skip("set HANDOFFKIT_RUN_INTEROP_TESTS=1 to run process interoperability tests")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	wire, err := transport.Spawn(ctx, argv, contract.DefaultMaxMessageBytes)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = wire.Close() }()

	sessionID := "go-" + expectedRuntime + "-interop"
	config := contract.NewSessionConfig(sessionID)
	ready, err := protocol.ClientHandshake(ctx, wire, config, "go-test", []string{"handoff_state"})
	if err != nil {
		t.Fatal(err)
	}
	if ready.PeerRuntime != expectedRuntime {
		t.Fatalf("expected %s peer, got %s", expectedRuntime, ready.PeerRuntime)
	}

	root := repositoryRoot(t)
	payload := fixture(t, root)
	target := expectedRuntime + "-worker"
	key := "go-request-" + expectedRuntime
	request := contract.MessageEnvelope{
		ProtocolVersion: contract.ProtocolVersion,
		MessageID:       key,
		SessionID:       sessionID,
		Channel:         "requests",
		Kind:            "request",
		Source:          "go-test",
		Target:          &target,
		Sequence:        1,
		CreatedAt:       contract.UTCNow(),
		IdempotencyKey:  &key,
		Attempt:         1,
		PayloadType:     "handoff_state",
		Payload:         payload,
		Metadata:        map[string]any{},
	}
	if err := wire.Send(ctx, request); err != nil {
		t.Fatal(err)
	}
	response, err := wire.Receive(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if response.Kind != "result" || response.CorrelationID == nil || *response.CorrelationID != request.MessageID {
		t.Fatalf("uncorrelated response: %#v", response)
	}
	actual := response.Payload
	if wrapped {
		object, ok := response.Payload.(map[string]any)
		if !ok || object["runtime"] != expectedRuntime {
			t.Fatalf("unexpected wrapped payload: %#v", response.Payload)
		}
		actual = object["handoff_state"]
	}
	actualJSON, err := json.Marshal(actual)
	if err != nil {
		t.Fatal(err)
	}
	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	if string(actualJSON) != string(payloadJSON) {
		t.Fatalf("handoff payload changed across runtimes")
	}

	closeKey := "go-close-" + expectedRuntime
	closing := contract.MessageEnvelope{
		ProtocolVersion: contract.ProtocolVersion,
		MessageID:       closeKey,
		SessionID:       sessionID,
		Channel:         "control",
		Kind:            "session_close",
		Source:          "go-test",
		Target:          &target,
		Sequence:        2,
		CreatedAt:       contract.UTCNow(),
		IdempotencyKey:  &closeKey,
		Attempt:         1,
		PayloadType:     "json",
		Payload:         map[string]any{},
		Metadata:        map[string]any{},
	}
	if err := wire.Send(ctx, closing); err != nil {
		t.Fatal(err)
	}
	closed, err := wire.Receive(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if closed.Kind != "session_closed" || closed.CorrelationID == nil || *closed.CorrelationID != closing.MessageID {
		t.Fatalf("uncorrelated close response: %#v", closed)
	}
}

func TestGoStartsPythonWorker(t *testing.T) {
	root := repositoryRoot(t)
	exerciseWorker(t, []string{"python", filepath.Join(root, "packages", "python", "examples", "csp_rust_worker.py")}, "python", true)
}

func TestGoStartsJavaScriptWorker(t *testing.T) {
	root := repositoryRoot(t)
	exerciseWorker(t, []string{"node", filepath.Join(root, "packages", "js", "node", "examples", "csp_worker.mjs")}, "javascript", true)
}

func TestGoStartsRustWorker(t *testing.T) {
	root := repositoryRoot(t)
	binary := os.Getenv("HANDOFFKIT_RUST_BIN")
	if binary == "" {
		binary = filepath.Join(root, "packages", "rust", "target", "debug", "handoffkit-rs")
		if goruntime.GOOS == "windows" {
			binary += ".exe"
		}
	}
	exerciseWorker(t, []string{binary, "csp", "worker"}, "rust-worker", false)
}
