package core

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"testing"
)

func vectors(t *testing.T) map[string]any {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("caller")
	}
	path := filepath.Join(filepath.Dir(file), "..", "..", "..", "contracts", "conformance", "browser-core-v1.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func TestGoldenRoundTrip(t *testing.T) {
	payload := vectors(t)
	models := map[string]string{
		"browser_error":           "BrowserError",
		"browser_capabilities":    "BrowserCapabilities",
		"browser_policy":          "BrowserPolicy",
		"browser_session_request": "BrowserSessionRequest",
		"browser_session_state":   "BrowserSessionState",
		"browser_command":         "BrowserCommand",
		"browser_event":           "BrowserEvent",
		"search_request":          "SearchRequest",
		"search_result":           "SearchResult",
		"page_snapshot":           "PageSnapshot",
		"document_record":         "DocumentRecord",
		"provider_trace":          "ProviderTrace",
		"research_job":            "ResearchJob",
		"research_progress":       "ResearchProgress",
		"research_result":         "ResearchResult",
	}
	all := payload["vectors"].(map[string]any)
	for key, name := range models {
		parsed, err := ParseCoreModel(name, all[key])
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		got, _ := json.Marshal(parsed)
		want, _ := json.Marshal(all[key])
		var gotValue any
		var wantValue any
		_ = json.Unmarshal(got, &gotValue)
		_ = json.Unmarshal(want, &wantValue)
		if !reflect.DeepEqual(gotValue, wantValue) {
			t.Fatalf("%s mismatch\ngot=%s\nwant=%s", name, got, want)
		}
	}
}

func TestNegativeVectors(t *testing.T) {
	payload := vectors(t)
	for _, raw := range payload["negative"].([]any) {
		caseData := raw.(map[string]any)
		_, err := ParseCoreModel(caseData["model"].(string), caseData["input"])
		if err == nil {
			t.Fatalf("%s: expected error", caseData["id"])
		}
		coreErr, ok := err.(*CoreError)
		if !ok || coreErr.Code != caseData["error_code"].(string) {
			t.Fatalf("%s: got %v", caseData["id"], err)
		}
	}
}

func TestPublicBind(t *testing.T) {
	err := RejectPublicBind(map[string]any{}, "0.0.0.0")
	if err == nil || err.(*CoreError).Code != "public_bind_rejected" {
		t.Fatalf("expected public_bind_rejected, got %v", err)
	}
	if err := RejectPublicBind(map[string]any{}, "127.0.0.1"); err != nil {
		t.Fatal(err)
	}
}

func TestNetworkAndFilesystemPolicy(t *testing.T) {
	if ClassifyNetworkTarget("http://127.0.0.1/")["kind"] != "loopback" {
		t.Fatal("loopback")
	}
	if err := AssertNetworkURL(map[string]any{}, "http://192.168.1.8/"); err == nil || err.(*CoreError).Code != "policy_denied" {
		t.Fatalf("expected private deny, got %v", err)
	}
	if err := AssertNetworkURL(map[string]any{}, "https://example.org/"); err != nil {
		t.Fatal(err)
	}
	if err := AssertFilesystem(map[string]any{}, "read"); err == nil || err.(*CoreError).Code != "policy_denied" {
		t.Fatalf("expected filesystem deny, got %v", err)
	}
	if err := AssertFilesystem(map[string]any{}, "download"); err != nil {
		t.Fatal(err)
	}
}
