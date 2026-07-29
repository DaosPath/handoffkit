#![no_main]

use handoffkit_protocol::sanitize_error_message;
use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    let value = String::from_utf8_lossy(data);
    let sanitized = sanitize_error_message(value);
    assert!(sanitized.len() <= 2048);
    assert!(!sanitized.contains('\0'));
    assert!(!sanitized.contains('\n'));
    assert!(!sanitized.contains('\r'));
});

