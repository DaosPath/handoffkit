//! Safe local transports for HK-CSP.

use async_trait::async_trait;
use handoffkit_protocol::{
    negotiate_version, sanitize_error_message, utc_now, DeliveryNack, MessageEnvelope, RetryPolicy,
    SessionConfig, ValidationLimits, DEFAULT_MAX_MESSAGE_BYTES, MIN_MESSAGE_BYTES,
    PROTOCOL_VERSION,
};
use handoffkit_runtime::{RuntimeError, RuntimeResult};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::Path;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

#[cfg(feature = "websocket")]
use futures_util::{stream::SplitSink, stream::SplitStream, SinkExt, StreamExt};
#[cfg(feature = "websocket")]
use tokio_tungstenite::{
    tungstenite::Message as WebSocketMessage, MaybeTlsStream, WebSocketStream,
};

static NEXT_TRANSPORT_ID: AtomicU64 = AtomicU64::new(1);

#[async_trait]
pub trait Transport: Send + Sync {
    async fn send(&self, envelope: &MessageEnvelope) -> RuntimeResult<()>;
    async fn receive(&self) -> RuntimeResult<MessageEnvelope>;
    async fn close(&self) -> RuntimeResult<()>;
    fn description(&self) -> &str;
}

struct FrameReader {
    reader: Box<dyn AsyncRead + Send + Unpin>,
    buffer: Vec<u8>,
    max_message_bytes: usize,
}

impl FrameReader {
    async fn read_frame(&mut self) -> RuntimeResult<Vec<u8>> {
        loop {
            if let Some(position) = self.buffer.iter().position(|byte| *byte == b'\n') {
                let mut frame: Vec<u8> = self.buffer.drain(..=position).collect();
                frame.pop();
                if frame.last() == Some(&b'\r') {
                    frame.pop();
                }
                if frame.is_empty() {
                    continue;
                }
                return Ok(frame);
            }
            if self.buffer.len() >= self.max_message_bytes {
                return Err(RuntimeError::new(
                    "message_too_large",
                    format!("NDJSON frame exceeds {} bytes", self.max_message_bytes),
                ));
            }
            let remaining = self.max_message_bytes - self.buffer.len();
            let mut chunk = vec![0_u8; remaining.clamp(1, 8_192)];
            let read =
                self.reader.read(&mut chunk).await.map_err(|error| {
                    RuntimeError::retryable("transport_read", error.to_string())
                })?;
            if read == 0 {
                if self.buffer.is_empty() {
                    return Err(RuntimeError::new(
                        "transport_closed",
                        "peer closed protocol stream",
                    ));
                }
                return Err(RuntimeError::new(
                    "invalid_ndjson",
                    "protocol stream ended before newline",
                ));
            }
            self.buffer.extend_from_slice(&chunk[..read]);
        }
    }
}

struct FrameWriter {
    writer: Box<dyn AsyncWrite + Send + Unpin>,
}

pub struct NdjsonTransport {
    reader: Mutex<FrameReader>,
    writer: Mutex<FrameWriter>,
    limits: ValidationLimits,
    closed: AtomicBool,
    description: String,
}

impl std::fmt::Debug for NdjsonTransport {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("NdjsonTransport")
            .field("description", &self.description)
            .field("closed", &self.closed.load(Ordering::Acquire))
            .finish()
    }
}

impl NdjsonTransport {
    pub fn new<R, W>(
        reader: R,
        writer: W,
        max_message_bytes: usize,
        description: impl Into<String>,
    ) -> RuntimeResult<Self>
    where
        R: AsyncRead + Send + Unpin + 'static,
        W: AsyncWrite + Send + Unpin + 'static,
    {
        if max_message_bytes == 0 {
            return Err(RuntimeError::new(
                "invalid_limit",
                "max_message_bytes must be at least 1",
            ));
        }
        Ok(Self {
            reader: Mutex::new(FrameReader {
                reader: Box::new(reader),
                buffer: Vec::new(),
                max_message_bytes,
            }),
            writer: Mutex::new(FrameWriter {
                writer: Box::new(writer),
            }),
            limits: ValidationLimits {
                max_message_bytes,
                ..ValidationLimits::default()
            },
            closed: AtomicBool::new(false),
            description: description.into(),
        })
    }
}

pub fn encode_ndjson_frame(
    envelope: &MessageEnvelope,
    limits: ValidationLimits,
) -> RuntimeResult<Vec<u8>> {
    envelope.validate_with_limits(limits)?;
    let mut data = serde_json::to_vec(envelope)?;
    data.push(b'\n');
    if data.len() > limits.max_message_bytes {
        return Err(RuntimeError::new(
            "message_too_large",
            format!(
                "encoded envelope exceeds {} bytes",
                limits.max_message_bytes
            ),
        ));
    }
    Ok(data)
}

pub fn decode_ndjson_frame(
    frame: &[u8],
    limits: ValidationLimits,
) -> RuntimeResult<MessageEnvelope> {
    if frame.len() > limits.max_message_bytes {
        return Err(RuntimeError::new(
            "message_too_large",
            format!("NDJSON frame exceeds {} bytes", limits.max_message_bytes),
        ));
    }
    let mut trimmed = frame;
    if trimmed.last() == Some(&b'\n') {
        trimmed = &trimmed[..trimmed.len() - 1];
    }
    if trimmed.last() == Some(&b'\r') {
        trimmed = &trimmed[..trimmed.len() - 1];
    }
    if trimmed.is_empty() {
        return Err(RuntimeError::new("invalid_ndjson", "NDJSON frame is empty"));
    }
    let envelope: MessageEnvelope = serde_json::from_slice(trimmed).map_err(|error| {
        RuntimeError::new("invalid_ndjson", format!("invalid envelope JSON: {error}"))
    })?;
    envelope.validate_with_limits(limits)?;
    Ok(envelope)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NetworkConfig {
    pub max_message_bytes: usize,
    pub connect_timeout: Duration,
    pub io_timeout: Duration,
}

impl Default for NetworkConfig {
    fn default() -> Self {
        Self {
            max_message_bytes: DEFAULT_MAX_MESSAGE_BYTES,
            connect_timeout: Duration::from_secs(10),
            io_timeout: Duration::from_secs(30),
        }
    }
}

impl NetworkConfig {
    pub fn validate(&self) -> RuntimeResult<()> {
        if self.max_message_bytes < MIN_MESSAGE_BYTES {
            return Err(RuntimeError::new(
                "invalid_limit",
                format!("max_message_bytes must be at least {MIN_MESSAGE_BYTES}"),
            ));
        }
        if self.connect_timeout.is_zero() || self.io_timeout.is_zero() {
            return Err(RuntimeError::new(
                "invalid_timeout",
                "network timeouts must be greater than zero",
            ));
        }
        Ok(())
    }

    fn limits(self) -> ValidationLimits {
        ValidationLimits {
            max_message_bytes: self.max_message_bytes,
            ..ValidationLimits::default()
        }
    }
}

pub fn encode_length_delimited_frame(
    envelope: &MessageEnvelope,
    limits: ValidationLimits,
) -> RuntimeResult<Vec<u8>> {
    envelope.validate_with_limits(limits)?;
    let payload = serde_json::to_vec(envelope)?;
    if payload.len() > limits.max_message_bytes || payload.len() > u32::MAX as usize {
        return Err(RuntimeError::new(
            "message_too_large",
            format!("network frame exceeds {} bytes", limits.max_message_bytes),
        ));
    }
    let mut frame = Vec::with_capacity(4 + payload.len());
    frame.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    frame.extend_from_slice(&payload);
    Ok(frame)
}

pub fn decode_length_delimited_payload(
    payload: &[u8],
    limits: ValidationLimits,
) -> RuntimeResult<MessageEnvelope> {
    if payload.len() > limits.max_message_bytes {
        return Err(RuntimeError::new(
            "message_too_large",
            format!("network frame exceeds {} bytes", limits.max_message_bytes),
        ));
    }
    let envelope: MessageEnvelope = serde_json::from_slice(payload).map_err(|error| {
        RuntimeError::new("invalid_frame", format!("invalid envelope JSON: {error}"))
    })?;
    envelope.validate_with_limits(limits)?;
    Ok(envelope)
}

pub struct LengthDelimitedTransport {
    reader: Mutex<Box<dyn AsyncRead + Send + Unpin>>,
    writer: Mutex<Box<dyn AsyncWrite + Send + Unpin>>,
    config: NetworkConfig,
    closed: AtomicBool,
    description: String,
}

impl std::fmt::Debug for LengthDelimitedTransport {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("LengthDelimitedTransport")
            .field("description", &self.description)
            .field("closed", &self.closed.load(Ordering::Acquire))
            .finish()
    }
}

impl LengthDelimitedTransport {
    pub fn new<R, W>(
        reader: R,
        writer: W,
        config: NetworkConfig,
        description: impl Into<String>,
    ) -> RuntimeResult<Self>
    where
        R: AsyncRead + Send + Unpin + 'static,
        W: AsyncWrite + Send + Unpin + 'static,
    {
        config.validate()?;
        Ok(Self {
            reader: Mutex::new(Box::new(reader)),
            writer: Mutex::new(Box::new(writer)),
            config,
            closed: AtomicBool::new(false),
            description: description.into(),
        })
    }

    async fn read_payload(&self) -> RuntimeResult<Vec<u8>> {
        let mut reader = self.reader.lock().await;
        let mut header = [0_u8; 4];
        tokio::time::timeout(self.config.io_timeout, reader.read_exact(&mut header))
            .await
            .map_err(|_| RuntimeError::retryable("transport_timeout", "network read timed out"))?
            .map_err(|error| {
                RuntimeError::retryable("transport_read", sanitize_error_message(error.to_string()))
            })?;
        let length = u32::from_be_bytes(header) as usize;
        if length == 0 {
            return Err(RuntimeError::new("invalid_frame", "network frame is empty"));
        }
        if length > self.config.max_message_bytes {
            return Err(RuntimeError::new(
                "message_too_large",
                format!(
                    "network frame exceeds {} bytes",
                    self.config.max_message_bytes
                ),
            ));
        }
        let mut payload = vec![0_u8; length];
        tokio::time::timeout(self.config.io_timeout, reader.read_exact(&mut payload))
            .await
            .map_err(|_| RuntimeError::retryable("transport_timeout", "network read timed out"))?
            .map_err(|error| {
                RuntimeError::retryable("transport_read", sanitize_error_message(error.to_string()))
            })?;
        Ok(payload)
    }
}

#[async_trait]
impl Transport for LengthDelimitedTransport {
    async fn send(&self, envelope: &MessageEnvelope) -> RuntimeResult<()> {
        if self.closed.load(Ordering::Acquire) {
            return Err(RuntimeError::new("transport_closed", "transport is closed"));
        }
        let frame = encode_length_delimited_frame(envelope, self.config.limits())?;
        let mut writer = self.writer.lock().await;
        tokio::time::timeout(self.config.io_timeout, writer.write_all(&frame))
            .await
            .map_err(|_| RuntimeError::retryable("transport_timeout", "network write timed out"))?
            .map_err(|error| {
                RuntimeError::retryable(
                    "transport_write",
                    sanitize_error_message(error.to_string()),
                )
            })?;
        tokio::time::timeout(self.config.io_timeout, writer.flush())
            .await
            .map_err(|_| RuntimeError::retryable("transport_timeout", "network flush timed out"))?
            .map_err(|error| {
                RuntimeError::retryable(
                    "transport_flush",
                    sanitize_error_message(error.to_string()),
                )
            })
    }

    async fn receive(&self) -> RuntimeResult<MessageEnvelope> {
        if self.closed.load(Ordering::Acquire) {
            return Err(RuntimeError::new("transport_closed", "transport is closed"));
        }
        let payload = self.read_payload().await?;
        decode_length_delimited_payload(&payload, self.config.limits())
    }

    async fn close(&self) -> RuntimeResult<()> {
        if self.closed.swap(true, Ordering::AcqRel) {
            return Ok(());
        }
        tokio::time::timeout(self.config.io_timeout, self.writer.lock().await.shutdown())
            .await
            .map_err(|_| RuntimeError::new("transport_timeout", "network shutdown timed out"))?
            .map_err(|error| {
                RuntimeError::new(
                    "transport_shutdown",
                    sanitize_error_message(error.to_string()),
                )
            })
    }

    fn description(&self) -> &str {
        &self.description
    }
}

pub struct TcpTransport {
    inner: LengthDelimitedTransport,
}

impl TcpTransport {
    pub async fn connect(address: &str, config: NetworkConfig) -> RuntimeResult<Self> {
        config.validate()?;
        let stream = tokio::time::timeout(config.connect_timeout, TcpStream::connect(address))
            .await
            .map_err(|_| RuntimeError::retryable("connect_timeout", "TCP connect timed out"))?
            .map_err(|error| {
                RuntimeError::retryable("connect_failed", sanitize_error_message(error.to_string()))
            })?;
        Self::from_stream(stream, config)
    }

    pub async fn connect_with_retry(
        address: &str,
        config: NetworkConfig,
        retry: &RetryPolicy,
    ) -> RuntimeResult<Self> {
        retry.validate()?;
        let mut last_error = None;
        for attempt in 1..=retry.max_attempts {
            match Self::connect(address, config).await {
                Ok(transport) => return Ok(transport),
                Err(error) => last_error = Some(error),
            }
            if attempt < retry.max_attempts {
                tokio::time::sleep(Duration::from_millis(retry.delay_ms(attempt))).await;
            }
        }
        Err(last_error.unwrap_or_else(|| {
            RuntimeError::retryable("connect_failed", "TCP connection attempts exhausted")
        }))
    }

    pub fn from_stream(stream: TcpStream, config: NetworkConfig) -> RuntimeResult<Self> {
        stream
            .set_nodelay(true)
            .map_err(|error| RuntimeError::new("socket_config", error.to_string()))?;
        let peer = stream
            .peer_addr()
            .map(|value| value.to_string())
            .unwrap_or_else(|_| "unknown".to_string());
        let (reader, writer) = tokio::io::split(stream);
        Ok(Self {
            inner: LengthDelimitedTransport::new(reader, writer, config, format!("tcp:{peer}"))?,
        })
    }
}

#[async_trait]
impl Transport for TcpTransport {
    async fn send(&self, envelope: &MessageEnvelope) -> RuntimeResult<()> {
        self.inner.send(envelope).await
    }

    async fn receive(&self) -> RuntimeResult<MessageEnvelope> {
        self.inner.receive().await
    }

    async fn close(&self) -> RuntimeResult<()> {
        self.inner.close().await
    }

    fn description(&self) -> &str {
        self.inner.description()
    }
}

#[cfg(unix)]
pub struct UnixTransport {
    inner: LengthDelimitedTransport,
}

#[cfg(unix)]
impl UnixTransport {
    pub async fn connect(path: impl AsRef<Path>, config: NetworkConfig) -> RuntimeResult<Self> {
        use tokio::net::UnixStream;
        config.validate()?;
        let path = path.as_ref();
        let stream = tokio::time::timeout(config.connect_timeout, UnixStream::connect(path))
            .await
            .map_err(|_| {
                RuntimeError::retryable("connect_timeout", "Unix socket connect timed out")
            })?
            .map_err(|error| {
                RuntimeError::retryable("connect_failed", sanitize_error_message(error.to_string()))
            })?;
        let (reader, writer) = tokio::io::split(stream);
        Ok(Self {
            inner: LengthDelimitedTransport::new(
                reader,
                writer,
                config,
                format!("unix:{}", path.display()),
            )?,
        })
    }

    pub fn from_stream(
        stream: tokio::net::UnixStream,
        config: NetworkConfig,
    ) -> RuntimeResult<Self> {
        let (reader, writer) = tokio::io::split(stream);
        Ok(Self {
            inner: LengthDelimitedTransport::new(reader, writer, config, "unix:accepted")?,
        })
    }
}

#[cfg(unix)]
#[async_trait]
impl Transport for UnixTransport {
    async fn send(&self, envelope: &MessageEnvelope) -> RuntimeResult<()> {
        self.inner.send(envelope).await
    }

    async fn receive(&self) -> RuntimeResult<MessageEnvelope> {
        self.inner.receive().await
    }

    async fn close(&self) -> RuntimeResult<()> {
        self.inner.close().await
    }

    fn description(&self) -> &str {
        self.inner.description()
    }
}

#[cfg(feature = "websocket")]
type ClientWebSocket = WebSocketStream<MaybeTlsStream<TcpStream>>;

#[cfg(feature = "websocket")]
pub struct WebSocketTransport {
    writer: Mutex<SplitSink<ClientWebSocket, WebSocketMessage>>,
    reader: Mutex<SplitStream<ClientWebSocket>>,
    config: NetworkConfig,
    closed: AtomicBool,
    description: String,
}

#[cfg(feature = "websocket")]
impl WebSocketTransport {
    pub async fn connect(url: &str, config: NetworkConfig) -> RuntimeResult<Self> {
        config.validate()?;
        let connect = tokio_tungstenite::connect_async(url);
        let (socket, _) = tokio::time::timeout(config.connect_timeout, connect)
            .await
            .map_err(|_| RuntimeError::retryable("connect_timeout", "WebSocket connect timed out"))?
            .map_err(|error| {
                RuntimeError::retryable("connect_failed", sanitize_error_message(error.to_string()))
            })?;
        let (writer, reader) = socket.split();
        Ok(Self {
            writer: Mutex::new(writer),
            reader: Mutex::new(reader),
            config,
            closed: AtomicBool::new(false),
            description: format!("websocket:{url}"),
        })
    }
}

#[cfg(feature = "websocket")]
#[async_trait]
impl Transport for WebSocketTransport {
    async fn send(&self, envelope: &MessageEnvelope) -> RuntimeResult<()> {
        if self.closed.load(Ordering::Acquire) {
            return Err(RuntimeError::new("transport_closed", "transport is closed"));
        }
        envelope.validate_with_limits(self.config.limits())?;
        let payload = serde_json::to_string(envelope)?;
        if payload.len() > self.config.max_message_bytes {
            return Err(RuntimeError::new(
                "message_too_large",
                format!(
                    "WebSocket frame exceeds {} bytes",
                    self.config.max_message_bytes
                ),
            ));
        }
        tokio::time::timeout(
            self.config.io_timeout,
            self.writer
                .lock()
                .await
                .send(WebSocketMessage::Text(payload.into())),
        )
        .await
        .map_err(|_| RuntimeError::retryable("transport_timeout", "WebSocket send timed out"))?
        .map_err(|error| {
            RuntimeError::retryable("transport_write", sanitize_error_message(error.to_string()))
        })
    }

    async fn receive(&self) -> RuntimeResult<MessageEnvelope> {
        if self.closed.load(Ordering::Acquire) {
            return Err(RuntimeError::new("transport_closed", "transport is closed"));
        }
        loop {
            let next =
                tokio::time::timeout(self.config.io_timeout, self.reader.lock().await.next())
                    .await
                    .map_err(|_| {
                        RuntimeError::retryable("transport_timeout", "WebSocket receive timed out")
                    })?;
            match next {
                Some(Ok(WebSocketMessage::Text(payload))) => {
                    return decode_length_delimited_payload(
                        payload.as_bytes(),
                        self.config.limits(),
                    );
                }
                Some(Ok(WebSocketMessage::Binary(payload))) => {
                    return decode_length_delimited_payload(&payload, self.config.limits());
                }
                Some(Ok(WebSocketMessage::Close(_))) | None => {
                    self.closed.store(true, Ordering::Release);
                    return Err(RuntimeError::new(
                        "transport_closed",
                        "WebSocket peer closed connection",
                    ));
                }
                Some(Ok(_)) => continue,
                Some(Err(error)) => {
                    return Err(RuntimeError::retryable(
                        "transport_read",
                        sanitize_error_message(error.to_string()),
                    ));
                }
            }
        }
    }

    async fn close(&self) -> RuntimeResult<()> {
        if self.closed.swap(true, Ordering::AcqRel) {
            return Ok(());
        }
        tokio::time::timeout(
            self.config.io_timeout,
            self.writer.lock().await.send(WebSocketMessage::Close(None)),
        )
        .await
        .map_err(|_| RuntimeError::new("transport_timeout", "WebSocket close timed out"))?
        .map_err(|error| {
            RuntimeError::new(
                "transport_shutdown",
                sanitize_error_message(error.to_string()),
            )
        })
    }

    fn description(&self) -> &str {
        &self.description
    }
}

#[async_trait]
impl Transport for NdjsonTransport {
    async fn send(&self, envelope: &MessageEnvelope) -> RuntimeResult<()> {
        if self.closed.load(Ordering::Acquire) {
            return Err(RuntimeError::new("transport_closed", "transport is closed"));
        }
        let data = encode_ndjson_frame(envelope, self.limits)?;
        let mut writer = self.writer.lock().await;
        writer
            .writer
            .write_all(&data)
            .await
            .map_err(|error| RuntimeError::retryable("transport_write", error.to_string()))?;
        writer
            .writer
            .flush()
            .await
            .map_err(|error| RuntimeError::retryable("transport_flush", error.to_string()))
    }

    async fn receive(&self) -> RuntimeResult<MessageEnvelope> {
        if self.closed.load(Ordering::Acquire) {
            return Err(RuntimeError::new("transport_closed", "transport is closed"));
        }
        let frame = self.reader.lock().await.read_frame().await?;
        decode_ndjson_frame(&frame, self.limits)
    }

    async fn close(&self) -> RuntimeResult<()> {
        if self.closed.swap(true, Ordering::AcqRel) {
            return Ok(());
        }
        self.writer
            .lock()
            .await
            .writer
            .shutdown()
            .await
            .map_err(|error| RuntimeError::new("transport_shutdown", error.to_string()))
    }

    fn description(&self) -> &str {
        &self.description
    }
}

pub struct StdioTransport {
    inner: NdjsonTransport,
}

impl StdioTransport {
    pub fn new(max_message_bytes: usize) -> RuntimeResult<Self> {
        Ok(Self {
            inner: NdjsonTransport::new(
                tokio::io::stdin(),
                tokio::io::stdout(),
                max_message_bytes,
                "stdio",
            )?,
        })
    }

    pub fn with_defaults() -> RuntimeResult<Self> {
        Self::new(DEFAULT_MAX_MESSAGE_BYTES)
    }
}

#[async_trait]
impl Transport for StdioTransport {
    async fn send(&self, envelope: &MessageEnvelope) -> RuntimeResult<()> {
        self.inner.send(envelope).await
    }

    async fn receive(&self) -> RuntimeResult<MessageEnvelope> {
        self.inner.receive().await
    }

    async fn close(&self) -> RuntimeResult<()> {
        self.inner.close().await
    }

    fn description(&self) -> &str {
        self.inner.description()
    }
}

pub struct SubprocessTransport {
    inner: Arc<NdjsonTransport>,
    child: Mutex<Child>,
    shutdown_timeout: Duration,
    description: String,
}

impl std::fmt::Debug for SubprocessTransport {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("SubprocessTransport")
            .field("description", &self.description)
            .finish()
    }
}

impl SubprocessTransport {
    pub async fn spawn(
        program: impl AsRef<Path>,
        args: &[String],
        cwd: Option<&Path>,
        max_message_bytes: usize,
    ) -> RuntimeResult<Self> {
        let program = program.as_ref();
        if program.as_os_str().is_empty() {
            return Err(RuntimeError::new("invalid_command", "program is required"));
        }
        let mut command = Command::new(program);
        command
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .kill_on_drop(true);
        if let Some(cwd) = cwd {
            command.current_dir(cwd);
        }
        let mut child = command.spawn().map_err(|error| {
            RuntimeError::new("subprocess_spawn", format!("cannot start worker: {error}"))
        })?;
        let stdout = child.stdout.take().ok_or_else(|| {
            RuntimeError::new("subprocess_pipe", "worker stdout pipe unavailable")
        })?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| RuntimeError::new("subprocess_pipe", "worker stdin pipe unavailable"))?;
        let description = format!("subprocess:{}", program.display());
        Ok(Self {
            inner: Arc::new(NdjsonTransport::new(
                stdout,
                stdin,
                max_message_bytes,
                description.clone(),
            )?),
            child: Mutex::new(child),
            shutdown_timeout: Duration::from_secs(3),
            description,
        })
    }

    pub fn with_shutdown_timeout(mut self, timeout: Duration) -> Self {
        self.shutdown_timeout = timeout;
        self
    }

    pub async fn id(&self) -> Option<u32> {
        self.child.lock().await.id()
    }

    pub async fn try_status(&self) -> RuntimeResult<Option<std::process::ExitStatus>> {
        self.child
            .lock()
            .await
            .try_wait()
            .map_err(|error| RuntimeError::new("subprocess_status", error.to_string()))
    }
}

#[async_trait]
impl Transport for SubprocessTransport {
    async fn send(&self, envelope: &MessageEnvelope) -> RuntimeResult<()> {
        self.inner.send(envelope).await
    }

    async fn receive(&self) -> RuntimeResult<MessageEnvelope> {
        match self.inner.receive().await {
            Err(error) if error.code == "transport_closed" => {
                if let Some(status) = self.try_status().await? {
                    if !status.success() {
                        return Err(RuntimeError::new(
                            "subprocess_failed",
                            format!("worker exited with {status}"),
                        ));
                    }
                }
                Err(error)
            }
            result => result,
        }
    }

    async fn close(&self) -> RuntimeResult<()> {
        let _ = self.inner.close().await;
        let mut child = self.child.lock().await;
        if child
            .try_wait()
            .map_err(|error| RuntimeError::new("subprocess_status", error.to_string()))?
            .is_some()
        {
            return Ok(());
        }
        if tokio::time::timeout(self.shutdown_timeout, child.wait())
            .await
            .is_err()
        {
            child
                .kill()
                .await
                .map_err(|error| RuntimeError::new("subprocess_kill", error.to_string()))?;
            let _ = child.wait().await;
        }
        Ok(())
    }

    fn description(&self) -> &str {
        &self.description
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HandshakeInfo {
    pub protocol_version: String,
    pub runtime: String,
    pub session_config: SessionConfig,
    #[serde(default)]
    pub capabilities: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HandshakeResult {
    pub protocol_version: String,
    pub session_id: String,
    pub peer_runtime: String,
    #[serde(default)]
    pub capabilities: Vec<String>,
}

pub fn validate_handshake_info(info: &HandshakeInfo) -> RuntimeResult<()> {
    if info.runtime.trim().is_empty() {
        return Err(RuntimeError::new(
            "invalid_runtime",
            "peer runtime name is required",
        ));
    }
    negotiate_version(&info.protocol_version)?;
    info.session_config.validate()?;
    Ok(())
}

pub async fn client_handshake(
    transport: &dyn Transport,
    config: &SessionConfig,
    runtime: &str,
    capabilities: Vec<String>,
) -> RuntimeResult<HandshakeResult> {
    if runtime.trim().is_empty() {
        return Err(RuntimeError::new(
            "invalid_runtime",
            "client runtime name is required",
        ));
    }
    config.validate()?;
    let request = control_envelope(
        &config.session_id,
        "session_open",
        runtime,
        serde_json::to_value(HandshakeInfo {
            protocol_version: PROTOCOL_VERSION.to_string(),
            runtime: runtime.to_string(),
            session_config: config.clone(),
            capabilities,
        })?,
        None,
    );
    transport.send(&request).await?;
    let response = transport.receive().await?;
    if response.session_id != config.session_id
        || response.correlation_id.as_deref() != Some(&request.message_id)
    {
        return Err(RuntimeError::new(
            "handshake_correlation",
            "handshake response does not match request",
        ));
    }
    match response.kind.as_str() {
        "session_ready" => {
            let result: HandshakeResult = serde_json::from_value(response.payload)?;
            negotiate_version(&result.protocol_version)?;
            Ok(result)
        }
        "session_reject" => {
            let message = response
                .payload
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("peer rejected session");
            Err(RuntimeError::new("session_rejected", message))
        }
        _ => Err(RuntimeError::new(
            "invalid_handshake",
            format!("expected session_ready, got '{}'", response.kind),
        )),
    }
}

pub async fn server_handshake(
    transport: &dyn Transport,
    runtime: &str,
    capabilities: Vec<String>,
) -> RuntimeResult<HandshakeInfo> {
    if runtime.trim().is_empty() {
        return Err(RuntimeError::new(
            "invalid_runtime",
            "server runtime name is required",
        ));
    }
    let request = transport.receive().await?;
    if request.kind != "session_open" {
        reject_handshake(
            transport,
            &request,
            runtime,
            "handshake_required",
            "first message must be session_open",
        )
        .await;
        return Err(RuntimeError::new(
            "handshake_required",
            "first message must be session_open",
        ));
    }
    let info: HandshakeInfo = match serde_json::from_value(request.payload.clone()) {
        Ok(info) => info,
        Err(error) => {
            reject_handshake(
                transport,
                &request,
                runtime,
                "invalid_handshake",
                &format!("invalid handshake payload: {error}"),
            )
            .await;
            return Err(RuntimeError::new("invalid_handshake", error.to_string()));
        }
    };
    if info.runtime.trim().is_empty() {
        reject_handshake(
            transport,
            &request,
            runtime,
            "invalid_runtime",
            "peer runtime name is required",
        )
        .await;
        return Err(RuntimeError::new(
            "invalid_runtime",
            "peer runtime name is required",
        ));
    }
    if let Err(error) = negotiate_version(&info.protocol_version) {
        reject_handshake(
            transport,
            &request,
            runtime,
            "version_mismatch",
            &error.to_string(),
        )
        .await;
        return Err(error.into());
    }
    if let Err(error) = info.session_config.validate() {
        reject_handshake(
            transport,
            &request,
            runtime,
            "invalid_session_config",
            &error.to_string(),
        )
        .await;
        return Err(error.into());
    }
    if info.session_config.session_id != request.session_id {
        reject_handshake(
            transport,
            &request,
            runtime,
            "session_mismatch",
            "handshake session IDs differ",
        )
        .await;
        return Err(RuntimeError::new(
            "session_mismatch",
            "handshake session IDs differ",
        ));
    }
    let response = control_envelope(
        &request.session_id,
        "session_ready",
        runtime,
        serde_json::to_value(HandshakeResult {
            protocol_version: PROTOCOL_VERSION.to_string(),
            session_id: request.session_id.clone(),
            peer_runtime: runtime.to_string(),
            capabilities,
        })?,
        Some(request.message_id),
    );
    transport.send(&response).await?;
    Ok(info)
}

async fn reject_handshake(
    transport: &dyn Transport,
    request: &MessageEnvelope,
    runtime: &str,
    code: &str,
    message: &str,
) {
    let response = control_envelope(
        &request.session_id,
        "session_reject",
        runtime,
        json!({"code": code, "message": sanitize_error_message(message)}),
        Some(request.message_id.clone()),
    );
    let _ = transport.send(&response).await;
}

pub fn nack_for(
    envelope: &MessageEnvelope,
    source: &str,
    code: &str,
    message: &str,
    retryable: bool,
) -> RuntimeResult<MessageEnvelope> {
    let nack = DeliveryNack {
        message_id: envelope.message_id.clone(),
        code: code.to_string(),
        message: sanitize_error_message(message),
        retryable,
        processed_at: utc_now(),
        metadata: HashMap::new(),
    };
    let mut response = control_envelope(
        &envelope.session_id,
        "nack",
        source,
        serde_json::to_value(nack)?,
        Some(envelope.message_id.clone()),
    );
    response.payload_type = "delivery_nack".to_string();
    Ok(response)
}

pub fn response_for(
    envelope: &MessageEnvelope,
    source: &str,
    kind: &str,
    payload_type: &str,
    payload: Value,
) -> MessageEnvelope {
    let mut response = control_envelope(
        &envelope.session_id,
        kind,
        source,
        payload,
        Some(envelope.message_id.clone()),
    );
    response.channel = envelope.channel.clone();
    response.target = Some(envelope.source.clone());
    response.payload_type = payload_type.to_string();
    response
}

fn control_envelope(
    session_id: &str,
    kind: &str,
    source: &str,
    payload: Value,
    correlation_id: Option<String>,
) -> MessageEnvelope {
    let id = NEXT_TRANSPORT_ID.fetch_add(1, Ordering::Relaxed);
    let message_id = format!("transport-{}-{id}", std::process::id());
    MessageEnvelope {
        protocol_version: PROTOCOL_VERSION.to_string(),
        message_id: message_id.clone(),
        session_id: session_id.to_string(),
        channel: "control".to_string(),
        kind: kind.to_string(),
        source: source.to_string(),
        target: None,
        sequence: id,
        created_at: utc_now(),
        deadline: None,
        correlation_id,
        causation_id: None,
        idempotency_key: Some(message_id),
        attempt: 1,
        requires_ack: false,
        payload_type: "json".to_string(),
        payload,
        metadata: HashMap::new(),
    }
}
