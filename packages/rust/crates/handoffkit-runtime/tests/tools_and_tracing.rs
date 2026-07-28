use handoffkit_contracts::ToolCall;
use handoffkit_runtime::{
    trace_from_team_result, Agent, AgentOutput, ReplayRunner, RuntimeMode, Team, Tool, ToolRegistry,
};
use serde_json::json;
use std::collections::HashMap;

#[tokio::test]
async fn registry_executes_tools_and_preserves_call_id() {
    let registry = ToolRegistry::new();
    registry
        .register(
            Tool::new("add", "Add two integers", |arguments| async move {
                let left = arguments["left"].as_i64().unwrap();
                let right = arguments["right"].as_i64().unwrap();
                Ok(json!(left + right))
            })
            .unwrap(),
        )
        .unwrap();
    let result = registry
        .execute(ToolCall {
            tool_name: "add".to_string(),
            arguments: HashMap::from([
                ("left".to_string(), json!(2)),
                ("right".to_string(), json!(3)),
            ]),
            call_id: "call-1".to_string(),
            metadata: HashMap::new(),
        })
        .await;
    assert!(result.success);
    assert_eq!(result.result, json!(5));
    assert_eq!(result.call_id, "call-1");
}

#[tokio::test]
async fn replay_summarizes_trace_without_reexecution() {
    let calls = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let counter = calls.clone();
    let agent = Agent::new("architect", move |task, _| {
        counter.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        async move { Ok(AgentOutput::text(task)) }
    });
    let result = Team::new("team", vec![agent])
        .unwrap()
        .with_runtime_mode(RuntimeMode::Session)
        .run("plan")
        .await
        .unwrap();
    let trace = trace_from_team_result(&result, "trace-test");
    let summary = ReplayRunner::new(&trace).summary();
    assert!(summary.success);
    assert_eq!(summary.step_count, 1);
    assert_eq!(calls.load(std::sync::atomic::Ordering::Relaxed), 1);
}
