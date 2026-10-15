package studioevents

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
)

func sharedFixture(t testing.TB) []byte {
	t.Helper()
	_, source, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("cannot locate shared Studio event fixture")
	}
	data, err := os.ReadFile(filepath.Join(
		filepath.Dir(source), "..", "..", "..", "shared", "contracts", "test-fixtures", "security",
		"studio-security-events-v1.ndjson",
	))
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestSharedStudioSecurityEventsValidate(t *testing.T) {
	events, err := ParseNDJSON(sharedFixture(t))
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 8 {
		t.Fatalf("expected 8 events, got %d", len(events))
	}
	if events[0].EventType != EventSessionObserved || events[len(events)-1].EventType != EventRuntimeStatus {
		t.Fatalf("unexpected event corpus: %#v", events)
	}
	truncated, err := TruncateFingerprint("sha256:" + strings.Repeat("ab", 32))
	if err != nil || truncated != "sha256:abababababab...abababab" {
		t.Fatalf("unexpected truncated fingerprint: %q %v", truncated, err)
	}
}

func TestStudioEventsRejectSecretsAndUntruncatedIdentity(t *testing.T) {
	var event Event
	if err := json.Unmarshal([]byte(strings.Split(string(sharedFixture(t)), "\n")[0]), &event); err != nil {
		t.Fatal(err)
	}
	var session Session
	if err := json.Unmarshal(event.Payload, &session); err != nil {
		t.Fatal(err)
	}
	session.CredentialFingerprint = "sha256:" + strings.Repeat("a", 64)
	event.Payload, _ = json.Marshal(session)
	if err := event.Validate(); err == nil {
		t.Fatal("full fingerprint was accepted")
	}

	rejection, err := New("go", "edge-small", EventSecurityRejected, Rejection{
		Category: "worker", Code: "worker_error", Message: "Bearer private-token at /tmp/worker.log",
	})
	if err == nil || rejection.EventID != "" {
		t.Fatal("sensitive rejection was accepted")
	}
}

func TestFileSinkIsBoundedAtomicAndRejectsCorruption(t *testing.T) {
	path := filepath.Join(t.TempDir(), "studio", "events.ndjson")
	sink, err := NewFileSink(path, FileOptions{MaxEvents: 2, MaxFileBytes: 4096})
	if err != nil {
		t.Fatal(err)
	}
	for index := 0; index < 3; index++ {
		event, err := New("go", "edge-small", EventRuntimeStatus, RuntimeStatus{
			Connections: index, ConnectionLimit: 8, Queue: Queue{Pending: 0, Capacity: 16},
			HybridPQProviderState: "unavailable",
		})
		if err != nil {
			t.Fatal(err)
		}
		if err := sink.Emit(event); err != nil {
			t.Fatal(err)
		}
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	events, err := ParseNDJSON(data)
	if err != nil || len(events) != 2 {
		t.Fatalf("bounded event file is invalid: %d %v", len(events), err)
	}
	if metadata, err := os.Stat(path); err != nil || runtime.GOOS != "windows" && metadata.Mode().Perm() != 0o600 {
		t.Fatalf("event file permissions are not private: %#v %v", metadata, err)
	}

	if err := os.WriteFile(path, []byte("{truncated"), 0o600); err != nil {
		t.Fatal(err)
	}
	event, _ := New("go", "edge-small", EventRuntimeStatus, RuntimeStatus{
		ConnectionLimit: 8, Queue: Queue{Capacity: 16}, HybridPQProviderState: "unavailable",
	})
	if err := sink.Emit(event); err == nil {
		t.Fatal("corrupt event state was silently overwritten")
	}
	corrupt, _ := os.ReadFile(path)
	if string(corrupt) != "{truncated" {
		t.Fatal("corrupt event evidence was modified")
	}
}

func TestFileSinkSerializesConcurrentEventsMonotonically(t *testing.T) {
	path := filepath.Join(t.TempDir(), "studio", "events.ndjson")
	sink, err := NewFileSink(path, FileOptions{MaxEvents: 64, MaxFileBytes: 64 * 1024})
	if err != nil {
		t.Fatal(err)
	}
	var wait sync.WaitGroup
	errorsSeen := make(chan error, 32)
	for index := 0; index < 32; index++ {
		wait.Add(1)
		go func() {
			defer wait.Done()
			event, eventErr := New("go", "edge-small", EventRuntimeStatus, RuntimeStatus{
				ConnectionLimit: 8, Queue: Queue{Capacity: 16},
				HybridPQProviderState: "unavailable",
			})
			if eventErr == nil {
				eventErr = sink.Emit(event)
			}
			if eventErr != nil {
				errorsSeen <- eventErr
			}
		}()
	}
	wait.Wait()
	close(errorsSeen)
	for eventErr := range errorsSeen {
		t.Fatal(eventErr)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	events, err := ParseNDJSON(data)
	if err != nil || len(events) != 32 {
		t.Fatalf("concurrent event stream is invalid: %d %v", len(events), err)
	}
}
