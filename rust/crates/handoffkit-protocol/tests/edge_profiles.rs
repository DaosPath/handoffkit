use handoffkit_protocol::{EdgeRuntimeProfile, SessionConfig};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;

fn fixture() -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../shared/contracts/test-fixtures/security/edge-runtime-profiles-v1.json");
    serde_json::from_slice(&fs::read(path).expect("read edge profile fixture"))
        .expect("parse edge profile fixture")
}

#[test]
fn profiles_match_shared_fixture_and_drive_sessions() {
    let fixture = fixture();
    assert_eq!(fixture["format"], "handoffkit.edge-profiles");
    assert_eq!(fixture["format_version"], 1);

    for expected in fixture["profiles"].as_array().expect("profile array") {
        let name = expected["name"].as_str().expect("profile name");
        let profile = EdgeRuntimeProfile::from_name(name).expect("known profile");
        assert_eq!(serde_json::to_value(&profile).unwrap(), *expected);

        let decoded: EdgeRuntimeProfile = serde_json::from_value(expected.clone()).unwrap();
        decoded.validate().unwrap();
        assert_eq!(decoded, profile);

        let session: SessionConfig = profile.session_config("edge-session").unwrap();
        assert_eq!(session.channel_capacity, profile.channel_capacity);
        assert_eq!(session.max_message_bytes, profile.max_frame_bytes);
        assert_eq!(session.ack_timeout_ms, profile.timeout.ack_ms);
        assert_eq!(session.dedup_capacity, profile.dedup_capacity);
        assert_eq!(session.retry_policy, profile.reconnect);
        assert_eq!(session.metadata["edge_profile"], name);
    }
}

#[test]
fn unsafe_profile_data_is_rejected() {
    let mut profile = EdgeRuntimeProfile::from_name("edge-small").unwrap();
    profile.security_profile = "local".to_string();
    assert!(profile.validate().is_err());
    profile.security_profile = "standard".to_string();
    profile.logging.include_payloads = true;
    assert!(profile.validate().is_err());
}
