use crate::{RuntimeError, RuntimeResult};
use handoffkit_contracts::{ToolCall, ToolResult};
use serde_json::Value;
use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, RwLock};

type ToolFuture = Pin<Box<dyn Future<Output = RuntimeResult<Value>> + Send>>;
type ToolHandler = Arc<dyn Fn(HashMap<String, Value>) -> ToolFuture + Send + Sync>;

#[derive(Clone)]
pub struct Tool {
    name: String,
    description: String,
    handler: ToolHandler,
}

impl std::fmt::Debug for Tool {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("Tool")
            .field("name", &self.name)
            .field("description", &self.description)
            .finish()
    }
}

impl Tool {
    pub fn new<F, Fut>(
        name: impl Into<String>,
        description: impl Into<String>,
        handler: F,
    ) -> RuntimeResult<Self>
    where
        F: Fn(HashMap<String, Value>) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = RuntimeResult<Value>> + Send + 'static,
    {
        let name = name.into();
        if name.trim().is_empty() {
            return Err(RuntimeError::new("invalid_tool", "tool name is required"));
        }
        Ok(Self {
            name,
            description: description.into(),
            handler: Arc::new(move |arguments| Box::pin(handler(arguments))),
        })
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn description(&self) -> &str {
        &self.description
    }

    pub async fn execute(&self, arguments: HashMap<String, Value>) -> RuntimeResult<Value> {
        (self.handler)(arguments).await
    }
}

#[derive(Clone, Default)]
pub struct ToolRegistry {
    tools: Arc<RwLock<HashMap<String, Tool>>>,
}

impl ToolRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&self, tool: Tool) -> RuntimeResult<()> {
        let mut tools = self.tools.write().map_err(|_| {
            RuntimeError::new("tool_registry_poisoned", "tool registry unavailable")
        })?;
        if tools.contains_key(tool.name()) {
            return Err(RuntimeError::new(
                "tool_exists",
                format!("tool '{}' already exists", tool.name()),
            ));
        }
        tools.insert(tool.name().to_string(), tool);
        Ok(())
    }

    pub fn names(&self) -> RuntimeResult<Vec<String>> {
        let tools = self.tools.read().map_err(|_| {
            RuntimeError::new("tool_registry_poisoned", "tool registry unavailable")
        })?;
        let mut names: Vec<String> = tools.keys().cloned().collect();
        names.sort();
        Ok(names)
    }

    pub async fn execute(&self, call: ToolCall) -> ToolResult {
        let tool = self
            .tools
            .read()
            .ok()
            .and_then(|tools| tools.get(&call.tool_name).cloned());
        let Some(tool) = tool else {
            return ToolResult {
                tool_name: call.tool_name,
                success: false,
                result: Value::Null,
                error: Some("unknown tool".to_string()),
                call_id: call.call_id,
                metadata: HashMap::new(),
            };
        };
        match tool.execute(call.arguments).await {
            Ok(result) => ToolResult {
                tool_name: call.tool_name,
                success: true,
                result,
                error: None,
                call_id: call.call_id,
                metadata: HashMap::new(),
            },
            Err(error) => ToolResult {
                tool_name: call.tool_name,
                success: false,
                result: Value::Null,
                error: Some(error.message),
                call_id: call.call_id,
                metadata: HashMap::new(),
            },
        }
    }

    pub async fn execute_many(&self, calls: Vec<ToolCall>) -> Vec<ToolResult> {
        let mut results = Vec::with_capacity(calls.len());
        for call in calls {
            results.push(self.execute(call).await);
        }
        results
    }
}
