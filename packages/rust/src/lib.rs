use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct HandoffState {
    pub task: String,
    pub from_agent: String,
    pub to_agent: String,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub decisions: Vec<String>,
    #[serde(default)]
    pub important_files: Vec<String>,
    #[serde(default)]
    pub errors: Vec<String>,
    #[serde(default)]
    pub next_steps: Vec<String>,
    #[serde(default)]
    pub context_refs: Vec<String>,
    #[serde(default)]
    pub metadata: HashMap<String, serde_json::Value>,
}

impl HandoffState {
    pub fn to_markdown(&self) -> String {
        let mut lines = vec![
            "# HandoffState".to_string(),
            "".to_string(),
            format!("Task: {}", self.task),
            format!("From: {}", if self.from_agent.is_empty() { "-" } else { &self.from_agent }),
            format!("To: {}", if self.to_agent.is_empty() { "-" } else { &self.to_agent }),
            "".to_string(),
            "## Summary".to_string(),
            if self.summary.is_empty() { "-".to_string() } else { self.summary.clone() },
            "".to_string(),
        ];

        let mut add_list_section = |title: &str, items: &[String]| {
            lines.push(format!("## {}", title));
            if items.is_empty() {
                lines.push("-".to_string());
            } else {
                for item in items {
                    lines.push(format!("- {}", item));
                }
            }
            lines.push("".to_string());
        };

        add_list_section("Decisions", &self.decisions);
        add_list_section("Files", &self.important_files);
        add_list_section("Errors", &self.errors);
        add_list_section("Next Steps", &self.next_steps);
        add_list_section("Context Refs", &self.context_refs);

        lines.join("\n").trim().to_string()
    }

    pub fn from_markdown(text: &str) -> Self {
        let mut task = String::new();
        let mut from_agent = String::new();
        let mut to_agent = String::new();
        let mut summary;
        let mut decisions = Vec::new();
        let mut important_files = Vec::new();
        let mut errors = Vec::new();
        let mut next_steps = Vec::new();
        let mut context_refs = Vec::new();

        let mut current_section = String::new();
        let mut summary_lines = Vec::new();

        for line in text.lines() {
            let line_str = line.trim();
            if line_str.is_empty() {
                continue;
            }

            if line_str.starts_with("Task:") {
                task = line_str["Task:".len()..].trim().to_string();
                continue;
            }
            if line_str.starts_with("From:") {
                from_agent = line_str["From:".len()..].trim().to_string();
                if from_agent == "-" {
                    from_agent.clear();
                }
                continue;
            }
            if line_str.starts_with("To:") {
                to_agent = line_str["To:".len()..].trim().to_string();
                if to_agent == "-" {
                    to_agent.clear();
                }
                continue;
            }

            if line_str.starts_with("## ") {
                current_section = line_str["## ".len()..].trim().to_lowercase();
                continue;
            }

            if current_section == "summary" {
                summary_lines.push(line_str);
            } else if line_str.starts_with('-') {
                let val = line_str[1..].trim().to_string();
                if val.is_empty() || val == "-" {
                    continue;
                }
                match current_section.as_str() {
                    "decisions" => decisions.push(val),
                    "files" | "important files" | "important_files" => important_files.push(val),
                    "errors" => errors.push(val),
                    "next steps" | "next_steps" => next_steps.push(val),
                    "context refs" | "context_refs" => context_refs.push(val),
                    _ => {}
                }
            }
        }

        summary = summary_lines.join("\n").trim().to_string();
        if summary == "-" {
            summary.clear();
        }

        Self {
            task,
            from_agent,
            to_agent,
            summary,
            decisions,
            important_files,
            errors,
            next_steps,
            context_refs,
            metadata: HashMap::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct TraceStep {
    pub name: String,
    #[serde(default)]
    pub agent: String,
    #[serde(default)]
    pub task: String,
    #[serde(default)]
    pub mode: String,
    pub success: bool,
    #[serde(default)]
    pub output: String,
    #[serde(default)]
    pub handoff: Option<HandoffState>,
    #[serde(default)]
    pub tool_results: Vec<serde_json::Value>,
    #[serde(default)]
    pub events: Vec<serde_json::Value>,
    #[serde(default)]
    pub metadata: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct RunTrace {
    pub run_id: String,
    pub name: String,
    pub success: bool,
    pub final_output: String,
    pub steps: Vec<TraceStep>,
    pub handoffs: Vec<HandoffState>,
    #[serde(default)]
    pub metadata: HashMap<String, serde_json::Value>,
}

impl RunTrace {
    pub fn to_timeline(&self) -> String {
        let mut lines = vec![
            format!("# Execution Timeline: {} (Run ID: {})", self.name, self.run_id),
            format!("- Success: {}", self.success),
            format!("- Total Steps: {}", self.steps.len()),
            format!("- Total Handoffs: {}", self.handoffs.len()),
            "".to_string(),
            "## Timeline".to_string(),
        ];

        for (i, step) in self.steps.iter().enumerate() {
            let step_num = i + 1;
            let agent_name = if step.agent.is_empty() { "Unknown" } else { &step.agent };
            lines.push(format!("{}. [{}] -> Task: {}", step_num, agent_name, step.task));
            lines.push(format!("   - Mode: {}", if step.mode.is_empty() { "default" } else { &step.mode }));
            lines.push(format!("   - Success: {}", step.success));
            lines.push(format!("   - Tools Used: {}", step.tool_results.len()));
            if !step.output.is_empty() {
                let preview = if step.output.len() > 60 {
                    format!("{}...", &step.output[..60].replace('\n', " "))
                } else {
                    step.output.replace('\n', " ")
                };
                lines.push(format!("   - Output Preview: {}", preview));
            }
            if let Some(ref handoff) = step.handoff {
                lines.push(format!("   - [Handoff] -> {} to {}", handoff.from_agent, handoff.to_agent));
            }
        }

        lines.join("\n")
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct ContextDocument {
    pub path: String,
    pub content: String,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub metadata: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct ContextPack {
    pub query: String,
    #[serde(default)]
    pub documents: Vec<ContextDocument>,
    #[serde(default)]
    pub memories: Vec<serde_json::Value>,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub metadata: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct ContextRunResult {
    pub final_output: String,
    #[serde(default)]
    pub context_used: Option<ContextPack>,
    #[serde(default)]
    pub memories_used: Vec<serde_json::Value>,
    pub success: bool,
}
