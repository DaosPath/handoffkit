package security

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"testing"
)

type transcriptFixture struct {
	CanonicalUnsignedPayload string             `json:"canonical_unsigned_payload"`
	Sender                   PeerIdentity       `json:"sender"`
	Receiver                 PeerIdentity       `json:"receiver"`
	Transcript               SecurityTranscript `json:"transcript"`
}

func loadTranscriptFixture(t *testing.T) transcriptFixture {
	t.Helper()
	_, filename, _, _ := runtime.Caller(0)
	path := filepath.Clean(filepath.Join(filepath.Dir(filename), "..", "..", "contracts", "test-fixtures", "security", "security-transcript-v1.json"))
	encoded, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var fixture transcriptFixture
	if err := json.Unmarshal(encoded, &fixture); err != nil {
		t.Fatal(err)
	}
	return fixture
}

func transcriptFixtureInput(fixture transcriptFixture) SecurityTranscriptInput {
	return SecurityTranscriptInput{
		ProtocolVersion:  "1.0",
		RequestedProfile: SecurityProfileStandard,
		SelectedProfile:  SecurityProfileStandard,
		Sender:           &fixture.Sender,
		Receiver:         &fixture.Receiver,
		TLSVersion:       "TLSv1.3",
		SessionID:        "session-transcript-1",
		HandshakeNonce:   "nonce-transcript-1",
		Timestamp:        "2026-01-01T00:00:00Z",
	}
}

func TestGoSecurityTranscriptMatchesSharedCanonicalFixture(t *testing.T) {
	fixture := loadTranscriptFixture(t)
	transcript, err := BuildSecurityTranscript(transcriptFixtureInput(fixture))
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(transcript, fixture.Transcript) {
		t.Fatalf("transcript mismatch:\nactual=%#v\nexpected=%#v", transcript, fixture.Transcript)
	}
	canonical, err := json.Marshal(transcript.unsignedMap())
	if err != nil {
		t.Fatal(err)
	}
	if string(canonical) != fixture.CanonicalUnsignedPayload {
		t.Fatalf("canonical transcript payload mismatch:\nactual=%s\nexpected=%s", canonical, fixture.CanonicalUnsignedPayload)
	}
	if _, err := VerifySecurityTranscript(fixture.Transcript, transcriptFixtureInput(fixture)); err != nil {
		t.Fatal(err)
	}
}

func TestGoSecurityTranscriptRejectsTamperDowngradeAndIdentity(t *testing.T) {
	fixture := loadTranscriptFixture(t)
	input := transcriptFixtureInput(fixture)
	tampered := fixture.Transcript
	tampered.Timestamp = "2026-01-01T00:00:01Z"
	if _, err := VerifySecurityTranscript(tampered, input); transcriptErrorCode(err) != "security_transcript_hash_mismatch" {
		t.Fatalf("hash tamper returned %q: %v", transcriptErrorCode(err), err)
	}

	downgradeInput := input
	downgradeInput.SelectedProfile = SecurityProfileLocal
	downgrade, err := BuildSecurityTranscript(downgradeInput)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := VerifySecurityTranscript(downgrade, input); transcriptErrorCode(err) != "security_profile_mismatch" {
		t.Fatalf("downgrade returned %q: %v", transcriptErrorCode(err), err)
	}

	wrongReceiver := fixture.Receiver
	wrongReceiver.PeerID = "other-peer"
	wrongIdentityInput := input
	wrongIdentityInput.Receiver = &wrongReceiver
	wrongIdentity, err := BuildSecurityTranscript(wrongIdentityInput)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := VerifySecurityTranscript(wrongIdentity, input); transcriptErrorCode(err) != "security_transcript_identity_mismatch" {
		t.Fatalf("identity tamper returned %q: %v", transcriptErrorCode(err), err)
	}
}

func TestGoSecurityTranscriptRejectsUnknownFields(t *testing.T) {
	fixture := loadTranscriptFixture(t)
	encoded, err := json.Marshal(fixture.Transcript)
	if err != nil {
		t.Fatal(err)
	}
	var value map[string]any
	if err := json.Unmarshal(encoded, &value); err != nil {
		t.Fatal(err)
	}
	value["unsigned_override"] = "standard"
	if _, err := ParseSecurityTranscript(value); transcriptErrorCode(err) != "security_transcript_invalid" {
		t.Fatalf("unknown transcript field returned %q: %v", transcriptErrorCode(err), err)
	}
}

func transcriptErrorCode(err error) string {
	if typed, ok := err.(*SecurityError); ok {
		return typed.Code
	}
	return ""
}
