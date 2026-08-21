#![no_main]

use handoffkit_protocol::ValidationLimits;
use handoffkit_transport::{decode_ndjson_frame, encode_ndjson_frame};
use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    let limits = ValidationLimits {
        max_message_bytes: 64 * 1024,
        max_nesting_depth: 64,
    };
    if let Ok(envelope) = decode_ndjson_frame(data, limits) {
        let _ = encode_ndjson_frame(&envelope, limits);
    }
});

