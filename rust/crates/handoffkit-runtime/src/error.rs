use handoffkit_protocol::{sanitize_error_message, ProcessError};
use std::collections::HashMap;
use std::fmt::{Display, Formatter};

pub type RuntimeResult<T> = Result<T, RuntimeError>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeError {
    pub code: String,
    pub message: String,
    pub retryable: bool,
}

impl RuntimeError {
    pub fn new(code: impl Into<String>, message: impl AsRef<str>) -> Self {
        Self {
            code: code.into(),
            message: sanitize_error_message(message),
            retryable: false,
        }
    }

    pub fn retryable(code: impl Into<String>, message: impl AsRef<str>) -> Self {
        Self {
            code: code.into(),
            message: sanitize_error_message(message),
            retryable: true,
        }
    }

    pub fn cancelled() -> Self {
        Self::new("cancelled", "operation cancelled")
    }

    pub fn deadline() -> Self {
        Self::new("deadline_exceeded", "operation deadline exceeded")
    }

    pub fn to_process_error(&self, process_id: impl Into<String>) -> ProcessError {
        ProcessError {
            code: self.code.clone(),
            message: self.message.clone(),
            process_id: process_id.into(),
            retryable: self.retryable,
            details: HashMap::new(),
            timestamp: handoffkit_protocol::utc_now(),
        }
    }
}

impl Display for RuntimeError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for RuntimeError {}

impl From<handoffkit_protocol::ProtocolError> for RuntimeError {
    fn from(error: handoffkit_protocol::ProtocolError) -> Self {
        Self::new("protocol_error", error.0)
    }
}

impl From<serde_json::Error> for RuntimeError {
    fn from(error: serde_json::Error) -> Self {
        Self::new("json_error", error.to_string())
    }
}
