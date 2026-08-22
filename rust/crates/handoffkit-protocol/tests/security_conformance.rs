use handoffkit_protocol::security::{
    negotiate_security_profile, CapabilityPolicy, PeerIdentity, ReplayProtection, SecurityConfig,
    SecurityProfile, SignedArtifact,
};
use serde_json::Value;
use std::time::{SystemTime, UNIX_EPOCH};

fn vectors() -> Value {
    serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../shared/contracts/conformance/security-v1.json"
    )))
    .unwrap()
}

#[test]
fn security_wire_conformance() {
    let config_value: Value = serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../shared/contracts/fixtures/security_config.json"
    )))
    .unwrap();
    let config: SecurityConfig = serde_json::from_value(config_value.clone()).unwrap();
    assert_eq!(serde_json::to_value(config).unwrap(), config_value);

    let peer_value: Value = serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../shared/contracts/fixtures/peer_identity.json"
    )))
    .unwrap();
    let peer: PeerIdentity = serde_json::from_value(peer_value.clone()).unwrap();
    assert_eq!(serde_json::to_value(peer).unwrap(), peer_value);

    let artifact_value: Value = serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../shared/contracts/fixtures/signed_artifact.json"
    )))
    .unwrap();
    let artifact: SignedArtifact = serde_json::from_value(artifact_value.clone()).unwrap();
    assert_eq!(serde_json::to_value(&artifact).unwrap(), artifact_value);
    let conformance = vectors();
    let expected = conformance["signed_artifact"]["canonical_payload"]
        .as_str()
        .unwrap();
    assert_eq!(artifact.canonical_payload().unwrap(), expected.as_bytes());
}

#[test]
fn profile_authorization_and_replay_conformance() {
    let vectors = vectors();
    for case in vectors["profile_negotiation"].as_array().unwrap() {
        let required: SecurityProfile = serde_json::from_value(case["required"].clone()).unwrap();
        let offered: SecurityProfile = serde_json::from_value(case["offered"].clone()).unwrap();
        let supported: Vec<SecurityProfile> =
            serde_json::from_value(case["supported"].clone()).unwrap();
        let result = negotiate_security_profile(required, offered, &supported);
        if let Some(expected) = case.get("error_code") {
            assert_eq!(
                result.unwrap_err().code,
                expected.as_str().unwrap(),
                "{}",
                case["id"]
            );
        } else {
            let selected = result.unwrap();
            assert_eq!(selected.as_str(), case["selected"].as_str().unwrap());
        }
    }

    for case in vectors["authorization"].as_array().unwrap() {
        let allowed: Vec<String> =
            serde_json::from_value(case["allowed_operations"].clone()).unwrap();
        let capabilities: Vec<String> =
            serde_json::from_value(case["peer_capabilities"].clone()).unwrap();
        let operation = case["operation"].as_str().unwrap();
        let peer = PeerIdentity {
            peer_id: "peer".to_string(),
            node_id: "node".to_string(),
            capabilities,
            ..PeerIdentity::default()
        };
        let policy = CapabilityPolicy::new(Some(allowed), None);
        let expected = case["authorized"].as_bool().unwrap();
        assert_eq!(
            policy.is_operation_authorized(operation, Some(&peer)),
            expected
        );
        if !expected {
            let error = policy.authorize_job(operation.trim_start_matches("job:"), &peer);
            assert_eq!(error.unwrap_err().code, "authorization_denied");
        }
    }

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();
    for case in vectors["replay"].as_array().unwrap() {
        let mut replay = ReplayProtection::new(30, 3, 1000);
        for operation in case["operations"].as_array().unwrap() {
            let scope = format!(
                "{}\0{}",
                operation["peer"].as_str().unwrap(),
                operation["session"].as_str().unwrap()
            );
            let offset = operation["timestamp_offset"].as_i64().unwrap();
            let timestamp = if offset < 0 {
                now - offset.unsigned_abs()
            } else {
                now + offset as u64
            };
            let result = replay.check_and_record(
                &scope,
                operation["sequence"].as_u64().unwrap(),
                operation["nonce"].as_str(),
                Some(timestamp),
            );
            if let Some(expected) = operation.get("error_code") {
                assert_eq!(result.unwrap_err().code, expected.as_str().unwrap());
            } else {
                result.unwrap();
            }
        }
    }
}
