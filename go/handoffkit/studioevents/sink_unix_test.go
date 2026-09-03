//go:build !windows

package studioevents

import (
	"os"
	"path/filepath"
	"testing"
)

func TestFileSinkRejectsUnsafeWritableEventFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "events.ndjson")
	if err := os.WriteFile(path, nil, 0o666); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, 0o666); err != nil {
		t.Fatal(err)
	}
	sink, _ := NewFileSink(path, DefaultFileOptions())
	event, _ := New("go", "edge-small", EventRuntimeStatus, RuntimeStatus{
		ConnectionLimit: 8, Queue: Queue{Capacity: 16}, HybridPQProviderState: "unavailable",
	})
	if err := sink.Emit(event); err == nil {
		t.Fatal("world-writable Studio event file was accepted")
	}
}
