package contract

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/DaosPath/handoffkit/go/studioevents"
)

type finalizationConformanceIndex struct {
	WireVersion      string       `json:"wire_version"`
	Classification   string       `json:"classification"`
	Participants     []string     `json:"participants"`
	DurableReplay    fixtureIndex `json:"durable_replay"`
	DurableScheduler struct {
		fixtureIndex
		Participants []string `json:"participants"`
		Checksum     string   `json:"checksum"`
	} `json:"durable_scheduler"`
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
	UnavailableCapabilities unavailableCapabilitiesIndex `json:"unavailable_capabilities"`
}

type fixtureIndex struct {
	Fixture string `json:"fixture"`
	Schema  string `json:"schema"`
}

type unavailableCapabilitiesIndex struct {
	Participants     []string `json:"participants"`
	Fixture          string   `json:"fixture"`
	Format           string   `json:"format"`
	FormatVersion    int      `json:"format_version"`
	Generation       int      `json:"generation"`
	Capabilities     int      `json:"capabilities"`
	ErrorCodes       []string `json:"error_codes"`
	CanonicalPayload string   `json:"canonical_payload"`
	Checksum         string   `json:"checksum"`
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
		index.DurableScheduler.fixtureIndex,
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
	if index.UnavailableCapabilities.Fixture == "" {
		t.Fatal("finalization index has no unavailable capability fixture")
	}
	if _, err := os.Stat(filepath.Join(contractsRoot, filepath.FromSlash(index.UnavailableCapabilities.Fixture))); err != nil {
		t.Fatalf("indexed unavailable capability fixture %q is missing: %v", index.UnavailableCapabilities.Fixture, err)
	}
	requireStrings(t, index.DurableScheduler.Participants, []string{"python", "javascript", "go", "rust"})
	if index.DurableScheduler.Checksum != "sha256:267d62e47d35d93e10eded77fb6497a2af4bee98624c683f783bedd752084fbf" {
		t.Fatalf("durable scheduler checksum drift: %q", index.DurableScheduler.Checksum)
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

	assertUnavailableCapabilities(t, contractsRoot, index.UnavailableCapabilities)
}

type unavailableCapability struct {
	Name          string   `json:"name"`
	Status        string   `json:"status"`
	FailClosed    bool     `json:"fail_closed"`
	ErrorCode     string   `json:"error_code"`
	Participants  []string `json:"participants"`
	AvailableIn   []string `json:"available_in"`
	UnavailableIn []string `json:"unavailable_in"`
}

func assertUnavailableCapabilities(t testing.TB, contractsRoot string, index unavailableCapabilitiesIndex) {
	t.Helper()
	encoded := mustRead(t, filepath.Join(contractsRoot, filepath.FromSlash(index.Fixture)))
	var fixture struct {
		Capabilities  []unavailableCapability `json:"capabilities"`
		Checksum      string                  `json:"checksum"`
		Format        string                  `json:"format"`
		FormatVersion int                     `json:"format_version"`
		Generation    int                     `json:"generation"`
	}
	if err := json.Unmarshal(encoded, &fixture); err != nil {
		t.Fatal(err)
	}
	if fixture.Format != "handoffkit.security.unavailable" || fixture.FormatVersion != 1 || fixture.Generation != 1 {
		t.Fatalf("unexpected unavailable capability fixture header: %#v", fixture)
	}
	if len(fixture.Capabilities) != index.Capabilities {
		t.Fatalf("unavailable capability count = %d, want %d", len(fixture.Capabilities), index.Capabilities)
	}
	participants := []string{"python", "javascript", "go", "rust", "cpp"}
	wantCodes := map[string]string{
		"ocsp_fetch":         "ocsp_fetch_unavailable",
		"exactly_once":       "exactly_once_unavailable",
		"zeroization_global": "",
		"ml_dsa":             "artifact_algorithm_unsupported",
		"ecdsa":              "artifact_algorithm_unsupported",
		"slh_dsa":            "artifact_algorithm_unsupported",
		"hybrid_pq":          "security_profile_unavailable",
	}
	seen := make(map[string]bool, len(fixture.Capabilities))
	for _, capability := range fixture.Capabilities {
		wantCode, ok := wantCodes[capability.Name]
		if !ok || seen[capability.Name] {
			t.Fatalf("unexpected or duplicate unavailable capability: %#v", capability)
		}
		seen[capability.Name] = true
		if capability.Status != "unavailable" || !capability.FailClosed || capability.ErrorCode != wantCode {
			t.Fatalf("capability %q is not fail-closed as indexed: %#v", capability.Name, capability)
		}
		requireStrings(t, capability.Participants, participants)
		if capability.Name == "hybrid_pq" {
			requireStrings(t, capability.AvailableIn, []string{"javascript", "go"})
			requireStrings(t, capability.UnavailableIn, []string{"python", "rust", "cpp"})
		}
	}
	if len(seen) != len(wantCodes) {
		t.Fatalf("unavailable capability set incomplete: %#v", seen)
	}

	var canonical map[string]any
	if err := json.Unmarshal(encoded, &canonical); err != nil {
		t.Fatal(err)
	}
	delete(canonical, "checksum")
	canonicalBytes, err := json.Marshal(canonical)
	if err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256(canonicalBytes)
	checksum := "sha256:" + hex.EncodeToString(hash[:])
	if fixture.Checksum != checksum || index.Checksum != checksum {
		t.Fatalf("unavailable capability checksum drift: fixture=%q index=%q computed=%q", fixture.Checksum, index.Checksum, checksum)
	}
	if index.CanonicalPayload != string(canonicalBytes) {
		t.Fatalf("unavailable capability canonical payload drift")
	}
	requireStrings(t, index.Participants, participants)
	requireStrings(t, index.ErrorCodes, []string{"artifact_algorithm_unsupported", "exactly_once_unavailable", "ocsp_fetch_unavailable", "security_profile_unavailable"})
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
