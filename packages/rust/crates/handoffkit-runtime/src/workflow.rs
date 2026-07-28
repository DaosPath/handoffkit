use crate::{CspRuntime, CspSession, RuntimeError, RuntimeResult};
use handoffkit_contracts::HandoffState;
use handoffkit_protocol::{RuntimeMode, SessionConfig};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

static NEXT_WORKFLOW_ID: AtomicU64 = AtomicU64::new(1);

type AgentFuture = Pin<Box<dyn Future<Output = RuntimeResult<AgentOutput>> + Send>>;
type AgentHandler = Arc<dyn Fn(String, Option<HandoffState>) -> AgentFuture + Send + Sync>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct AgentOutput {
    pub output: String,
    #[serde(default)]
    pub handoff: Option<HandoffState>,
    #[serde(default)]
    pub metadata: HashMap<String, Value>,
}

impl AgentOutput {
    pub fn text(output: impl Into<String>) -> Self {
        Self {
            output: output.into(),
            ..Self::default()
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct AgentRunResult {
    pub agent: String,
    pub output: String,
    pub success: bool,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub handoff: Option<HandoffState>,
    #[serde(default)]
    pub metadata: HashMap<String, Value>,
}

#[derive(Clone)]
pub struct Agent {
    name: String,
    handler: AgentHandler,
}

impl std::fmt::Debug for Agent {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("Agent")
            .field("name", &self.name)
            .finish()
    }
}

impl Agent {
    pub fn new<F, Fut>(name: impl Into<String>, handler: F) -> Self
    where
        F: Fn(String, Option<HandoffState>) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = RuntimeResult<AgentOutput>> + Send + 'static,
    {
        Self {
            name: name.into(),
            handler: Arc::new(move |task, handoff| Box::pin(handler(task, handoff))),
        }
    }

    pub fn deterministic(name: impl Into<String>) -> Self {
        let name = name.into();
        let output_name = name.clone();
        Self::new(name, move |task, _| {
            let output_name = output_name.clone();
            async move { Ok(AgentOutput::text(format!("{output_name}: {task}"))) }
        })
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub async fn run(
        &self,
        task: impl Into<String>,
        handoff: Option<HandoffState>,
    ) -> RuntimeResult<AgentRunResult> {
        let output = (self.handler)(task.into(), handoff).await?;
        Ok(AgentRunResult {
            agent: self.name.clone(),
            output: output.output,
            success: true,
            error: None,
            handoff: output.handoff,
            metadata: output.metadata,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct TeamRunResult {
    pub task: String,
    pub final_output: String,
    #[serde(default)]
    pub agent_outputs: Vec<AgentRunResult>,
    #[serde(default)]
    pub handoffs: Vec<HandoffState>,
    pub success: bool,
    #[serde(default)]
    pub metadata: HashMap<String, Value>,
}

#[derive(Clone)]
pub struct Team {
    name: String,
    agents: Vec<Agent>,
    runtime_mode: RuntimeMode,
    runtime: Option<CspRuntime>,
}

impl std::fmt::Debug for Team {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("Team")
            .field("name", &self.name)
            .field("agents", &self.agents)
            .field("runtime_mode", &self.runtime_mode)
            .finish()
    }
}

impl Team {
    pub fn new(name: impl Into<String>, agents: Vec<Agent>) -> RuntimeResult<Self> {
        if agents.is_empty() {
            return Err(RuntimeError::new(
                "empty_team",
                "team requires at least one agent",
            ));
        }
        Ok(Self {
            name: name.into(),
            agents,
            runtime_mode: RuntimeMode::Classic,
            runtime: None,
        })
    }

    pub fn with_runtime_mode(mut self, mode: RuntimeMode) -> Self {
        self.runtime_mode = mode;
        self
    }

    pub fn with_runtime(mut self, runtime: CspRuntime) -> Self {
        self.runtime = Some(runtime);
        self
    }

    pub fn runtime_mode(&self) -> RuntimeMode {
        self.runtime_mode
    }

    pub async fn run(&self, task: impl Into<String>) -> RuntimeResult<TeamRunResult> {
        let task = task.into();
        match self.runtime_mode {
            RuntimeMode::Classic => self.run_classic(task).await,
            RuntimeMode::Session => self.run_session(task).await,
            RuntimeMode::Distributed => Err(RuntimeError::new(
                "distributed_unavailable",
                "distributed team execution is reserved for HandoffKit 1.18",
            )),
        }
    }

    async fn run_classic(&self, task: String) -> RuntimeResult<TeamRunResult> {
        let mut agent_outputs = Vec::with_capacity(self.agents.len());
        let mut handoffs = Vec::with_capacity(self.agents.len().saturating_sub(1));
        let mut current_handoff = None;
        for (index, agent) in self.agents.iter().enumerate() {
            let mut result = agent.run(task.clone(), current_handoff.clone()).await?;
            if index + 1 < self.agents.len() {
                let handoff = result.handoff.clone().unwrap_or_else(|| {
                    default_handoff(
                        &task,
                        agent.name(),
                        self.agents[index + 1].name(),
                        &result.output,
                    )
                });
                result.handoff = Some(handoff.clone());
                handoffs.push(handoff.clone());
                current_handoff = Some(handoff);
            }
            agent_outputs.push(result);
        }
        Ok(team_result(task, agent_outputs, handoffs))
    }

    async fn run_session(&self, task: String) -> RuntimeResult<TeamRunResult> {
        let runtime = self.runtime.clone().unwrap_or_default();
        let run_id = NEXT_WORKFLOW_ID.fetch_add(1, Ordering::Relaxed);
        let session_id = format!("team-{}-{run_id}", self.name);
        let session = runtime
            .create_session(default_session_config(session_id))
            .await?;
        let execution = self.execute_session(&session, task).await;
        let cleanup = runtime.close_session(session.id()).await;
        match (execution, cleanup) {
            (Ok(result), Ok(())) => Ok(result),
            (Err(error), _) => Err(error),
            (Ok(_), Err(error)) => Err(error),
        }
    }

    async fn execute_session(
        &self,
        session: &CspSession,
        task: String,
    ) -> RuntimeResult<TeamRunResult> {
        let result_channel = "team.result";
        session.open_default_channel(result_channel).await?;
        for index in 0..self.agents.len() {
            session
                .open_default_channel(format!("team.agent.{index}"))
                .await?;
        }

        let mut handles = Vec::with_capacity(self.agents.len());
        for (index, agent) in self.agents.iter().cloned().enumerate() {
            let input_channel = format!("team.agent.{index}");
            let output_channel = if index + 1 == self.agents.len() {
                result_channel.to_string()
            } else {
                format!("team.agent.{}", index + 1)
            };
            let next_agent = self
                .agents
                .get(index + 1)
                .map(|item| item.name().to_string());
            let final_channel = result_channel.to_string();
            let handle = session.spawn(agent.name().to_string(), move |context| async move {
                let Some(envelope) = context.receive(&input_channel).await? else {
                    return Err(RuntimeError::new("channel_closed", "agent input closed"));
                };
                let mut packet: WorkflowPacket = serde_json::from_value(envelope.payload)?;
                match agent.run(packet.task.clone(), packet.handoff.clone()).await {
                    Ok(mut result) => {
                        if let Some(next_agent) = &next_agent {
                            let handoff = result.handoff.clone().unwrap_or_else(|| {
                                default_handoff(
                                    &packet.task,
                                    agent.name(),
                                    next_agent,
                                    &result.output,
                                )
                            });
                            result.handoff = Some(handoff.clone());
                            packet.handoffs.push(handoff.clone());
                            packet.handoff = Some(handoff);
                        }
                        packet.outputs.push(result);
                    }
                    Err(error) => {
                        packet.error = Some(error.to_string());
                    }
                }
                let destination = if packet.error.is_some() {
                    final_channel
                } else {
                    output_channel
                };
                let response = context.session().envelope(
                    &destination,
                    "workflow_step",
                    agent.name(),
                    "workflow_packet",
                    serde_json::to_value(packet)?,
                );
                context.send(&destination, response).await
            })?;
            handles.push(handle);
        }

        let first = session.envelope(
            "team.agent.0",
            "workflow_start",
            "team",
            "workflow_packet",
            serde_json::to_value(WorkflowPacket {
                task: task.clone(),
                ..WorkflowPacket::default()
            })?,
        );
        session.send("team.agent.0", first).await?;
        let envelope = session
            .receive(result_channel)
            .await?
            .ok_or_else(|| RuntimeError::new("missing_result", "team result channel closed"))?;
        let packet: WorkflowPacket = serde_json::from_value(envelope.payload)?;

        if packet.error.is_some() {
            for handle in &handles {
                handle.cancel();
            }
        }
        let mut process_error = None;
        for handle in handles {
            if let Err(error) = handle.wait().await {
                process_error.get_or_insert(error);
            }
        }

        if let Some(error) = packet.error {
            return Err(RuntimeError::new("agent_failed", error));
        }
        if let Some(error) = process_error {
            return Err(error);
        }
        Ok(team_result(task, packet.outputs, packet.handoffs))
    }
}

#[derive(Debug, Clone)]
pub struct RecipeStep {
    pub name: String,
    pub task: String,
    pub agent: Agent,
    pub metadata: HashMap<String, Value>,
}

impl RecipeStep {
    pub fn new(name: impl Into<String>, task: impl Into<String>, agent: Agent) -> Self {
        Self {
            name: name.into(),
            task: task.into(),
            agent,
            metadata: HashMap::new(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct Recipe {
    pub name: String,
    pub description: String,
    pub steps: Vec<RecipeStep>,
    pub metadata: HashMap<String, Value>,
}

impl Recipe {
    pub fn new(
        name: impl Into<String>,
        description: impl Into<String>,
        steps: Vec<RecipeStep>,
    ) -> RuntimeResult<Self> {
        let recipe = Self {
            name: name.into(),
            description: description.into(),
            steps,
            metadata: HashMap::new(),
        };
        recipe.validate()?;
        Ok(recipe)
    }

    pub fn validate(&self) -> RuntimeResult<()> {
        if self.name.trim().is_empty() {
            return Err(RuntimeError::new(
                "invalid_recipe",
                "recipe name is required",
            ));
        }
        if self.steps.is_empty() {
            return Err(RuntimeError::new(
                "invalid_recipe",
                "recipe steps are required",
            ));
        }
        let mut names = HashSet::new();
        for step in &self.steps {
            if step.name.trim().is_empty() || step.task.trim().is_empty() {
                return Err(RuntimeError::new(
                    "invalid_recipe",
                    "recipe step name and task are required",
                ));
            }
            if !names.insert(step.name.clone()) {
                return Err(RuntimeError::new(
                    "invalid_recipe",
                    format!("duplicate recipe step '{}'", step.name),
                ));
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct RecipeStepResult {
    pub step_name: String,
    pub agent_name: String,
    pub success: bool,
    pub output: String,
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct RecipeRunResult {
    pub recipe_name: String,
    pub success: bool,
    pub final_output: String,
    #[serde(default)]
    pub step_results: Vec<RecipeStepResult>,
    #[serde(default)]
    pub handoff_states: Vec<HandoffState>,
    #[serde(default)]
    pub metadata: HashMap<String, Value>,
}

#[derive(Clone)]
pub struct RecipeRunner {
    recipe: Recipe,
    runtime_mode: RuntimeMode,
    runtime: Option<CspRuntime>,
}

impl RecipeRunner {
    pub fn new(recipe: Recipe) -> Self {
        Self {
            recipe,
            runtime_mode: RuntimeMode::Classic,
            runtime: None,
        }
    }

    pub fn with_runtime_mode(mut self, mode: RuntimeMode) -> Self {
        self.runtime_mode = mode;
        self
    }

    pub fn with_runtime(mut self, runtime: CspRuntime) -> Self {
        self.runtime = Some(runtime);
        self
    }

    pub async fn run(&self, initial_task: Option<String>) -> RuntimeResult<RecipeRunResult> {
        self.recipe.validate()?;
        let mut agents = Vec::with_capacity(self.recipe.steps.len());
        for step in &self.recipe.steps {
            let agent = step.agent.clone();
            let step_task = step.task.clone();
            agents.push(Agent::new(step.name.clone(), move |initial, handoff| {
                let agent = agent.clone();
                let step_task = step_task.clone();
                async move {
                    let task = if initial.trim().is_empty() {
                        step_task
                    } else {
                        format!("{step_task}\n\nInitial task: {initial}")
                    };
                    let result = agent.run(task, handoff).await?;
                    Ok(AgentOutput {
                        output: result.output,
                        handoff: result.handoff,
                        metadata: result.metadata,
                    })
                }
            }));
        }
        let mut team =
            Team::new(self.recipe.name.clone(), agents)?.with_runtime_mode(self.runtime_mode);
        if let Some(runtime) = &self.runtime {
            team = team.with_runtime(runtime.clone());
        }
        let result = team.run(initial_task.unwrap_or_default()).await?;
        let step_results = result
            .agent_outputs
            .iter()
            .zip(&self.recipe.steps)
            .map(|(output, step)| RecipeStepResult {
                step_name: step.name.clone(),
                agent_name: output.agent.clone(),
                success: output.success,
                output: output.output.clone(),
                error: output.error.clone(),
            })
            .collect();
        Ok(RecipeRunResult {
            recipe_name: self.recipe.name.clone(),
            success: result.success,
            final_output: result.final_output,
            step_results,
            handoff_states: result.handoffs,
            metadata: self.recipe.metadata.clone(),
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct WorkflowPacket {
    task: String,
    #[serde(default)]
    handoff: Option<HandoffState>,
    #[serde(default)]
    outputs: Vec<AgentRunResult>,
    #[serde(default)]
    handoffs: Vec<HandoffState>,
    #[serde(default)]
    error: Option<String>,
}

fn default_handoff(task: &str, from_agent: &str, to_agent: &str, output: &str) -> HandoffState {
    HandoffState {
        task: task.to_string(),
        from_agent: from_agent.to_string(),
        to_agent: to_agent.to_string(),
        summary: output.to_string(),
        next_steps: vec![format!("Continue as {to_agent}")],
        ..HandoffState::default()
    }
}

fn team_result(
    task: String,
    agent_outputs: Vec<AgentRunResult>,
    handoffs: Vec<HandoffState>,
) -> TeamRunResult {
    let final_output = agent_outputs
        .last()
        .map(|item| item.output.clone())
        .unwrap_or_default();
    TeamRunResult {
        task,
        final_output,
        success: agent_outputs.iter().all(|item| item.success),
        agent_outputs,
        handoffs,
        metadata: HashMap::new(),
    }
}

fn default_session_config(session_id: String) -> SessionConfig {
    SessionConfig {
        session_id,
        runtime_mode: RuntimeMode::Session,
        channel_capacity: handoffkit_protocol::DEFAULT_CHANNEL_CAPACITY,
        max_message_bytes: handoffkit_protocol::DEFAULT_MAX_MESSAGE_BYTES,
        ack_timeout_ms: 5_000,
        dedup_capacity: 4_096,
        retry_policy: handoffkit_protocol::RetryPolicy::default(),
        deadline: Some(
            (chrono::Utc::now() + chrono::Duration::seconds(30))
                .to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        ),
        metadata: HashMap::new(),
    }
}
