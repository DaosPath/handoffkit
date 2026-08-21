use handoffkit_browser_core::{
    assert_filesystem, assert_network_url, classify_network_target, parse_core_model,
    reject_public_bind, BrowserCoreError,
};
use serde_json::Value;

fn vectors() -> Value {
    let path = format!(
        "{}/../../../contracts/conformance/browser-core-v1.json",
        env!("CARGO_MANIFEST_DIR")
    );
    let text = std::fs::read_to_string(path).expect("browser core vectors");
    serde_json::from_str(&text).expect("valid json")
}

#[test]
fn golden_round_trips() {
    let vectors = vectors();
    let models = [
        ("browser_error", "BrowserError"),
        ("browser_capabilities", "BrowserCapabilities"),
        ("browser_policy", "BrowserPolicy"),
        ("browser_session_request", "BrowserSessionRequest"),
        ("browser_session_state", "BrowserSessionState"),
        ("browser_command", "BrowserCommand"),
        ("browser_event", "BrowserEvent"),
        ("search_request", "SearchRequest"),
        ("search_result", "SearchResult"),
        ("page_snapshot", "PageSnapshot"),
        ("document_record", "DocumentRecord"),
        ("provider_trace", "ProviderTrace"),
        ("research_job", "ResearchJob"),
        ("research_progress", "ResearchProgress"),
        ("research_result", "ResearchResult"),
    ];
    for (key, name) in models {
        let expected = &vectors["vectors"][key];
        let parsed = parse_core_model(name, expected).expect(name);
        assert_eq!(parsed, *expected, "{name}");
    }
}

#[test]
fn negative_vectors() {
    let vectors = vectors();
    for case in vectors["negative"].as_array().unwrap() {
        let error = parse_core_model(case["model"].as_str().unwrap(), &case["input"])
            .expect_err(case["id"].as_str().unwrap());
        assert_eq!(error.code, case["error_code"].as_str().unwrap());
    }
}

#[test]
fn public_bind_rejected() {
    let error: BrowserCoreError =
        reject_public_bind(&serde_json::json!({}), "0.0.0.0").unwrap_err();
    assert_eq!(error.code, "public_bind_rejected");
    reject_public_bind(&serde_json::json!({}), "127.0.0.1").unwrap();
}

#[test]
fn network_and_filesystem_policies() {
    assert_eq!(
        classify_network_target("http://127.0.0.1/")["kind"],
        "loopback"
    );
    let error = assert_network_url(&serde_json::json!({}), "http://192.168.1.8/").unwrap_err();
    assert_eq!(error.code, "policy_denied");
    assert_network_url(&serde_json::json!({}), "https://example.org/").unwrap();
    let fs = assert_filesystem(&serde_json::json!({}), "read").unwrap_err();
    assert_eq!(fs.code, "policy_denied");
    assert_filesystem(&serde_json::json!({}), "download").unwrap();
}
