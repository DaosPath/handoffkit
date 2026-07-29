#![no_main]

use handoffkit_protocol::MessageEnvelope;
use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    if data.len() > 8 * 1024 * 1024 {
        return;
    }
    if let Ok(envelope) = serde_json::from_slice::<MessageEnvelope>(data) {
        let _ = envelope.validate();
        let _ = serde_json::to_vec(&envelope);
    }
});

