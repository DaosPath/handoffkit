use handoffkit::{Agent, AgentOutput, RuntimeMode, RuntimeResult, Team};

fn agent(name: &str) -> Agent {
    let name = name.to_string();
    Agent::new(name.clone(), move |task, handoff| {
        let name = name.clone();
        async move {
            let prior = handoff.map(|state| state.summary).unwrap_or_default();
            Ok(AgentOutput::text(format!("{name}: {task}; prior={prior}")))
        }
    })
}

#[tokio::main]
async fn main() -> RuntimeResult<()> {
    let team = Team::new(
        "coding-review",
        vec![
            agent("Architect"),
            agent("Coder"),
            agent("Reviewer"),
            agent("Tester"),
        ],
    )?
    .with_runtime_mode(RuntimeMode::Session);
    let result = team.run("Build a calculator CLI").await?;
    println!(
        "agents={} handoffs={}",
        result.agent_outputs.len(),
        result.handoffs.len()
    );
    println!("final={}", result.final_output);
    Ok(())
}
