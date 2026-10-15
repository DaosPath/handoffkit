//! I/O-free Browser Core contracts. Canonical wire JSON is snake_case.

use serde_json::{json, Map, Value};

pub const CONTRACT_VERSION: &str = "1.20.0-alpha.1";
pub const CONTRACT_FORMAT: &str = "handoffkit.browser.core";

#[derive(Debug)]
pub struct BrowserCoreError {
    pub code: String,
    pub message: String,
}

impl std::fmt::Display for BrowserCoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for BrowserCoreError {}

fn err(code: &str, message: &str) -> BrowserCoreError {
    BrowserCoreError {
        code: code.to_string(),
        message: message.to_string(),
    }
}

fn obj(value: &Value) -> Map<String, Value> {
    value.as_object().cloned().unwrap_or_default()
}

fn text(map: &Map<String, Value>, key: &str, fallback: &str) -> String {
    map.get(key)
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| fallback.to_string())
}

fn bool_field(map: &Map<String, Value>, key: &str, fallback: bool) -> bool {
    map.get(key).and_then(Value::as_bool).unwrap_or(fallback)
}

fn int_field(map: &Map<String, Value>, key: &str, fallback: i64) -> i64 {
    map.get(key).and_then(Value::as_i64).unwrap_or(fallback)
}

fn arr(map: &Map<String, Value>, key: &str) -> Vec<Value> {
    map.get(key)
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

fn nested(map: &Map<String, Value>, key: &str) -> Map<String, Value> {
    map.get(key).map(obj).unwrap_or_default()
}

fn require_code(code: &str) -> Result<(), BrowserCoreError> {
    const CODES: &[&str] = &[
        "",
        "invalid_request",
        "unauthorized",
        "replay_detected",
        "capability_denied",
        "policy_denied",
        "provider_unavailable",
        "provider_challenge",
        "timeout",
        "cancelled",
        "interrupted",
        "not_found",
        "index_corrupt",
        "index_unavailable",
        "public_bind_rejected",
        "profile_denied",
        "javascript_denied",
        "download_quarantined",
        "engine_crash",
        "engine_unsupported",
        "strict_provider_rejected",
        "user_browser_bridge_required",
        "default_browser_bridge_required",
        "query_required",
        "no_results",
        "robots_denied",
        "rate_limited",
        "unsupported_provider",
        "artifact_write_failed",
        "artifact_integrity_failed",
        "download_too_large",
    ];
    if CODES.contains(&code) {
        Ok(())
    } else {
        Err(err(
            "invalid_request",
            &format!("Unknown browser error code: {code}"),
        ))
    }
}

fn require_one(value: &str, allowed: &[&str], field: &str) -> Result<(), BrowserCoreError> {
    if allowed.contains(&value) {
        Ok(())
    } else {
        Err(err("invalid_request", &format!("Invalid {field}: {value}")))
    }
}

fn require_rfc3339(value: &str, field: &str) -> Result<(), BrowserCoreError> {
    if value.is_empty() {
        return Ok(());
    }
    let ok = value.len() >= 20
        && value.as_bytes().get(4) == Some(&b'-')
        && value.as_bytes().get(7) == Some(&b'-')
        && value.as_bytes().get(10) == Some(&b'T')
        && (value.ends_with('Z') || value.contains('+') || value.rfind('-').unwrap_or(0) > 10);
    if ok {
        Ok(())
    } else {
        Err(err("invalid_request", &format!("{field} must be RFC 3339")))
    }
}

fn sha256_ok(value: &str) -> bool {
    value.len() == 64 && value.chars().all(|c| matches!(c, '0'..='9' | 'a'..='f'))
}

fn provenance(data: &Value) -> Value {
    let source = obj(data);
    json!({
        "provider": text(&source, "provider", ""),
        "method": text(&source, "method", ""),
        "redirects": int_field(&source, "redirects", 0),
        "status": int_field(&source, "status", 0),
    })
}

fn parse_error(input: &Value) -> Result<Value, BrowserCoreError> {
    let data = obj(input);
    let code = text(&data, "code", "");
    require_code(&code)?;
    Ok(json!({
        "contract_version": text(&data, "contract_version", CONTRACT_VERSION),
        "code": code,
        "message": text(&data, "message", ""),
        "retryable": bool_field(&data, "retryable", false),
        "details": data.get("details").cloned().unwrap_or_else(|| json!({})),
        "request_id": text(&data, "request_id", ""),
        "command_id": text(&data, "command_id", ""),
        "session_id": text(&data, "session_id", ""),
        "occurred_at": text(&data, "occurred_at", ""),
    }))
}

fn parse_policy(input: &Value) -> Result<Value, BrowserCoreError> {
    let data = obj(input);
    let credentials = nested(&data, "credentials");
    if bool_field(&credentials, "reuse_user_profile", false)
        || bool_field(&credentials, "share_cookies", false)
    {
        return Err(err(
            "profile_denied",
            "Sharing cookies or reusing the operator browser profile is forbidden",
        ));
    }
    let network = nested(&data, "network");
    let filesystem = nested(&data, "filesystem");
    let javascript = nested(&data, "javascript");
    let index = nested(&data, "index");
    let bind = nested(&data, "bind");
    Ok(json!({
        "contract_version": text(&data, "contract_version", CONTRACT_VERSION),
        "network": {
            "allow_loopback": bool_field(&network, "allow_loopback", false),
            "allow_private": bool_field(&network, "allow_private", false),
            "allow_public": bool_field(&network, "allow_public", true),
            "allow_hosts": network.get("allow_hosts").cloned().unwrap_or_else(|| json!([])),
            "deny_hosts": network.get("deny_hosts").cloned().unwrap_or_else(|| json!([])),
            "max_redirects": int_field(&network, "max_redirects", 5),
            "max_body_bytes": int_field(&network, "max_body_bytes", 2 * 1024 * 1024),
            "max_decompress_bytes": int_field(&network, "max_decompress_bytes", 8 * 1024 * 1024),
            "timeout_ms": int_field(&network, "timeout_ms", 15000),
            "respect_robots": bool_field(&network, "respect_robots", true),
        },
        "filesystem": {
            "allow_read": bool_field(&filesystem, "allow_read", false),
            "allow_write": bool_field(&filesystem, "allow_write", false),
            "download_dir": text(&filesystem, "download_dir", ""),
            "quarantine_downloads": bool_field(&filesystem, "quarantine_downloads", true),
            "max_download_bytes": int_field(&filesystem, "max_download_bytes", 50 * 1024 * 1024),
        },
        "javascript": { "allow_evaluate": bool_field(&javascript, "allow_evaluate", false) },
        "credentials": {
            "share_cookies": bool_field(&credentials, "share_cookies", false),
            "persistent_profile": bool_field(&credentials, "persistent_profile", false),
            "profile_dir": text(&credentials, "profile_dir", ""),
            "reuse_user_profile": false,
        },
        "index": {
            "enabled": bool_field(&index, "enabled", false),
            "max_documents": int_field(&index, "max_documents", 10000),
            "max_bytes": int_field(&index, "max_bytes", 256 * 1024 * 1024),
            "retention_days": int_field(&index, "retention_days", 30),
            "max_hosts": int_field(&index, "max_hosts", 256),
        },
        "bind": {
            "allow_public_bind": bool_field(&bind, "allow_public_bind", false),
            "require_tls": bool_field(&bind, "require_tls", true),
            "require_mtls": bool_field(&bind, "require_mtls", true),
        },
    }))
}

fn parse_hit(input: &Value) -> Value {
    let data = obj(input);
    json!({
        "title": text(&data, "title", ""),
        "url": text(&data, "url", ""),
        "snippet": text(&data, "snippet", ""),
        "score": int_field(&data, "score", 0),
        "provider": text(&data, "provider", ""),
    })
}

fn parse_trace(input: &Value) -> Result<Value, BrowserCoreError> {
    let data = obj(input);
    let error_code = text(&data, "error_code", "");
    if !error_code.is_empty() {
        require_code(&error_code)?;
    }
    let used = bool_field(&data, "used", false);
    let attempted = bool_field(&data, "attempted", false);
    let mut fallback = text(&data, "fallback_reason", "");
    if !used && attempted && fallback.is_empty() && error_code.is_empty() {
        fallback = "unspecified_fallback".to_string();
    }
    Ok(json!({
        "provider": text(&data, "provider", ""),
        "attempted": attempted,
        "used": used,
        "result_count": int_field(&data, "result_count", 0),
        "error_code": error_code,
        "fallback_reason": fallback,
        "started_at": text(&data, "started_at", ""),
        "finished_at": text(&data, "finished_at", ""),
    }))
}

fn parse_snapshot(input: &Value) -> Result<Value, BrowserCoreError> {
    let data = obj(input);
    let digest = text(&data, "sha256", "").to_lowercase();
    if !digest.is_empty() && !sha256_ok(&digest) {
        return Err(err(
            "invalid_request",
            "sha256 must be a 64-character hex digest",
        ));
    }
    Ok(json!({
        "contract_version": text(&data, "contract_version", CONTRACT_VERSION),
        "snapshot_id": text(&data, "snapshot_id", ""),
        "request_id": text(&data, "request_id", ""),
        "session_id": text(&data, "session_id", ""),
        "url": text(&data, "url", ""),
        "final_url": text(&data, "final_url", ""),
        "fetched_at": text(&data, "fetched_at", ""),
        "sha256": digest,
        "content_type": text(&data, "content_type", ""),
        "title": text(&data, "title", ""),
        "markdown": text(&data, "markdown", ""),
        "provenance": provenance(data.get("provenance").unwrap_or(&json!({}))),
        "applied_limits": data.get("applied_limits").cloned().unwrap_or_else(|| json!({})),
    }))
}

fn parse_claim(input: &Value) -> Result<Value, BrowserCoreError> {
    let data = obj(input);
    let status = text(&data, "status", "not_found");
    require_one(&status, &["supported", "derived", "not_found"], "status")?;
    let quote = text(&data, "quote", "");
    let source_url = text(&data, "source_url", "");
    let derived = arr(&data, "derived_from");
    if status == "supported" && (quote.is_empty() || source_url.is_empty()) {
        return Err(err(
            "invalid_request",
            "supported claims require a verbatim quote and source URL",
        ));
    }
    if status == "derived" && derived.len() < 2 {
        return Err(err(
            "invalid_request",
            "derived claims require two or more compatible claim ids",
        ));
    }
    Ok(json!({
        "claim_id": text(&data, "claim_id", ""),
        "statement": text(&data, "statement", ""),
        "status": status,
        "quote": quote,
        "source_snapshot_id": text(&data, "source_snapshot_id", ""),
        "source_url": source_url,
        "derived_from": derived,
    }))
}

pub fn parse_core_model(name: &str, input: &Value) -> Result<Value, BrowserCoreError> {
    match name {
        "BrowserError" => parse_error(input),
        "BrowserPolicy" => parse_policy(input),
        "ProviderTrace" => parse_trace(input),
        "SearchHit" => Ok(parse_hit(input)),
        "PageSnapshot" => parse_snapshot(input),
        "ResearchClaim" => parse_claim(input),
        "BrowserCapabilities" => {
            let data = obj(input);
            let product = text(&data, "product", "core");
            require_one(&product, &["core", "lite", "real"], "product")?;
            let mut out = json!({
                "contract_version": text(&data, "contract_version", CONTRACT_VERSION),
                "product": product,
                "engine": text(&data, "engine", ""),
                "engine_ready": bool_field(&data, "engine_ready", false),
                "search_providers": data.get("search_providers").cloned().unwrap_or_else(|| json!([])),
                "operations": data.get("operations").cloned().unwrap_or_else(|| json!([])),
                "javascript": bool_field(&data, "javascript", false),
                "screenshots": bool_field(&data, "screenshots", false),
                "pdf": bool_field(&data, "pdf", false),
                "downloads": bool_field(&data, "downloads", false),
                "persistent_profile": bool_field(&data, "persistent_profile", false),
                "local_index": bool_field(&data, "local_index", false),
                "probed_at": text(&data, "probed_at", ""),
                "probe_results": data.get("probe_results").cloned().unwrap_or_else(|| json!([])),
            });
            if product != "real" {
                out["javascript"] = json!(false);
                out["screenshots"] = json!(false);
                out["pdf"] = json!(false);
                out["downloads"] = json!(false);
                out["persistent_profile"] = json!(false);
                out["engine_ready"] = json!(false);
                out["engine"] = json!("");
                out["probed_at"] = json!("");
                out["probe_results"] = json!([]);
            }
            if product == "core" {
                out["local_index"] = json!(false);
            }
            if out["engine_ready"].as_bool() == Some(true) && out["probed_at"].as_str() == Some("")
            {
                return Err(err(
                    "invalid_request",
                    "engine_ready requires a completed probe timestamp",
                ));
            }
            Ok(out)
        }
        "SearchRequest" => {
            let data = obj(input);
            let providers = data.get("providers").cloned().unwrap_or_else(|| {
                json!([
                    "google_browser",
                    "project_index",
                    "google_http",
                    "duckduckgo",
                    "wikipedia",
                    "searxng"
                ])
            });
            Ok(json!({
                "contract_version": text(&data, "contract_version", CONTRACT_VERSION),
                "request_id": text(&data, "request_id", ""),
                "session_id": text(&data, "session_id", ""),
                "query": text(&data, "query", ""),
                "max_results": int_field(&data, "max_results", 8),
                "timeout_ms": int_field(&data, "timeout_ms", 20000),
                "strict_provider": bool_field(&data, "strict_provider", false),
                "providers": providers,
                "allow_hosts": data.get("allow_hosts").cloned().unwrap_or_else(|| json!([])),
                "deny_hosts": data.get("deny_hosts").cloned().unwrap_or_else(|| json!([])),
                "issued_at": text(&data, "issued_at", ""),
            }))
        }
        "SearchResult" => {
            let data = obj(input);
            let results: Vec<Value> = arr(&data, "results").iter().map(parse_hit).collect();
            let mut traces = Vec::new();
            for item in arr(&data, "provider_trace") {
                traces.push(parse_trace(&item)?);
            }
            let error_code = text(&data, "error_code", "");
            if !error_code.is_empty() {
                require_code(&error_code)?;
            }
            let strict = bool_field(&data, "strict_provider", false);
            if strict {
                let fallback = traces
                    .iter()
                    .any(|item| !item["fallback_reason"].as_str().unwrap_or("").is_empty());
                let requested = arr(&data, "providers_requested");
                let first = requested.first().and_then(Value::as_str).unwrap_or("");
                let used_other = arr(&data, "providers_used").iter().any(|name| {
                    let value = name.as_str().unwrap_or("");
                    !value.is_empty() && value != first
                });
                if fallback || used_other {
                    return Err(err(
                        "strict_provider_rejected",
                        "strict_provider forbids fallback",
                    ));
                }
            }
            Ok(json!({
                "contract_version": text(&data, "contract_version", CONTRACT_VERSION),
                "request_id": text(&data, "request_id", ""),
                "success": bool_field(&data, "success", false),
                "query": text(&data, "query", ""),
                "keywords": text(&data, "keywords", ""),
                "results": results,
                "count": int_field(&data, "count", results.len() as i64),
                "strict_provider": strict,
                "providers_requested": data.get("providers_requested").cloned().unwrap_or_else(|| json!([])),
                "providers_used": data.get("providers_used").cloned().unwrap_or_else(|| json!([])),
                "provider_trace": traces,
                "errors": data.get("errors").cloned().unwrap_or_else(|| json!([])),
                "error_code": error_code,
                "error": text(&data, "error", ""),
            }))
        }
        "BrowserSessionRequest" => {
            let data = obj(input);
            let product = text(&data, "product", "lite");
            require_one(&product, &["core", "lite", "real"], "product")?;
            let persistent = bool_field(&data, "persistent_profile", false);
            let profile_dir = text(&data, "profile_dir", "");
            let profile_id = text(&data, "profile_id", "");
            if persistent && profile_dir.is_empty() && profile_id.is_empty() {
                return Err(err(
                    "profile_denied",
                    "Persistent profiles require an explicit isolated profile_dir",
                ));
            }
            require_rfc3339(&text(&data, "issued_at", ""), "issued_at")?;
            require_rfc3339(&text(&data, "deadline_at", ""), "deadline_at")?;
            Ok(json!({
                "contract_version": text(&data, "contract_version", CONTRACT_VERSION),
                "request_id": text(&data, "request_id", ""),
                "session_id": text(&data, "session_id", ""),
                "product": product,
                "headless": bool_field(&data, "headless", true),
                "persistent_profile": persistent,
                "profile_dir": profile_dir,
                "issued_at": text(&data, "issued_at", ""),
                "deadline_at": text(&data, "deadline_at", ""),
                "policy": parse_policy(data.get("policy").unwrap_or(&json!({})))?,
            }))
        }
        "BrowserSessionState" => {
            let data = obj(input);
            let status = text(&data, "status", "pending");
            require_one(
                &status,
                &[
                    "pending",
                    "starting",
                    "ready",
                    "running",
                    "paused",
                    "interrupted",
                    "closed",
                ],
                "status",
            )?;
            let product = text(&data, "product", "lite");
            require_one(&product, &["core", "lite", "real"], "product")?;
            Ok(json!({
                "contract_version": text(&data, "contract_version", CONTRACT_VERSION),
                "session_id": text(&data, "session_id", ""),
                "request_id": text(&data, "request_id", ""),
                "status": status,
                "product": product,
                "engine": text(&data, "engine", ""),
                "headless": bool_field(&data, "headless", true),
                "persistent_profile": bool_field(&data, "persistent_profile", false),
                "created_at": text(&data, "created_at", ""),
                "updated_at": text(&data, "updated_at", ""),
                "current_url": text(&data, "current_url", ""),
                "error": parse_error(data.get("error").unwrap_or(&json!({})))?,
            }))
        }
        "BrowserCommand" => {
            let data = obj(input);
            let command_id = text(&data, "command_id", "");
            if command_id.is_empty() {
                return Err(err("invalid_request", "command_id is required"));
            }
            let name_field = text(&data, "name", "");
            require_one(
                &name_field,
                &[
                    "session.start",
                    "session.close",
                    "session.status",
                    "session.pause",
                    "session.resume",
                    "session.retry",
                    "navigate",
                    "back",
                    "forward",
                    "reload",
                    "wait",
                    "snapshot.dom",
                    "snapshot.ax",
                    "locate",
                    "click",
                    "type",
                    "select",
                    "press",
                    "markdown",
                    "screenshot",
                    "pdf",
                    "download",
                    "cancel",
                    "evaluate",
                ],
                "name",
            )?;
            require_rfc3339(&text(&data, "issued_at", ""), "issued_at")?;
            require_rfc3339(&text(&data, "deadline_at", ""), "deadline_at")?;
            Ok(json!({
                "contract_version": text(&data, "contract_version", CONTRACT_VERSION),
                "command_id": command_id,
                "request_id": text(&data, "request_id", ""),
                "session_id": text(&data, "session_id", ""),
                "name": name_field,
                "issued_at": text(&data, "issued_at", ""),
                "deadline_at": text(&data, "deadline_at", ""),
                "idempotency_key": text(&data, "idempotency_key", ""),
                "payload": data.get("payload").cloned().unwrap_or_else(|| json!({})),
            }))
        }
        "BrowserEvent" => {
            let data = obj(input);
            let event_id = text(&data, "event_id", "");
            if event_id.is_empty() {
                return Err(err("invalid_request", "event_id is required"));
            }
            let name_field = text(&data, "name", "");
            require_one(
                &name_field,
                &[
                    "session.started",
                    "session.closed",
                    "session.interrupted",
                    "session.status",
                    "session.paused",
                    "session.resumed",
                    "session.retry",
                    "navigated",
                    "wait.done",
                    "snapshot",
                    "located",
                    "action.done",
                    "network",
                    "console",
                    "page.error",
                    "markdown",
                    "screenshot",
                    "pdf",
                    "download",
                    "cancelled",
                    "error",
                    "research.progress",
                    "capability.updated",
                ],
                "name",
            )?;
            Ok(json!({
                "contract_version": text(&data, "contract_version", CONTRACT_VERSION),
                "event_id": event_id,
                "command_id": text(&data, "command_id", ""),
                "request_id": text(&data, "request_id", ""),
                "session_id": text(&data, "session_id", ""),
                "name": name_field,
                "occurred_at": text(&data, "occurred_at", ""),
                "payload": data.get("payload").cloned().unwrap_or_else(|| json!({})),
            }))
        }
        "DocumentRecord" => {
            let data = obj(input);
            let digest = text(&data, "sha256", "").to_lowercase();
            if !digest.is_empty() && !sha256_ok(&digest) {
                return Err(err(
                    "invalid_request",
                    "sha256 must be a 64-character hex digest",
                ));
            }
            Ok(json!({
                "contract_version": text(&data, "contract_version", CONTRACT_VERSION),
                "document_id": text(&data, "document_id", ""),
                "sha256": digest,
                "url": text(&data, "url", ""),
                "final_url": text(&data, "final_url", ""),
                "title": text(&data, "title", ""),
                "host": text(&data, "host", ""),
                "fetched_at": text(&data, "fetched_at", ""),
                "indexed_at": text(&data, "indexed_at", ""),
                "bytes": int_field(&data, "bytes", 0),
                "content_type": text(&data, "content_type", ""),
                "provenance": provenance(data.get("provenance").unwrap_or(&json!({}))),
            }))
        }
        "ResearchJob" => {
            let data = obj(input);
            Ok(json!({
                "contract_version": text(&data, "contract_version", CONTRACT_VERSION),
                "job_id": text(&data, "job_id", ""),
                "request_id": text(&data, "request_id", ""),
                "session_id": text(&data, "session_id", ""),
                "query": text(&data, "query", ""),
                "status": text(&data, "status", "running"),
                "pack_version": int_field(&data, "pack_version", 2),
                "strict_provider": bool_field(&data, "strict_provider", false),
                "created_at": text(&data, "created_at", ""),
                "updated_at": text(&data, "updated_at", ""),
                "checkpoint_id": text(&data, "checkpoint_id", ""),
                "idempotency_key": text(&data, "idempotency_key", ""),
            }))
        }
        "ResearchProgress" => {
            let data = obj(input);
            let stage = text(&data, "stage", "plan");
            require_one(
                &stage,
                &[
                    "plan",
                    "search",
                    "select",
                    "fetch",
                    "extract",
                    "ground",
                    "recover",
                    "complete",
                    "failed",
                    "cancelled",
                ],
                "stage",
            )?;
            Ok(json!({
                "contract_version": text(&data, "contract_version", CONTRACT_VERSION),
                "job_id": text(&data, "job_id", ""),
                "request_id": text(&data, "request_id", ""),
                "stage": stage,
                "message": text(&data, "message", ""),
                "pages_fetched": int_field(&data, "pages_fetched", 0),
                "pages_target": int_field(&data, "pages_target", 0),
                "occurred_at": text(&data, "occurred_at", ""),
            }))
        }
        "ResearchResult" => {
            let data = obj(input);
            let candidates: Vec<Value> = arr(&data, "candidates").iter().map(parse_hit).collect();
            let mut snapshots = Vec::new();
            for item in arr(&data, "snapshots") {
                snapshots.push(parse_snapshot(&item)?);
            }
            let mut claims = Vec::new();
            for item in arr(&data, "claims") {
                claims.push(parse_claim(&item)?);
            }
            let selected: Vec<String> = arr(&data, "selected_urls")
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect();
            let mut allowed: Vec<String> = selected.clone();
            for snap in &snapshots {
                let url = snap["final_url"].as_str().unwrap_or("");
                let url = if url.is_empty() {
                    snap["url"].as_str().unwrap_or("")
                } else {
                    url
                };
                if !url.is_empty() {
                    allowed.push(url.to_string());
                }
            }
            let mut citations = Vec::new();
            for item in arr(&data, "citations") {
                let row = obj(&item);
                let url = text(&row, "url", "");
                if url.is_empty() {
                    return Err(err("invalid_request", "citations cannot be empty"));
                }
                if !allowed.iter().any(|item| item == &url) {
                    return Err(err(
                        "invalid_request",
                        "citation URL was not fetched or selected",
                    ));
                }
                citations.push(json!({"title": text(&row, "title", ""), "url": url}));
            }
            Ok(json!({
                "contract_version": text(&data, "contract_version", CONTRACT_VERSION),
                "job_id": text(&data, "job_id", ""),
                "request_id": text(&data, "request_id", ""),
                "pack_version": int_field(&data, "pack_version", 2),
                "success": bool_field(&data, "success", false),
                "query": text(&data, "query", ""),
                "queries": data.get("queries").cloned().unwrap_or_else(|| json!([])),
                "candidates": candidates,
                "selected_urls": data.get("selected_urls").cloned().unwrap_or_else(|| json!([])),
                "snapshots": snapshots,
                "claims": claims,
                "contradictions": data.get("contradictions").cloned().unwrap_or_else(|| json!([])),
                "citations": citations,
                "error": parse_error(data.get("error").unwrap_or(&json!({})))?,
            }))
        }
        _ => Err(err(
            "invalid_request",
            &format!("Unknown core model: {name}"),
        )),
    }
}

pub fn reject_public_bind(policy: &Value, host: &str) -> Result<(), BrowserCoreError> {
    let parsed = parse_policy(policy)?;
    let value = host.trim().to_ascii_lowercase();
    let loopback = matches!(value.as_str(), "127.0.0.1" | "localhost" | "::1");
    let bind = obj(&parsed["bind"]);
    if !loopback && !bool_field(&bind, "allow_public_bind", false) {
        return Err(err(
            "public_bind_rejected",
            &format!("Public bind rejected for {host}"),
        ));
    }
    if !loopback
        && bool_field(&bind, "allow_public_bind", false)
        && (!bool_field(&bind, "require_tls", true) || !bool_field(&bind, "require_mtls", true))
    {
        return Err(err(
            "public_bind_rejected",
            "Public bind requires TLS 1.3 and mTLS",
        ));
    }
    Ok(())
}

fn classify_host_kind(host: &str) -> &'static str {
    let host = host.to_ascii_lowercase();
    if host.is_empty() {
        return "invalid";
    }
    if matches!(host.as_str(), "localhost" | "::1" | "0.0.0.0" | "::") || host.starts_with("127.") {
        return "loopback";
    }
    let parts: Vec<&str> = host.split('.').collect();
    if parts.len() == 4 && parts.iter().all(|p| p.parse::<u8>().is_ok()) {
        let a: u8 = parts[0].parse().unwrap();
        let b: u8 = parts[1].parse().unwrap();
        if a == 10 {
            return "private";
        }
        if a == 192 && b == 168 {
            return "private";
        }
        if a == 172 && (16..=31).contains(&b) {
            return "private";
        }
        if a == 169 && b == 254 {
            return "private";
        }
        if a == 100 && (64..=127).contains(&b) {
            return "private";
        }
        if a >= 224 {
            return "private";
        }
        if a == 0 {
            return "loopback";
        }
        return "public";
    }
    if host.contains(':') {
        if let Some(mapped) = host.strip_prefix("::ffff:") {
            if mapped.split('.').count() == 4 && mapped.contains('.') {
                return classify_host_kind(mapped);
            }
            let hex_parts: Vec<&str> = mapped.split(':').collect();
            if hex_parts.len() == 2 {
                if let (Ok(hi), Ok(lo)) = (
                    u16::from_str_radix(hex_parts[0], 16),
                    u16::from_str_radix(hex_parts[1], 16),
                ) {
                    return classify_host_kind(&format!(
                        "{}.{}.{}.{}",
                        (hi >> 8) & 255,
                        hi & 255,
                        (lo >> 8) & 255,
                        lo & 255
                    ));
                }
            }
        }
        if host.starts_with("fc")
            || host.starts_with("fd")
            || host.starts_with("fe80:")
            || host.starts_with("ff")
        {
            return "private";
        }
        return "public";
    }
    "public"
}

fn host_listed(host: &str, patterns: &[Value]) -> bool {
    let value = host.to_ascii_lowercase();
    for item in patterns {
        let mut needle = item.as_str().unwrap_or("").to_ascii_lowercase();
        if let Some(rest) = needle.strip_prefix("*.") {
            needle = rest.to_string();
        }
        if needle.is_empty() {
            continue;
        }
        if value == needle || value.ends_with(&format!(".{needle}")) {
            return true;
        }
    }
    false
}

pub fn classify_network_target(url: &str) -> Value {
    let raw = url.trim();
    if raw.is_empty() {
        return json!({"kind": "invalid", "scheme": "", "host": ""});
    }
    let Some(colon) = raw.find(':') else {
        return json!({"kind": "invalid", "scheme": "", "host": ""});
    };
    let scheme = raw[..colon].to_ascii_lowercase();
    if scheme == "file" {
        return json!({"kind": "filesystem", "scheme": scheme, "host": ""});
    }
    if matches!(scheme.as_str(), "data" | "about" | "blob") {
        return json!({"kind": "local", "scheme": scheme, "host": ""});
    }
    if scheme != "http" && scheme != "https" {
        return json!({"kind": "invalid", "scheme": scheme, "host": ""});
    }
    if raw.len() < colon + 3 || &raw[colon..colon + 3] != "://" {
        return json!({"kind": "invalid", "scheme": scheme, "host": ""});
    }
    let rest = &raw[colon + 3..];
    let hostport = rest.split(['/', '?', '#']).next().unwrap_or("");
    let hostport = match hostport.rfind('@') {
        Some(at) => &hostport[at + 1..],
        None => hostport,
    };
    let host = if hostport.starts_with('[') {
        hostport
            .split(']')
            .next()
            .unwrap_or(hostport)
            .trim_start_matches('[')
            .to_ascii_lowercase()
    } else {
        hostport
            .rsplit_once(':')
            .map(|(h, _)| h)
            .unwrap_or(hostport)
            .to_ascii_lowercase()
    };
    json!({"kind": classify_host_kind(&host), "scheme": scheme, "host": host})
}

pub fn assert_filesystem(policy: &Value, operation: &str) -> Result<(), BrowserCoreError> {
    let parsed = parse_policy(policy)?;
    let fs = obj(&parsed["filesystem"]);
    if operation == "download" {
        if bool_field(&fs, "quarantine_downloads", true) {
            return Ok(());
        }
        if !bool_field(&fs, "allow_write", false) {
            return Err(err(
                "policy_denied",
                "Downloads require write permission when quarantine is disabled",
            ));
        }
        return Ok(());
    }
    if operation == "read" && !bool_field(&fs, "allow_read", false) {
        return Err(err("policy_denied", "Filesystem read is denied"));
    }
    if operation == "write" && !bool_field(&fs, "allow_write", false) {
        return Err(err("policy_denied", "Filesystem write is denied"));
    }
    if operation != "read" && operation != "write" && operation != "download" {
        return Err(err("invalid_request", "Unknown filesystem operation"));
    }
    Ok(())
}

pub fn assert_network_url(policy: &Value, url: &str) -> Result<(), BrowserCoreError> {
    let parsed = parse_policy(policy)?;
    let target = classify_network_target(url);
    let kind = target["kind"].as_str().unwrap_or("invalid");
    if kind == "invalid" {
        return Err(err("invalid_request", "URL is invalid"));
    }
    if kind == "filesystem" {
        return assert_filesystem(&parsed, "read");
    }
    if kind == "local" {
        return Ok(());
    }
    let network = obj(&parsed["network"]);
    let host = target["host"].as_str().unwrap_or("");
    let deny = arr(&network, "deny_hosts");
    if host_listed(host, &deny) {
        return Err(err("policy_denied", &format!("Host denied: {host}")));
    }
    let allow = arr(&network, "allow_hosts");
    if !allow.is_empty() && !host_listed(host, &allow) {
        return Err(err(
            "policy_denied",
            &format!("Host not allowlisted: {host}"),
        ));
    }
    if kind == "loopback" && !bool_field(&network, "allow_loopback", false) {
        return Err(err("policy_denied", "Loopback navigation is denied"));
    }
    if kind == "private" && !bool_field(&network, "allow_private", false) {
        return Err(err("policy_denied", "Private-network navigation is denied"));
    }
    if kind == "public" && !bool_field(&network, "allow_public", true) {
        return Err(err("policy_denied", "Public-network navigation is denied"));
    }
    Ok(())
}

pub mod real_client;
