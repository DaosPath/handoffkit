//! 1.14.1 mini-demo: structured handoff wire (Rust contracts).
//! Justifies the patch release alongside Python/JS demos and C++ handoffkit::core packaging.

use handoffkit::HandoffState;

fn main() {
    println!("handoffkit Rust — core_runtime_safety_demo (1.14.1)");
    println!("theme: HandoffState markdown + JSON wire (contracts package)\n");

    let state = HandoffState {
        task: "Document installable core surfaces across runtimes.".to_string(),
        from_agent: "Architect".to_string(),
        to_agent: "Coder".to_string(),
        summary: "Python/JS demos + C++ handoffkit::core consumer smoke; no shell by default."
            .to_string(),
        decisions: vec![
            "Ship patch 1.14.1 with C++ tarball path.".to_string(),
            "Keep wire snake_case parity.".to_string(),
        ],
        important_files: vec![
            "packages/cpp/examples/consumer_core/".to_string(),
            "packages/python/examples/demos/core_runtime_safety_demo.py".to_string(),
            "packages/js/core/examples/core_runtime_safety_demo.js".to_string(),
        ],
        errors: vec![],
        next_steps: vec![
            "Tag v1.14.1 and publish C++ source tarball.".to_string(),
            "Fill conandata.yml sha256 from SHA256SUMS.".to_string(),
        ],
        context_refs: vec!["packages/cpp/RELEASE.md".to_string()],
        metadata: Default::default(),
    };

    let md = state.to_markdown();
    let round = HandoffState::from_markdown(&md);
    assert_eq!(round.task, state.task);
    assert_eq!(round.from_agent, state.from_agent);
    assert_eq!(round.to_agent, state.to_agent);
    println!("[wire] markdown round-trip OK ({} chars)", md.len());

    let json = serde_json::to_string_pretty(&state).expect("json");
    let from_json: HandoffState = serde_json::from_str(&json).expect("parse");
    assert_eq!(from_json.summary, state.summary);
    println!("[wire] json round-trip OK ({} bytes)", json.len());
    println!("\ncore_runtime_safety_demo OK");
}
