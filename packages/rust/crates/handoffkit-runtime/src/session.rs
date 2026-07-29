use crate::{
    select, CspChannel, DedupStore, RuntimeError, RuntimeResult, DEFAULT_MAX_PENDING_ACKS,
    DEFAULT_MAX_PROCESSES,
};
use handoffkit_protocol::{
    utc_now, ChannelConfig, DeliveryAck, DeliveryNack, JobProgress, MessageEnvelope,
    OverflowPolicy, SessionConfig, ValidationLimits,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet, VecDeque};
use std::future::Future;
use std::sync::atomic::{AtomicU64, AtomicU8, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;
use tokio::sync::{broadcast, oneshot, Mutex, Notify, RwLock};
use tokio::task::JoinHandle;
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;

static NEXT_RUNTIME_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionState {
    Created,
    Running,
    Closing,
    Closed,
    Cancelled,
    Failed,
}

impl SessionState {
    fn as_u8(self) -> u8 {
        self as u8
    }

    fn from_u8(value: u8) -> Self {
        match value {
            0 => Self::Created,
            1 => Self::Running,
            2 => Self::Closing,
            3 => Self::Closed,
            4 => Self::Cancelled,
            _ => Self::Failed,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RuntimeEvent {
    pub kind: String,
    pub session_id: String,
    #[serde(default)]
    pub process_id: String,
    #[serde(default)]
    pub message_id: String,
    #[serde(default)]
    pub message: String,
    pub timestamp: String,
    #[serde(default)]
    pub metadata: HashMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SessionDiagnostics {
    pub session_id: String,
    pub state: SessionState,
    pub channel_count: usize,
    pub queued_messages: usize,
    pub process_count: usize,
    pub pending_ack_count: usize,
    pub dedup_count: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub enum DeliveryReceipt {
    Ack(DeliveryAck),
    Nack(DeliveryNack),
}

type AckResult = Result<DeliveryAck, DeliveryNack>;

#[derive(Default)]
struct DedupCache {
    keys: HashSet<String>,
    order: VecDeque<String>,
}

impl DedupCache {
    fn insert(&mut self, key: String, capacity: usize) -> bool {
        if self.keys.contains(&key) {
            return false;
        }
        self.keys.insert(key.clone());
        self.order.push_back(key);
        while self.order.len() > capacity {
            if let Some(expired) = self.order.pop_front() {
                self.keys.remove(&expired);
            }
        }
        true
    }

    fn remove(&mut self, key: &str) -> bool {
        if !self.keys.remove(key) {
            return false;
        }
        self.order.retain(|item| item != key);
        true
    }

    fn len(&self) -> usize {
        self.keys.len()
    }
}

struct SessionInner {
    config: SessionConfig,
    state: AtomicU8,
    channels: RwLock<HashMap<String, CspChannel>>,
    cancellation: CancellationToken,
    channel_notify: Arc<Notify>,
    dedup: Mutex<DedupCache>,
    persistent_dedup: Option<Arc<dyn DedupStore>>,
    delivery_keys: Mutex<HashMap<String, String>>,
    pending_acks: Mutex<HashMap<String, oneshot::Sender<AckResult>>>,
    events: broadcast::Sender<RuntimeEvent>,
    process_tokens: StdMutex<HashMap<String, CancellationToken>>,
    process_count: AtomicUsize,
    process_notify: Notify,
    sequence: AtomicU64,
    deadline: Option<Instant>,
}

struct ProcessCountGuard {
    inner: Arc<SessionInner>,
    process_id: String,
}

impl Drop for ProcessCountGuard {
    fn drop(&mut self) {
        self.inner
            .process_tokens
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(&self.process_id);
        self.inner.process_count.fetch_sub(1, Ordering::AcqRel);
        self.inner.process_notify.notify_waiters();
    }
}

#[derive(Clone)]
pub struct CspSession {
    inner: Arc<SessionInner>,
}

impl std::fmt::Debug for CspSession {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("CspSession")
            .field("session_id", &self.inner.config.session_id)
            .field("state", &self.state())
            .finish()
    }
}

impl CspSession {
    pub fn new(config: SessionConfig) -> RuntimeResult<Self> {
        Self::new_with_optional_dedup(config, None)
    }

    pub fn with_dedup_store(
        config: SessionConfig,
        store: Arc<dyn DedupStore>,
    ) -> RuntimeResult<Self> {
        Self::new_with_optional_dedup(config, Some(store))
    }

    fn new_with_optional_dedup(
        config: SessionConfig,
        persistent_dedup: Option<Arc<dyn DedupStore>>,
    ) -> RuntimeResult<Self> {
        config.validate()?;
        let deadline = config.deadline.as_deref().and_then(deadline_instant);
        let (events, _) = broadcast::channel(256);
        let session = Self {
            inner: Arc::new(SessionInner {
                config,
                state: AtomicU8::new(SessionState::Created.as_u8()),
                channels: RwLock::new(HashMap::new()),
                cancellation: CancellationToken::new(),
                channel_notify: Arc::new(Notify::new()),
                dedup: Mutex::new(DedupCache::default()),
                persistent_dedup,
                delivery_keys: Mutex::new(HashMap::new()),
                pending_acks: Mutex::new(HashMap::new()),
                events,
                process_tokens: StdMutex::new(HashMap::new()),
                process_count: AtomicUsize::new(0),
                process_notify: Notify::new(),
                sequence: AtomicU64::new(1),
                deadline,
            }),
        };
        session
            .inner
            .state
            .store(SessionState::Running.as_u8(), Ordering::Release);
        session.emit("session_started", "", "", "session started");
        Ok(session)
    }

    pub fn id(&self) -> &str {
        &self.inner.config.session_id
    }

    pub fn config(&self) -> &SessionConfig {
        &self.inner.config
    }

    pub fn state(&self) -> SessionState {
        SessionState::from_u8(self.inner.state.load(Ordering::Acquire))
    }

    pub fn cancellation_token(&self) -> CancellationToken {
        self.inner.cancellation.clone()
    }

    pub fn subscribe(&self) -> broadcast::Receiver<RuntimeEvent> {
        self.inner.events.subscribe()
    }

    pub async fn diagnostics(&self) -> SessionDiagnostics {
        let channels = self.inner.channels.read().await;
        SessionDiagnostics {
            session_id: self.id().to_string(),
            state: self.state(),
            channel_count: channels.len(),
            queued_messages: channels.values().map(CspChannel::len).sum(),
            process_count: self.inner.process_count.load(Ordering::Acquire),
            pending_ack_count: self.inner.pending_acks.lock().await.len(),
            dedup_count: self.inner.dedup.lock().await.len(),
        }
    }

    pub async fn open_channel(&self, config: ChannelConfig) -> RuntimeResult<CspChannel> {
        self.ensure_running()?;
        config.validate()?;
        let mut channels = self.inner.channels.write().await;
        if channels.contains_key(&config.name) {
            return Err(RuntimeError::new(
                "channel_exists",
                format!("channel '{}' already exists", config.name),
            ));
        }
        let channel = CspChannel::new(
            config.clone(),
            self.inner.cancellation.clone(),
            Arc::clone(&self.inner.channel_notify),
            self.inner.deadline,
            ValidationLimits {
                max_message_bytes: self.inner.config.max_message_bytes,
                ..ValidationLimits::default()
            },
        )?;
        channels.insert(config.name.clone(), channel.clone());
        drop(channels);
        self.emit("channel_opened", "", "", &config.name);
        Ok(channel)
    }

    pub async fn open_default_channel(&self, name: impl Into<String>) -> RuntimeResult<CspChannel> {
        self.open_channel(ChannelConfig {
            name: name.into(),
            capacity: self.inner.config.channel_capacity,
            overflow_policy: OverflowPolicy::Block,
            requires_ack: false,
            metadata: HashMap::new(),
        })
        .await
    }

    pub async fn channel(&self, name: &str) -> RuntimeResult<CspChannel> {
        self.inner
            .channels
            .read()
            .await
            .get(name)
            .cloned()
            .ok_or_else(|| {
                RuntimeError::new("channel_not_found", format!("unknown channel '{name}'"))
            })
    }

    pub async fn send(&self, channel: &str, mut envelope: MessageEnvelope) -> RuntimeResult<()> {
        self.ensure_running()?;
        if let Some(session_deadline) = &self.inner.config.deadline {
            let should_inherit = envelope.deadline.as_ref().is_none_or(|envelope_deadline| {
                let session = chrono::DateTime::parse_from_rfc3339(session_deadline);
                let envelope = chrono::DateTime::parse_from_rfc3339(envelope_deadline);
                matches!((session, envelope), (Ok(session), Ok(envelope)) if session < envelope)
            });
            if should_inherit {
                envelope.deadline = Some(session_deadline.clone());
            }
        }
        self.validate_session_envelope(&envelope)?;
        self.channel(channel).await?.send(envelope).await
    }

    pub async fn receive(&self, channel: &str) -> RuntimeResult<Option<MessageEnvelope>> {
        self.ensure_active()?;
        let channel = self.channel(channel).await?;
        loop {
            let Some(envelope) = channel.receive().await? else {
                return Ok(None);
            };
            self.validate_session_envelope(&envelope)?;
            let Some(key) = envelope
                .idempotency_key
                .clone()
                .or_else(|| Some(envelope.message_id.clone()))
            else {
                return Ok(Some(envelope));
            };
            let mut is_new = self
                .inner
                .dedup
                .lock()
                .await
                .insert(key.clone(), self.inner.config.dedup_capacity);
            if is_new {
                if let Some(store) = &self.inner.persistent_dedup {
                    is_new = store.claim(&key)?;
                }
            }
            if is_new {
                self.inner
                    .delivery_keys
                    .lock()
                    .await
                    .insert(envelope.message_id.clone(), key);
                return Ok(Some(envelope));
            }
            self.emit(
                "message_deduplicated",
                "",
                &envelope.message_id,
                "duplicate delivery suppressed",
            );
            if envelope.requires_ack {
                self.ack(DeliveryAck {
                    message_id: envelope.message_id,
                    processed_at: utc_now(),
                    metadata: HashMap::new(),
                })
                .await;
            }
        }
    }

    pub async fn select(&self, names: &[&str]) -> RuntimeResult<(String, MessageEnvelope)> {
        let mut channels = Vec::with_capacity(names.len());
        for name in names {
            channels.push(self.channel(name).await?);
        }
        let (index, envelope) = select(&channels).await?;
        Ok((names[index].to_string(), envelope))
    }

    pub async fn send_with_ack(
        &self,
        channel: &str,
        mut envelope: MessageEnvelope,
    ) -> RuntimeResult<DeliveryReceipt> {
        envelope.requires_ack = true;
        let policy = &self.inner.config.retry_policy;
        let max_attempts = policy.max_attempts;
        for attempt in 1..=max_attempts {
            envelope.attempt = attempt;
            let (sender, receiver) = oneshot::channel();
            let mut pending = self.inner.pending_acks.lock().await;
            if pending.contains_key(&envelope.message_id) {
                return Err(RuntimeError::new(
                    "duplicate_pending_ack",
                    "message already has a pending acknowledgement",
                ));
            }
            if pending.len() >= DEFAULT_MAX_PENDING_ACKS {
                return Err(RuntimeError::retryable(
                    "pending_ack_limit",
                    "pending acknowledgement limit reached",
                ));
            }
            pending.insert(envelope.message_id.clone(), sender);
            drop(pending);
            if let Err(error) = self.send(channel, envelope.clone()).await {
                self.inner
                    .pending_acks
                    .lock()
                    .await
                    .remove(&envelope.message_id);
                if !error.retryable || attempt == max_attempts {
                    return Err(error);
                }
            } else {
                let timeout = Duration::from_millis(self.inner.config.ack_timeout_ms);
                let wait = tokio::time::timeout(timeout, receiver);
                let outcome_result = if let Some(deadline) = self.inner.deadline {
                    tokio::select! {
                        _ = self.inner.cancellation.cancelled() => Err(RuntimeError::cancelled()),
                        result = tokio::time::timeout_at(deadline, wait) => result.map_err(|_| RuntimeError::deadline()),
                    }
                } else {
                    tokio::select! {
                        _ = self.inner.cancellation.cancelled() => Err(RuntimeError::cancelled()),
                        result = wait => Ok(result),
                    }
                };
                let outcome = match outcome_result {
                    Ok(outcome) => outcome,
                    Err(error) => {
                        self.inner
                            .pending_acks
                            .lock()
                            .await
                            .remove(&envelope.message_id);
                        return Err(error);
                    }
                };
                match outcome {
                    Ok(Ok(Ok(ack))) => return Ok(DeliveryReceipt::Ack(ack)),
                    Ok(Ok(Err(nack))) if !nack.retryable || attempt == max_attempts => {
                        return Ok(DeliveryReceipt::Nack(nack));
                    }
                    Ok(Ok(Err(_))) | Err(_) if attempt < max_attempts => {}
                    Ok(Ok(Err(nack))) => return Ok(DeliveryReceipt::Nack(nack)),
                    Ok(Err(_)) | Err(_) => {
                        self.inner
                            .pending_acks
                            .lock()
                            .await
                            .remove(&envelope.message_id);
                        return Err(RuntimeError::retryable(
                            "ack_timeout",
                            "delivery acknowledgement timed out",
                        ));
                    }
                }
            }
            self.inner
                .pending_acks
                .lock()
                .await
                .remove(&envelope.message_id);
            tokio::select! {
                _ = self.inner.cancellation.cancelled() => return Err(RuntimeError::cancelled()),
                _ = tokio::time::sleep(Duration::from_millis(policy.delay_ms(attempt))) => {}
            }
        }
        Err(RuntimeError::retryable(
            "delivery_failed",
            "delivery exhausted retry attempts",
        ))
    }

    pub async fn ack(&self, ack: DeliveryAck) -> bool {
        self.inner
            .delivery_keys
            .lock()
            .await
            .remove(&ack.message_id);
        let sender = self.inner.pending_acks.lock().await.remove(&ack.message_id);
        let resolved = sender.is_some();
        if let Some(sender) = sender {
            let _ = sender.send(Ok(ack.clone()));
        }
        self.emit(
            "message_acked",
            "",
            &ack.message_id,
            "delivery acknowledged",
        );
        resolved
    }

    pub async fn nack(&self, nack: DeliveryNack) -> bool {
        let delivery_key = self
            .inner
            .delivery_keys
            .lock()
            .await
            .remove(&nack.message_id);
        if nack.retryable {
            if let Some(key) = delivery_key {
                self.inner.dedup.lock().await.remove(&key);
                if let Some(store) = &self.inner.persistent_dedup {
                    if let Err(error) = store.release(&key) {
                        self.emit("dedup_store_error", "", &nack.message_id, &error.message);
                    }
                }
            }
        }
        let sender = self
            .inner
            .pending_acks
            .lock()
            .await
            .remove(&nack.message_id);
        let resolved = sender.is_some();
        if let Some(sender) = sender {
            let _ = sender.send(Err(nack.clone()));
        }
        self.emit("message_nacked", "", &nack.message_id, &nack.message);
        resolved
    }

    pub fn envelope(
        &self,
        channel: impl Into<String>,
        kind: impl Into<String>,
        source: impl Into<String>,
        payload_type: impl Into<String>,
        payload: Value,
    ) -> MessageEnvelope {
        let sequence = self.inner.sequence.fetch_add(1, Ordering::Relaxed);
        let message_id = next_id("msg");
        MessageEnvelope {
            protocol_version: handoffkit_protocol::PROTOCOL_VERSION.to_string(),
            message_id: message_id.clone(),
            session_id: self.id().to_string(),
            channel: channel.into(),
            kind: kind.into(),
            source: source.into(),
            target: None,
            sequence,
            created_at: utc_now(),
            deadline: self.inner.config.deadline.clone(),
            correlation_id: None,
            causation_id: None,
            idempotency_key: Some(message_id),
            attempt: 1,
            requires_ack: false,
            payload_type: payload_type.into(),
            payload,
            metadata: HashMap::new(),
        }
    }

    pub fn spawn<F, Fut>(&self, name: impl Into<String>, process: F) -> RuntimeResult<ProcessHandle>
    where
        F: FnOnce(ProcessContext) -> Fut + Send + 'static,
        Fut: Future<Output = RuntimeResult<()>> + Send + 'static,
    {
        self.ensure_running()?;
        let name = name.into();
        let process_id = next_id(&name);
        let token = self.inner.cancellation.child_token();
        let context = ProcessContext {
            process_id: process_id.clone(),
            session: self.clone(),
            cancellation: token.clone(),
        };
        self.inner
            .process_count
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |count| {
                (count < DEFAULT_MAX_PROCESSES).then_some(count + 1)
            })
            .map_err(|_| {
                RuntimeError::retryable("process_limit", "session process limit reached")
            })?;
        self.inner
            .process_tokens
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(process_id.clone(), token.clone());
        let runtime_handle = tokio::runtime::Handle::try_current().map_err(|_| {
            self.inner
                .process_tokens
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .remove(&process_id);
            self.inner.process_count.fetch_sub(1, Ordering::AcqRel);
            RuntimeError::new("runtime_unavailable", "Tokio runtime is not available")
        })?;
        let session = self.clone();
        let process_id_for_task = process_id.clone();
        let token_for_task = token.clone();
        let count_guard = ProcessCountGuard {
            inner: Arc::clone(&session.inner),
            process_id: process_id_for_task.clone(),
        };
        let join = runtime_handle.spawn(async move {
            let _count_guard = count_guard;
            session.emit(
                "process_started",
                &process_id_for_task,
                "",
                "process started",
            );
            let result = if let Some(deadline) = session.inner.deadline {
                tokio::select! {
                    _ = token_for_task.cancelled() => Err(RuntimeError::cancelled()),
                    _ = tokio::time::sleep_until(deadline) => {
                        session.cancel();
                        Err(RuntimeError::deadline())
                    }
                    result = process(context) => result,
                }
            } else {
                tokio::select! {
                    _ = token_for_task.cancelled() => Err(RuntimeError::cancelled()),
                    result = process(context) => result,
                }
            };
            match &result {
                Ok(()) => session.emit(
                    "process_completed",
                    &process_id_for_task,
                    "",
                    "process completed",
                ),
                Err(error) => {
                    session.emit("process_failed", &process_id_for_task, "", &error.message)
                }
            }
            result
        });
        Ok(ProcessHandle {
            process_id,
            cancellation: token,
            join: Some(join),
        })
    }

    pub async fn cancel_process(&self, process_id: &str) -> bool {
        let token = self
            .inner
            .process_tokens
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get(process_id)
            .cloned();
        if let Some(token) = token {
            token.cancel();
            true
        } else {
            false
        }
    }

    pub fn cancel(&self) {
        if matches!(
            self.state(),
            SessionState::Closing | SessionState::Closed | SessionState::Cancelled
        ) {
            return;
        }
        self.inner
            .state
            .store(SessionState::Cancelled.as_u8(), Ordering::Release);
        self.inner.cancellation.cancel();
        self.inner.channel_notify.notify_waiters();
        self.emit("session_cancelled", "", "", "session cancelled");
    }

    pub async fn close(&self) -> RuntimeResult<()> {
        let state = self.state();
        if state == SessionState::Closed {
            return Ok(());
        }
        self.inner
            .state
            .store(SessionState::Closing.as_u8(), Ordering::Release);
        self.inner.cancellation.cancel();
        let channels: Vec<CspChannel> =
            self.inner.channels.read().await.values().cloned().collect();
        for channel in channels {
            channel.close().await;
        }
        let wait = async {
            while self.inner.process_count.load(Ordering::Acquire) > 0 {
                self.inner.process_notify.notified().await;
            }
        };
        tokio::time::timeout(Duration::from_secs(5), wait)
            .await
            .map_err(|_| RuntimeError::new("shutdown_timeout", "processes did not stop in time"))?;
        self.inner.pending_acks.lock().await.clear();
        self.inner.delivery_keys.lock().await.clear();
        self.inner
            .state
            .store(SessionState::Closed.as_u8(), Ordering::Release);
        self.emit("session_closed", "", "", "session closed");
        Ok(())
    }

    fn ensure_running(&self) -> RuntimeResult<()> {
        match self.state() {
            SessionState::Running => {
                if self.deadline_expired() {
                    self.cancel();
                    Err(RuntimeError::deadline())
                } else {
                    Ok(())
                }
            }
            SessionState::Cancelled => Err(RuntimeError::cancelled()),
            state => Err(RuntimeError::new(
                "session_not_running",
                format!("session state is {state:?}"),
            )),
        }
    }

    fn ensure_active(&self) -> RuntimeResult<()> {
        match self.state() {
            SessionState::Running | SessionState::Closing => Ok(()),
            SessionState::Cancelled => Err(RuntimeError::cancelled()),
            state => Err(RuntimeError::new(
                "session_inactive",
                format!("session state is {state:?}"),
            )),
        }
    }

    fn validate_session_envelope(&self, envelope: &MessageEnvelope) -> RuntimeResult<()> {
        if envelope.session_id != self.id() {
            return Err(RuntimeError::new(
                "session_mismatch",
                "envelope belongs to a different session",
            ));
        }
        envelope.validate_with_limits(ValidationLimits {
            max_message_bytes: self.inner.config.max_message_bytes,
            ..ValidationLimits::default()
        })?;
        if envelope.deadline.as_deref().is_some_and(timestamp_expired) {
            return Err(RuntimeError::deadline());
        }
        Ok(())
    }

    fn deadline_expired(&self) -> bool {
        self.inner
            .deadline
            .is_some_and(|deadline| Instant::now() >= deadline)
    }

    fn emit(&self, kind: &str, process_id: &str, message_id: &str, message: &str) {
        let _ = self.inner.events.send(RuntimeEvent {
            kind: kind.to_string(),
            session_id: self.id().to_string(),
            process_id: process_id.to_string(),
            message_id: message_id.to_string(),
            message: message.to_string(),
            timestamp: utc_now(),
            metadata: HashMap::new(),
        });
    }
}

pub struct ProcessHandle {
    process_id: String,
    cancellation: CancellationToken,
    join: Option<JoinHandle<RuntimeResult<()>>>,
}

impl ProcessHandle {
    pub fn id(&self) -> &str {
        &self.process_id
    }

    pub fn cancel(&self) {
        self.cancellation.cancel();
    }

    pub async fn wait(mut self) -> RuntimeResult<()> {
        let Some(join) = self.join.take() else {
            return Ok(());
        };
        join.await.map_err(|error| {
            RuntimeError::new(
                "process_join_error",
                format!("process task failed: {error}"),
            )
        })?
    }
}

impl Drop for ProcessHandle {
    fn drop(&mut self) {
        if self.join.is_some() {
            self.cancellation.cancel();
        }
    }
}

#[derive(Clone)]
pub struct ProcessContext {
    process_id: String,
    session: CspSession,
    cancellation: CancellationToken,
}

impl ProcessContext {
    pub fn process_id(&self) -> &str {
        &self.process_id
    }

    pub fn session(&self) -> &CspSession {
        &self.session
    }

    pub fn cancellation_token(&self) -> CancellationToken {
        self.cancellation.clone()
    }

    pub async fn cancelled(&self) {
        self.cancellation.cancelled().await;
    }

    pub async fn send(&self, channel: &str, envelope: MessageEnvelope) -> RuntimeResult<()> {
        tokio::select! {
            _ = self.cancellation.cancelled() => Err(RuntimeError::cancelled()),
            result = self.session.send(channel, envelope) => result,
        }
    }

    pub async fn receive(&self, channel: &str) -> RuntimeResult<Option<MessageEnvelope>> {
        tokio::select! {
            _ = self.cancellation.cancelled() => Err(RuntimeError::cancelled()),
            result = self.session.receive(channel) => result,
        }
    }

    pub async fn progress(&self, channel: &str, progress: JobProgress) -> RuntimeResult<()> {
        progress.validate()?;
        let envelope = self.session.envelope(
            channel,
            "progress",
            &self.process_id,
            "job_progress",
            serde_json::to_value(progress)?,
        );
        self.send(channel, envelope).await
    }
}

#[derive(Clone, Default)]
pub struct CspRuntime {
    sessions: Arc<RwLock<HashMap<String, CspSession>>>,
}

impl CspRuntime {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn create_session(&self, config: SessionConfig) -> RuntimeResult<CspSession> {
        let session = CspSession::new(config)?;
        let mut sessions = self.sessions.write().await;
        if sessions.contains_key(session.id()) {
            return Err(RuntimeError::new(
                "session_exists",
                format!("session '{}' already exists", session.id()),
            ));
        }
        sessions.insert(session.id().to_string(), session.clone());
        Ok(session)
    }

    pub async fn session(&self, session_id: &str) -> Option<CspSession> {
        self.sessions.read().await.get(session_id).cloned()
    }

    pub async fn session_count(&self) -> usize {
        self.sessions.read().await.len()
    }

    pub async fn close_session(&self, session_id: &str) -> RuntimeResult<()> {
        let session = self.sessions.read().await.get(session_id).cloned();
        if let Some(session) = session {
            session.close().await?;
            self.sessions.write().await.remove(session_id);
            Ok(())
        } else {
            Err(RuntimeError::new(
                "session_not_found",
                format!("unknown session '{session_id}'"),
            ))
        }
    }

    pub async fn shutdown(&self) -> RuntimeResult<()> {
        let session_ids: Vec<String> = self.sessions.read().await.keys().cloned().collect();
        for session_id in session_ids {
            self.close_session(&session_id).await?;
        }
        Ok(())
    }
}

fn next_id(prefix: &str) -> String {
    let sequence = NEXT_RUNTIME_ID.fetch_add(1, Ordering::Relaxed);
    format!("{prefix}-{}-{sequence}", std::process::id())
}

fn deadline_instant(value: &str) -> Option<Instant> {
    let deadline = chrono::DateTime::parse_from_rfc3339(value).ok()?;
    let now = chrono::Utc::now();
    let duration = deadline
        .with_timezone(&chrono::Utc)
        .signed_duration_since(now);
    if duration <= chrono::Duration::zero() {
        Some(Instant::now())
    } else {
        duration
            .to_std()
            .ok()
            .map(|duration| Instant::now() + duration)
    }
}

fn timestamp_expired(value: &str) -> bool {
    chrono::DateTime::parse_from_rfc3339(value)
        .map(|deadline| deadline.with_timezone(&chrono::Utc) <= chrono::Utc::now())
        .unwrap_or(true)
}
