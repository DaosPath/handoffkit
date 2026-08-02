package security

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func securityFuzzFixture(testingContext testing.TB, name string) []byte {
	testingContext.Helper()
	_, source, _, ok := runtime.Caller(0)
	if !ok {
		testingContext.Fatal("cannot locate security fuzz fixture")
	}
	data, err := os.ReadFile(filepath.Join(
		filepath.Dir(source), "..", "..", "contracts", "test-fixtures", "security", name,
	))
	if err != nil {
		testingContext.Fatal(err)
	}
	return data
}

func FuzzSecurityTranscriptParser(f *testing.F) {
	var fixture struct {
		Transcript any `json:"transcript"`
	}
	if err := json.Unmarshal(securityFuzzFixture(f, "security-transcript-v1.json"), &fixture); err != nil {
		f.Fatal(err)
	}
	valid, _ := json.Marshal(fixture.Transcript)
	f.Add(valid)
	f.Add([]byte(`{"format":"handoffkit.security.transcript","format_version":1}`))
	f.Fuzz(func(t *testing.T, data []byte) {
		if len(data) > 64*1024 {
			return
		}
		var value any
		if json.Unmarshal(data, &value) != nil {
			return
		}
		_, _ = ParseSecurityTranscript(value)
	})
}

func FuzzDurableReplayStateParser(f *testing.F) {
	f.Add(securityFuzzFixture(f, "durable-replay-v1.json"))
	f.Add([]byte(`{"format":"handoffkit.security.replay","format_version":2}`))
	f.Fuzz(func(t *testing.T, data []byte) {
		if len(data) > 64*1024 {
			return
		}
		path := filepath.Join(t.TempDir(), "replay.json")
		if err := os.WriteFile(path, data, 0o600); err != nil {
			t.Fatal(err)
		}
		options := DefaultDurableReplayOptions()
		options.MaxFileBytes = 64 * 1024
		_, _ = NewDurableReplayProtection(path, options)
	})
}

func FuzzDurableRevocationStateParser(f *testing.F) {
	f.Add(securityFuzzFixture(f, "durable-revocation-v1.json"))
	f.Add([]byte(`{"format":"handoffkit.security.revocations","format_version":2}`))
	f.Fuzz(func(t *testing.T, data []byte) {
		if len(data) > 64*1024 || strings.ContainsRune(string(data), '\x00') {
			return
		}
		path := filepath.Join(t.TempDir(), "revocations.json")
		if err := os.WriteFile(path, data, 0o600); err != nil {
			t.Fatal(err)
		}
		options := DefaultDurableRevocationOptions()
		options.MaxFileBytes = 64 * 1024
		_, _ = NewDurableRevocationPolicy(path, options)
	})
}
