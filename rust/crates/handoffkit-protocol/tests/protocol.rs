use handoffkit_protocol::{
    negotiate_version, ArtifactRef, ChannelConfig, DeliveryAck, DeliveryNack, EvaluationJob,
    JobProgress, MessageEnvelope, ProcessError, SessionConfig, TrainingJob, WorkerCapabilities,
};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::Value;

fn fixture(name: &str) -> Value {
    let path = format!("../../../shared/contracts/fixtures/{name}");
    let text = std::fs::read_to_string(path).expect("shared HK-CSP fixture should exist");
    serde_json::from_str(&text).expect("fixture should contain valid JSON")
}

fn roundtrip<T>(name: &str)
where
    T: DeserializeOwned + Serialize,
{
    let expected = fixture(name);
    let parsed: T = serde_json::from_value(expected.clone()).expect("fixture should decode");
    assert_eq!(
        serde_json::to_value(parsed).expect("contract should encode"),
        expected
    );
}

#[test]
fn all_hk_csp_fixtures_roundtrip() {
    roundtrip::<MessageEnvelope>("message_envelope.json");
    roundtrip::<SessionConfig>("session_config.json");
    roundtrip::<ChannelConfig>("channel_config.json");
    roundtrip::<DeliveryAck>("delivery_ack.json");
    roundtrip::<DeliveryNack>("delivery_nack.json");
    roundtrip::<ProcessError>("process_error.json");
    roundtrip::<WorkerCapabilities>("worker_capabilities.json");
    roundtrip::<ArtifactRef>("artifact_ref.json");
    roundtrip::<TrainingJob>("training_job.json");
    roundtrip::<EvaluationJob>("evaluation_job.json");
    roundtrip::<JobProgress>("job_progress.json");
}

#[test]
fn version_negotiation_and_retry_identity_are_stable() {
    assert_eq!(negotiate_version("1.9").unwrap(), "1.0");
    assert!(negotiate_version("2.0").is_err());

    let envelope: MessageEnvelope =
        serde_json::from_value(fixture("message_envelope.json")).unwrap();
    envelope.validate().unwrap();
    let retry = envelope.next_attempt();
    assert_eq!(retry.message_id, envelope.message_id);
    assert_eq!(retry.idempotency_key, envelope.idempotency_key);
    assert_eq!(retry.attempt, 2);
}


