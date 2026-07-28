//! Executable HK-CSP runtime for Rust.

mod channel;
mod error;
mod session;
mod tools;
mod tracing;
mod workflow;

pub use channel::{select, CspChannel};
pub use error::{RuntimeError, RuntimeResult};
pub use handoffkit_protocol::RuntimeMode;
pub use session::{
    CspRuntime, CspSession, DeliveryReceipt, ProcessContext, ProcessHandle, RuntimeEvent,
    SessionState,
};
pub use tools::{Tool, ToolRegistry};
pub use tracing::{trace_from_recipe_result, trace_from_team_result, ReplayRunner, ReplaySummary};
pub use workflow::{
    Agent, AgentOutput, AgentRunResult, Recipe, RecipeRunResult, RecipeRunner, RecipeStep,
    RecipeStepResult, Team, TeamRunResult,
};

pub const VERSION: &str = env!("CARGO_PKG_VERSION");
pub const DEFAULT_MAX_PROCESSES: usize = 1_024;
pub const DEFAULT_MAX_PENDING_ACKS: usize = 4_096;
