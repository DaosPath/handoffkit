//! Browser Real client. Never launches Chromium.
use serde_json::{json, Value};

/// Callback dispatch is an explicit test adapter. TLS uses handoffkit-transport
/// with `browser_control_request` envelopes on channel `browser.control`.
pub struct BrowserRealClient<F>
where
    F: Fn(Value) -> Result<Value, String>,
{
    pub dispatch: F,
}

impl<F> BrowserRealClient<F>
where
    F: Fn(Value) -> Result<Value, String>,
{
    pub fn send(&self, command: Value) -> Result<Value, String> {
        (self.dispatch)(command)
    }
}

pub fn browser_control_request(command: Value, source: &str, sequence: u64, nonce: &str) -> Value {
    json!({
        "channel": "browser.control",
        "kind": "request",
        "payload_type": "browser.command",
        "source": source,
        "sequence": sequence,
        "metadata": {
            "nonce": nonce,
            "security_nonce": nonce,
            "operation": "browser:control"
        },
        "payload": command,
    })
}
