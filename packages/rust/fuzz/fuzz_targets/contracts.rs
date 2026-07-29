#![no_main]

use handoffkit_protocol::{
    ArtifactRef, ChannelConfig, DeliveryAck, DeliveryNack, EvaluationJob, JobProgress,
    ProcessError, SessionConfig, TrainingJob, WorkerCapabilities,
};
use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    if data.len() > 1024 * 1024 {
        return;
    }
    macro_rules! validate {
        ($kind:ty) => {
            if let Ok(value) = serde_json::from_slice::<$kind>(data) {
                let _ = value.validate();
            }
        };
    }
    validate!(SessionConfig);
    validate!(ChannelConfig);
    validate!(DeliveryAck);
    validate!(DeliveryNack);
    validate!(ProcessError);
    validate!(ArtifactRef);
    validate!(WorkerCapabilities);
    validate!(TrainingJob);
    validate!(EvaluationJob);
    validate!(JobProgress);
});

