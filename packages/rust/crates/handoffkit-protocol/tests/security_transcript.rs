use handoffkit_protocol::security::{
    build_security_transcript, verify_security_transcript, PeerIdentity, SecurityProfile,
    SecurityTranscript, SecurityTranscriptInput,
};
use serde::Deserialize;
use serde_json::json;
use std::fs;
use std::path::Path;

#[derive(Deserialize)]
struct Fixture {
    sender: PeerIdentity,
    receiver: PeerIdentity,
    transcript: SecurityTranscript,
}

fn fixture() -> Fixture {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../contracts/test-fixtures/security/security-transcript-v1.json");
    serde_json::from_slice(&fs::read(path).unwrap()).unwrap()
}

fn input(fixture: &Fixture) -> SecurityTranscriptInput<'_> {
    SecurityTranscriptInput {
        protocol_version: "1.0",
        requested_profile: SecurityProfile::Standard,
        selected_profile: SecurityProfile::Standard,
        sender: &fixture.sender,
        receiver: &fixture.receiver,
        tls_version: "TLSv1.3",
        negotiated_group: None,
        session_id: "session-transcript-1",
        handshake_nonce: "nonce-transcript-1",
        timestamp: "2026-01-01T00:00:00Z",
    }
}

#[test]
fn rust_security_transcript_matches_shared_canonical_fixture() {
    let fixture = fixture();
    let transcript = build_security_transcript(input(&fixture)).unwrap();
    assert_eq!(transcript, fixture.transcript);
    assert_eq!(
        verify_security_transcript(json!(fixture.transcript), input(&fixture)).unwrap(),
        transcript
    );
}

#[test]
fn rust_security_transcript_rejects_hash_tamper_downgrade_and_identity() {
    let fixture = fixture();
    let mut tampered = serde_json::to_value(&fixture.transcript).unwrap();
    tampered["timestamp"] = json!("2026-01-01T00:00:01Z");
    assert_eq!(
        verify_security_transcript(tampered, input(&fixture))
            .unwrap_err()
            .code,
        "security_transcript_hash_mismatch"
    );

    let downgrade = build_security_transcript(SecurityTranscriptInput {
        selected_profile: SecurityProfile::Local,
        ..input(&fixture)
    })
    .unwrap();
    assert_eq!(
        verify_security_transcript(json!(downgrade), input(&fixture))
            .unwrap_err()
            .code,
        "security_profile_mismatch"
    );

    let mut wrong_receiver = fixture.receiver.clone();
    wrong_receiver.peer_id = "other-peer".to_string();
    let wrong_identity = build_security_transcript(SecurityTranscriptInput {
        receiver: &wrong_receiver,
        ..input(&fixture)
    })
    .unwrap();
    assert_eq!(
        verify_security_transcript(json!(wrong_identity), input(&fixture))
            .unwrap_err()
            .code,
        "security_transcript_identity_mismatch"
    );
}
