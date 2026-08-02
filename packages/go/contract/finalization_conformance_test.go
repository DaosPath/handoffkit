package contract

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/DaosPath/handoffkit/go/studioevents"
)

type finalizationConformanceIndex struct {
	WireVersion        string       `json:"wire_version"`
	Classification     string       `json:"classification"`
	Participants       []string     `json:"participants"`
	DurableReplay      fixtureIndex `json:"durable_replay"`
	DurableRevocation  fixtureIndex `json:"durable_revocation"`
	SecurityTranscript struct {
		Fixture        string `json:"fixture"`
		Schema         string `json:"schema"`
		TranscriptHash string `json:"transcript_hash"`
	} `json:"security_transcript"`
	ArtifactIngestion struct {
		Participants    []string          `json:"participants"`
		RequiredOrder   []string          `json:"required_order"`
		SharedDecisions map[string]string `json:"shared_decisions"`
	} `json:"artifact_ingestion"`
	EdgeProfiles struct {
		Fixture string `json:"fixture"`
		Schema  string `json:"schema"`
	} `json:"edge_profiles"`
	StudioSecurityEvents struct {
		Emitters []string `json:"emitters"`
		Parsers  []string `json:"parsers"`
		Fixture  string   `json:"fixture"`
		Schema   string   `json:"schema"`
		Events   int      `json:"events"`
		Format   string   `json:"format"`
	} `json:"studio_security_events"`
}

type fixtureIndex struct {
	Fixture string `json:"fixture"`
	Schema  string `json:"schema"`
}

func TestSecurityFinalizationConformanceIndex(t *testing.T) {
	contractsRoot := filepath.Join("..", "..", "contracts")
	encoded, err := os.ReadFile(filepath.Join(contractsRoot, "conformance", "security-finalization-v1.json"))
	if err != nil {
		t.Fatal(err)
	}
	var index finalizationConformanceIndex
	if err := json.Unmarshal(encoded, &index); err != nil {
		t.Fatal(err)
	}
	if index.WireVersion != "1.0" || index.Classification != "experimental" {
		t.Fatalf("unexpected finalization wire classification: %#v", index)
	}
	requireStrings(t, index.Participants, []string{"python", "javascript", "go", "rust", "cpp"})
	for _, entry := range []fixtureIndex{
		index.DurableReplay,
		index.DurableRevocation,
		{Fixture: index.SecurityTranscript.Fixture, Schema: index.SecurityTranscript.Schema},
		index.EdgeProfiles,
		{Fixture: index.StudioSecurityEvents.Fixture, Schema: index.StudioSecurityEvents.Schema},
	} {
		for _, relative := range []string{entry.Fixture, entry.Schema} {
			if relative == "" {
				t.Fatal("finalization index has an empty fixture or schema path")
			}
			if _, err := os.Stat(filepath.Join(contractsRoot, filepath.FromSlash(relative))); err != nil {
				t.Fatalf("indexed contract %q is missing: %v", relative, err)
			}
		}
	}

	transcriptBytes, err := os.ReadFile(filepath.Join(contractsRoot, filepath.FromSlash(index.SecurityTranscript.Fixture)))
	if err != nil {
		t.Fatal(err)
	}
	var transcript struct {
		Transcript struct {
			TranscriptHash string `json:"transcript_hash"`
		} `json:"transcript"`
	}
	if err := json.Unmarshal(transcriptBytes, &transcript); err != nil {
		t.Fatal(err)
	}
	if transcript.Transcript.TranscriptHash != index.SecurityTranscript.TranscriptHash {
		t.Fatalf("transcript hash drift: fixture=%q index=%q", transcript.Transcript.TranscriptHash, index.SecurityTranscript.TranscriptHash)
	}

	requireStrings(t, index.ArtifactIngestion.Participants, []string{"go", "cpp"})
	requireStrings(t, index.ArtifactIngestion.RequiredOrder, []string{
		"resolve", "size", "media_type", "sha256", "producer_identity", "signature", "revocation", "authorization", "consume_snapshot",
	})
	for decision, code := range map[string]string{
		"tamper":                 "artifact_integrity_mismatch",
		"path_escape":            "artifact_path_denied",
		"size":                   "artifact_too_large",
		"media_type":             "artifact_media_type_denied",
		"signature_binding":      "artifact_signature_mismatch",
		"signature_verification": "artifact_signature_invalid",
		"signer_policy":          "artifact_signer_denied",
		"signer_revocation":      "artifact_signer_revoked",
		"producer_binding":       "artifact_producer_mismatch",
		"algorithm":              "artifact_algorithm_unsupported",
	} {
		if got := index.ArtifactIngestion.SharedDecisions[decision]; got != code {
			t.Fatalf("artifact decision %q = %q, want %q", decision, got, code)
		}
	}

	events, err := studioevents.ParseNDJSON(mustRead(t, filepath.Join(contractsRoot, filepath.FromSlash(index.StudioSecurityEvents.Fixture))))
	if err != nil {
		t.Fatal(err)
	}
	if index.StudioSecurityEvents.Format != studioevents.Format || len(events) != index.StudioSecurityEvents.Events {
		t.Fatalf("Studio event index does not match its executable parser: %#v", index.StudioSecurityEvents)
	}
	requireStrings(t, index.StudioSecurityEvents.Emitters, []string{"go-ml-gateway"})
	requireStrings(t, index.StudioSecurityEvents.Parsers, []string{"go", "typescript"})
}

func mustRead(t testing.TB, path string) []byte {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func requireStrings(t testing.TB, actual, expected []string) {
	t.Helper()
	if len(actual) != len(expected) {
		t.Fatalf("unexpected string list: got %#v, want %#v", actual, expected)
	}
	for index, value := range expected {
		if actual[index] != value {
			t.Fatalf("unexpected string list: got %#v, want %#v", actual, expected)
		}
	}
}
