use handoffkit_protocol::{
    utc_now, MessageEnvelope, RetryPolicy, RuntimeMode, SessionConfig, ValidationLimits,
    DEFAULT_CHANNEL_CAPACITY, DEFAULT_MAX_MESSAGE_BYTES, PROTOCOL_VERSION,
};
use handoffkit_runtime::{RuntimeError, RuntimeResult};
use handoffkit_transport::{
    client_handshake, nack_for, response_for, server_handshake, StdioTransport,
    SubprocessTransport, Transport,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader, Read};
use std::path::Path;
use std::time::Duration;

pub async fn run(args: Vec<String>) -> RuntimeResult<()> {
    match args.as_slice() {
        [group, command, rest @ ..] if group == "csp" => match command.as_str() {
            "doctor" => doctor(),
            "inspect" => inspect(rest),
            "run" => run_worker(rest).await,
            "worker" => worker().await,
            "demo" => demo().await,
            _ => Err(usage_error()),
        },
        [flag] if flag == "--version" || flag == "-V" => {
            println!("handoffkit-rs {}", env!("CARGO_PKG_VERSION"));
            Ok(())
        }
        [flag] if flag == "--help" || flag == "-h" => {
            print_help();
            Ok(())
        }
        _ => Err(usage_error()),
    }
}

fn doctor() -> RuntimeResult<()> {
    println!(
        "{}",
        serde_json::to_string_pretty(&json!({
            "success": true,
            "runtime": "rust",
            "handoffkit_version": env!("CARGO_PKG_VERSION"),
            "protocol_version": PROTOCOL_VERSION,
            "runtime_engine": "tokio",
            "transports": ["in_process", "stdio", "subprocess"],
            "distributed": false,
            "max_message_bytes": DEFAULT_MAX_MESSAGE_BYTES,
            "default_channel_capacity": DEFAULT_CHANNEL_CAPACITY,
        }))?
    );
    Ok(())
}

fn inspect(args: &[String]) -> RuntimeResult<()> {
    let path = args
        .first()
        .ok_or_else(|| RuntimeError::new("missing_path", "csp inspect requires an NDJSON path"))?;
    let file =
        File::open(path).map_err(|error| RuntimeError::new("inspect_read", error.to_string()))?;
    let mut reader = BufReader::new(file);
    let mut kinds: HashMap<String, usize> = HashMap::new();
    let mut session_ids = std::collections::BTreeSet::new();
    let mut count = 0_usize;
    let mut index = 0_usize;
    loop {
        let mut line = Vec::new();
        let bytes_read = reader
            .by_ref()
            .take((DEFAULT_MAX_MESSAGE_BYTES + 2) as u64)
            .read_until(b'\n', &mut line)
            .map_err(|error| RuntimeError::new("inspect_read", error.to_string()))?;
        if bytes_read == 0 {
            break;
        }
        index += 1;
        if line.last() != Some(&b'\n') {
            let code = if line.len() > DEFAULT_MAX_MESSAGE_BYTES {
                "message_too_large"
            } else {
                "invalid_ndjson"
            };
            return Err(RuntimeError::new(
                code,
                format!("line {index} is not a bounded NDJSON frame"),
            ));
        }
        line.pop();
        if line.last() == Some(&b'\r') {
            line.pop();
        }
        if line.is_empty() {
            continue;
        }
        if line.len() > DEFAULT_MAX_MESSAGE_BYTES {
            return Err(RuntimeError::new(
                "message_too_large",
                format!("line {index} exceeds message limit"),
            ));
        }
        let envelope: MessageEnvelope = serde_json::from_slice(&line).map_err(|error| {
            RuntimeError::new(
                "invalid_ndjson",
                format!("line {index} is invalid: {error}"),
            )
        })?;
        envelope.validate()?;
        *kinds.entry(envelope.kind).or_default() += 1;
        session_ids.insert(envelope.session_id);
        count += 1;
    }
    println!(
        "{}",
        serde_json::to_string_pretty(&json!({
            "success": true,
            "path": path,
            "messages": count,
            "sessions": session_ids,
            "kinds": kinds,
        }))?
    );
    Ok(())
}

async fn run_worker(args: &[String]) -> RuntimeResult<()> {
    let program = args
        .first()
        .ok_or_else(|| RuntimeError::new("missing_program", "csp run requires a worker program"))?;
    let transport = SubprocessTransport::spawn(
        Path::new(program),
        &args[1..],
        None,
        DEFAULT_MAX_MESSAGE_BYTES,
    )
    .await?;
    let config = default_session_config("rust-cli-run");
    let result = client_handshake(
        &transport,
        &config,
        "rust-cli",
        vec!["request_response".to_string()],
    )
    .await?;
    let request = request_envelope(&config.session_id, json!({"task": "HK-CSP worker smoke"}));
    transport.send(&request).await?;
    let response = receive_with_session_deadline(&transport, &config).await?;
    validate_response(&request, &response)?;
    println!(
        "{}",
        serde_json::to_string_pretty(&json!({
            "handshake": result,
            "response": response,
        }))?
    );
    close_peer(&transport, &config).await?;
    transport.close().await
}

async fn worker() -> RuntimeResult<()> {
    let transport = StdioTransport::with_defaults()?;
    let handshake = server_handshake(
        &transport,
        "rust-worker",
        vec!["echo".to_string(), "request_response".to_string()],
    )
    .await?;
    loop {
        let envelope = receive_with_session_deadline(&transport, &handshake.session_config).await?;
        envelope.validate_with_limits(ValidationLimits {
            max_message_bytes: handshake.session_config.max_message_bytes,
            ..ValidationLimits::default()
        })?;
        if envelope.session_id != handshake.session_config.session_id {
            let response = nack_for(
                &envelope,
                "rust-worker",
                "session_mismatch",
                "message belongs to another session",
                false,
            )?;
            transport.send(&response).await?;
            continue;
        }
        match envelope.kind.as_str() {
            "data" | "request" | "workflow_start" | "workflow_step" => {
                let response = response_for(
                    &envelope,
                    "rust-worker",
                    "result",
                    &envelope.payload_type,
                    envelope.payload.clone(),
                );
                transport.send(&response).await?;
            }
            "session_close" => {
                let response = response_for(
                    &envelope,
                    "rust-worker",
                    "session_closed",
                    "json",
                    json!({"success": true}),
                );
                transport.send(&response).await?;
                break;
            }
            "cancel" => {
                let response = response_for(
                    &envelope,
                    "rust-worker",
                    "cancelled",
                    "json",
                    json!({"success": true}),
                );
                transport.send(&response).await?;
                break;
            }
            _ => {
                let response = nack_for(
                    &envelope,
                    "rust-worker",
                    "unknown_message_kind",
                    "worker does not support this message kind",
                    false,
                )?;
                transport.send(&response).await?;
            }
        }
    }
    transport.close().await
}

async fn demo() -> RuntimeResult<()> {
    let executable = std::env::current_exe()
        .map_err(|error| RuntimeError::new("current_exe", error.to_string()))?;
    let args = vec!["csp".to_string(), "worker".to_string()];
    let transport =
        SubprocessTransport::spawn(executable, &args, None, DEFAULT_MAX_MESSAGE_BYTES).await?;
    let config = default_session_config("rust-demo");
    let handshake = client_handshake(
        &transport,
        &config,
        "rust-demo",
        vec!["request_response".to_string()],
    )
    .await?;
    let request = request_envelope(
        &config.session_id,
        json!({"task": "Architect -> Coder -> Reviewer -> Tester"}),
    );
    transport.send(&request).await?;
    let response = receive_with_session_deadline(&transport, &config).await?;
    validate_response(&request, &response)?;
    println!(
        "{}",
        serde_json::to_string_pretty(&json!({
            "success": response.kind == "result",
            "handshake": handshake,
            "response_kind": response.kind,
            "payload": response.payload,
        }))?
    );
    close_peer(&transport, &config).await?;
    transport.close().await
}

async fn close_peer(transport: &dyn Transport, config: &SessionConfig) -> RuntimeResult<()> {
    let request = MessageEnvelope {
        protocol_version: PROTOCOL_VERSION.to_string(),
        message_id: "close-request".to_string(),
        session_id: config.session_id.clone(),
        channel: "control".to_string(),
        kind: "session_close".to_string(),
        source: "rust-cli".to_string(),
        target: None,
        sequence: 2,
        created_at: utc_now(),
        deadline: None,
        correlation_id: None,
        causation_id: None,
        idempotency_key: Some("close-request".to_string()),
        attempt: 1,
        requires_ack: false,
        payload_type: "json".to_string(),
        payload: json!({}),
        metadata: HashMap::new(),
    };
    transport.send(&request).await?;
    let response = receive_with_session_deadline(transport, config).await?;
    validate_response(&request, &response)?;
    if response.kind != "session_closed" {
        return Err(RuntimeError::new(
            "shutdown_protocol",
            format!("expected session_closed, got '{}'", response.kind),
        ));
    }
    Ok(())
}

fn validate_response(request: &MessageEnvelope, response: &MessageEnvelope) -> RuntimeResult<()> {
    if response.session_id != request.session_id
        || response.correlation_id.as_deref() != Some(&request.message_id)
    {
        return Err(RuntimeError::new(
            "response_correlation",
            "worker response does not match request",
        ));
    }
    Ok(())
}

async fn receive_with_session_deadline(
    transport: &dyn Transport,
    config: &SessionConfig,
) -> RuntimeResult<MessageEnvelope> {
    let Some(deadline) = &config.deadline else {
        return transport.receive().await;
    };
    let deadline = chrono::DateTime::parse_from_rfc3339(deadline)
        .map_err(|_| RuntimeError::new("invalid_deadline", "deadline is not RFC 3339"))?;
    let remaining = deadline
        .with_timezone(&chrono::Utc)
        .signed_duration_since(chrono::Utc::now());
    if remaining <= chrono::Duration::zero() {
        return Err(RuntimeError::deadline());
    }
    let timeout = remaining
        .to_std()
        .unwrap_or_else(|_| Duration::from_millis(1));
    tokio::time::timeout(timeout, transport.receive())
        .await
        .map_err(|_| RuntimeError::deadline())?
}

fn request_envelope(session_id: &str, payload: Value) -> MessageEnvelope {
    MessageEnvelope {
        protocol_version: PROTOCOL_VERSION.to_string(),
        message_id: "request-1".to_string(),
        session_id: session_id.to_string(),
        channel: "requests".to_string(),
        kind: "request".to_string(),
        source: "rust-cli".to_string(),
        target: Some("worker".to_string()),
        sequence: 1,
        created_at: utc_now(),
        deadline: None,
        correlation_id: None,
        causation_id: None,
        idempotency_key: Some("request-1".to_string()),
        attempt: 1,
        requires_ack: false,
        payload_type: "json".to_string(),
        payload,
        metadata: HashMap::new(),
    }
}

fn default_session_config(session_id: &str) -> SessionConfig {
    SessionConfig {
        session_id: session_id.to_string(),
        runtime_mode: RuntimeMode::Session,
        channel_capacity: DEFAULT_CHANNEL_CAPACITY,
        max_message_bytes: DEFAULT_MAX_MESSAGE_BYTES,
        ack_timeout_ms: 5_000,
        dedup_capacity: 4_096,
        retry_policy: RetryPolicy::default(),
        deadline: Some(
            (chrono::Utc::now() + chrono::Duration::seconds(30))
                .to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        ),
        metadata: HashMap::new(),
    }
}

fn usage_error() -> RuntimeError {
    RuntimeError::new(
        "usage",
        "usage: handoffkit-rs csp <doctor|inspect|run|worker|demo>",
    )
}

fn print_help() {
    println!("HandoffKit Rust {}", env!("CARGO_PKG_VERSION"));
    println!("  handoffkit-rs csp doctor");
    println!("  handoffkit-rs csp inspect <file.ndjson>");
    println!("  handoffkit-rs csp run <worker-program> [args...]");
    println!("  handoffkit-rs csp worker");
    println!("  handoffkit-rs csp demo");
}
