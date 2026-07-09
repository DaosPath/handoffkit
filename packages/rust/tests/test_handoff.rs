use handoffkit::{HandoffState, RunTrace, TraceStep};

#[test]
fn test_handoff_state_roundtrip() {
    let state = HandoffState {
        task: "Build package".to_string(),
        from_agent: "Architect".to_string(),
        to_agent: "Coder".to_string(),
        summary: "Plan complete".to_string(),
        decisions: vec!["Use Rust".to_string()],
        important_files: vec!["Cargo.toml".to_string()],
        errors: vec![],
        next_steps: vec!["Write code".to_string()],
        context_refs: vec!["README.md".to_string()],
        metadata: std::collections::HashMap::new(),
    };

    let md = state.to_markdown();
    let loaded = HandoffState::from_markdown(&md);

    assert_eq!(loaded.task, state.task);
    assert_eq!(loaded.from_agent, state.from_agent);
    assert_eq!(loaded.to_agent, state.to_agent);
    assert_eq!(loaded.summary, state.summary);
    assert_eq!(loaded.decisions, state.decisions);
    assert_eq!(loaded.important_files, state.important_files);
    assert_eq!(loaded.errors, state.errors);
    assert_eq!(loaded.next_steps, state.next_steps);
    assert_eq!(loaded.context_refs, state.context_refs);
}

#[test]
fn test_run_trace_timeline() {
    let trace = RunTrace {
        run_id: "test-run".to_string(),
        name: "Test flow".to_string(),
        success: true,
        final_output: "Finished".to_string(),
        steps: vec![
            TraceStep {
                name: "Step 1".to_string(),
                agent: "Architect".to_string(),
                task: "Design API".to_string(),
                mode: "hybrid_state".to_string(),
                success: true,
                output: "Designed".to_string(),
                handoff: None,
                tool_results: vec![],
                events: vec![],
                metadata: std::collections::HashMap::new(),
            }
        ],
        handoffs: vec![],
        metadata: std::collections::HashMap::new(),
    };

    let timeline = trace.to_timeline();
    assert!(timeline.contains("Execution Timeline: Test flow"));
    assert!(timeline.contains("1. [Architect] -> Task: Design API"));
}
