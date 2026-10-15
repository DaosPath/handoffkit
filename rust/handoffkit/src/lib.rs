//! HandoffKit Rust facade.
//!
//! The 1.17 facade exposes canonical workflow contracts, HK-CSP wire types,
//! the executable Tokio runtime, and safe local transports without Python.

pub use handoffkit_contracts::*;
pub use handoffkit_protocol as csp;
pub use handoffkit_protocol::*;
pub use handoffkit_runtime as runtime;
pub use handoffkit_runtime::*;
pub use handoffkit_transport as transport;
pub use handoffkit_transport::*;

pub const VERSION: &str = env!("CARGO_PKG_VERSION");
