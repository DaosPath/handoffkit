use crate::{RecipeRunResult, TeamRunResult};
use handoffkit_contracts::{RunTrace, TraceStep};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT_TRACE_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct ReplaySummary {
    pub success: bool,
    pub step_count: usize,
    pub handoff_count: usize,
    pub tool_result_count: usize,
    pub final_output: String,
    #[serde(default)]
    pub metadata: HashMap<String, Value>,
}

pub struct ReplayRunner<'a> {
    trace: &'a RunTrace,
}

impl<'a> ReplayRunner<'a> {
    pub fn new(trace: &'a RunTrace) -> Self {
        Self { trace }
    }

    pub fn summary(&self) -> ReplaySummary {
        ReplaySummary {
            success: self.trace.success,
            step_count: self.trace.steps.len(),
            handoff_count: self.trace.handoffs.len(),
            tool_result_count: self
                .trace
                .steps
                .iter()
                .map(|step| step.tool_results.len())
                .sum(),
            final_output: self.trace.final_output.clone(),
            metadata: self.trace.metadata.clone(),
        }
    }
}

pub fn trace_from_team_result(result: &TeamRunResult, name: impl Into<String>) -> RunTrace {
    let steps = result
        .agent_outputs
        .iter()
        .map(|output| TraceStep {
            name: output.agent.clone(),
            agent: output.agent.clone(),
            task: result.task.clone(),
            mode: "rust".to_string(),
            success: output.success,
            output: output.output.clone(),
            handoff: output.handoff.clone(),
            tool_results: Vec::new(),
            events: Vec::new(),
            metadata: output.metadata.clone(),
        })
        .collect();
    RunTrace {
        run_id: next_trace_id(),
        name: name.into(),
        success: result.success,
        final_output: result.final_output.clone(),
        steps,
        handoffs: result.handoffs.clone(),
        metadata: result.metadata.clone(),
    }
}

pub fn trace_from_recipe_result(result: &RecipeRunResult) -> RunTrace {
    let steps = result
        .step_results
        .iter()
        .enumerate()
        .map(|(index, step)| TraceStep {
            name: step.step_name.clone(),
            agent: step.agent_name.clone(),
            task: String::new(),
            mode: "rust_recipe".to_string(),
            success: step.success,
            output: step.output.clone(),
            handoff: result.handoff_states.get(index).cloned(),
            tool_results: Vec::new(),
            events: Vec::new(),
            metadata: HashMap::new(),
        })
        .collect();
    RunTrace {
        run_id: next_trace_id(),
        name: result.recipe_name.clone(),
        success: result.success,
        final_output: result.final_output.clone(),
        steps,
        handoffs: result.handoff_states.clone(),
        metadata: result.metadata.clone(),
    }
}

fn next_trace_id() -> String {
    format!(
        "rust-trace-{}-{}",
        std::process::id(),
        NEXT_TRACE_ID.fetch_add(1, Ordering::Relaxed)
    )
}
