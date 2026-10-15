#![no_main]

use handoffkit_transport::{validate_handshake_info, HandshakeInfo};
use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    if data.len() > 1024 * 1024 {
        return;
    }
    if let Ok(handshake) = serde_json::from_slice::<HandshakeInfo>(data) {
        let _ = validate_handshake_info(&handshake);
    }
});

