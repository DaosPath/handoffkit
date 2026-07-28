//! HandoffKit Rust facade.
//!
//! Runtime and transport crates arrive in 1.17. This 1.16 facade exposes the
//! canonical workflow contracts and HK-CSP wire protocol without Python.

pub use handoffkit_contracts::*;
pub use handoffkit_protocol as csp;
pub use handoffkit_protocol::*;

pub const VERSION: &str = env!("CARGO_PKG_VERSION");
