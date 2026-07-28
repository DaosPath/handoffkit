use handoffkit_protocol::RuntimeMode;
use handoffkit_runtime::{
    Agent, AgentOutput, CspRuntime, Recipe, RecipeRunner, RecipeStep, RuntimeError, Team,
};

fn agent(name: &str) -> Agent {
    let name = name.to_string();
    Agent::new(name.clone(), move |task, handoff| {
        let name = name.clone();
        async move {
            let previous = handoff.map(|state| state.summary).unwrap_or_default();
            Ok(AgentOutput::text(format!("{name}:{task}:{previous}")))
        }
    })
}

#[tokio::test]
async fn classic_and_session_team_preserve_order_and_handoffs() {
    let agents = vec![agent("architect"), agent("coder"), agent("tester")];
    let classic = Team::new("coding", agents.clone())
        .unwrap()
        .run("build calculator")
        .await
        .unwrap();
    let session = Team::new("coding", agents)
        .unwrap()
        .with_runtime_mode(RuntimeMode::Session)
        .run("build calculator")
        .await
        .unwrap();
    assert_eq!(classic.agent_outputs.len(), 3);
    assert_eq!(session.agent_outputs.len(), 3);
    assert_eq!(session.handoffs.len(), 2);
    assert_eq!(session.handoffs[0].from_agent, "architect");
    assert_eq!(session.handoffs[1].to_agent, "tester");
    assert_eq!(classic.final_output, session.final_output);
}

#[tokio::test]
async fn recipe_runs_in_session_mode() {
    let recipe = Recipe::new(
        "review",
        "Architect, coder, tester",
        vec![
            RecipeStep::new("architect", "design", agent("architect")),
            RecipeStep::new("coder", "implement", agent("coder")),
            RecipeStep::new("tester", "verify", agent("tester")),
        ],
    )
    .unwrap();
    let result = RecipeRunner::new(recipe)
        .with_runtime_mode(RuntimeMode::Session)
        .run(Some("calculator".to_string()))
        .await
        .unwrap();
    assert!(result.success);
    assert_eq!(result.step_results.len(), 3);
    assert_eq!(result.handoff_states.len(), 2);
    assert!(result.final_output.contains("tester"));
}

#[tokio::test]
async fn failed_team_run_always_removes_its_session() {
    let runtime = CspRuntime::new();
    let failing = Agent::new("failing", |_task, _handoff| async {
        Err(RuntimeError::new("agent_failed", "expected failure"))
    });
    let team = Team::new("cleanup", vec![failing, agent("unused")])
        .unwrap()
        .with_runtime_mode(RuntimeMode::Session)
        .with_runtime(runtime.clone());
    let error = team.run("task").await.unwrap_err();
    assert_eq!(error.code, "agent_failed");
    assert_eq!(runtime.session_count().await, 0);
}
