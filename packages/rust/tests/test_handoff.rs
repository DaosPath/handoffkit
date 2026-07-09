use handoffkit::{
    ContractParityReport, HandoffQualityReport, HandoffState, RunTrace, ToolCall, ToolResult,
    TraceStep, ValidationReport,
};

fn fixture(name: &str) -> serde_json::Value {
    let path = format!("../contracts/fixtures/{}", name);
    let text = std::fs::read_to_string(path).expect("shared contract fixture should exist");
    serde_json::from_str(&text).expect("fixture should be valid json")
}

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
        steps: vec![TraceStep {
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
        }],
        handoffs: vec![],
        metadata: std::collections::HashMap::new(),
    };

    let timeline = trace.to_timeline();
    assert!(timeline.contains("Execution Timeline: Test flow"));
    assert!(timeline.contains("1. [Architect] -> Task: Design API"));
}

#[test]
fn test_shared_validation_report_fixture_roundtrip() {
    let data = fixture("validation_report.json");
    let report: ValidationReport = serde_json::from_value(data.clone()).unwrap();

    assert!(!report.success);
    assert_eq!(report.issues[0].code, "missing_task");
    assert!(report.raise_if_failed().is_err());
    assert_eq!(serde_json::to_value(&report).unwrap(), data);
}

#[test]
fn test_shared_quality_report_fixture_roundtrip() {
    let data = fixture("quality_report.json");
    let report: HandoffQualityReport = serde_json::from_value(data.clone()).unwrap();

    assert!(report.success);
    assert_eq!(report.grade, "B");
    assert_eq!(report.metrics.len(), 5);
    assert_eq!(serde_json::to_value(&report).unwrap(), data);
}

#[test]
fn test_shared_tool_call_and_result_fixtures_roundtrip() {
    let call_data = fixture("tool_call.json");
    let result_data = fixture("tool_result.json");
    let call: ToolCall = serde_json::from_value(call_data.clone()).unwrap();
    let result: ToolResult = serde_json::from_value(result_data.clone()).unwrap();

    assert_eq!(call.tool_name, "add");
    assert_eq!(call.call_id, "call-12345");
    assert!(result.success);
    assert_eq!(result.result, serde_json::json!(15));
    assert_eq!(serde_json::to_value(&call).unwrap(), call_data);
    assert_eq!(serde_json::to_value(&result).unwrap(), result_data);
}

#[test]
fn test_contract_parity_report_marks_supported_contracts() {
    let fixtures = [
        "handoff_state",
        "run_trace",
        "validation_report",
        "quality_report",
    ];
    let schemas = [
        "handoff-state",
        "run-trace",
        "validation-report",
        "quality-report",
    ];
    let report = ContractParityReport::new("rust", "1.8.10", &fixtures, &schemas);

    assert!(report.success);
    assert_eq!(report.fixture_count, 4);
    assert!(report.to_markdown().contains("Contract Parity Report"));
}
