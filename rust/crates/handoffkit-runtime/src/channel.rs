use crate::{RuntimeError, RuntimeResult};
use handoffkit_protocol::{ChannelConfig, MessageEnvelope, OverflowPolicy, ValidationLimits};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, Mutex, Notify};
use tokio::time::{timeout_at, Instant};
use tokio_util::sync::CancellationToken;

#[derive(Clone)]
pub struct CspChannel {
    config: ChannelConfig,
    sender: mpsc::Sender<MessageEnvelope>,
    receiver: Arc<Mutex<mpsc::Receiver<MessageEnvelope>>>,
    cancelled: CancellationToken,
    closed: Arc<AtomicBool>,
    notify: Arc<Notify>,
    deadline: Option<Instant>,
    limits: ValidationLimits,
}

impl std::fmt::Debug for CspChannel {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("CspChannel")
            .field("name", &self.config.name)
            .field("capacity", &self.config.capacity)
            .field("closed", &self.is_closed())
            .finish()
    }
}

impl CspChannel {
    pub(crate) fn new(
        config: ChannelConfig,
        cancelled: CancellationToken,
        notify: Arc<Notify>,
        deadline: Option<Instant>,
        limits: ValidationLimits,
    ) -> RuntimeResult<Self> {
        config.validate()?;
        let (sender, receiver) = mpsc::channel(config.capacity);
        Ok(Self {
            config,
            sender,
            receiver: Arc::new(Mutex::new(receiver)),
            cancelled,
            closed: Arc::new(AtomicBool::new(false)),
            notify,
            deadline,
            limits,
        })
    }

    pub fn config(&self) -> &ChannelConfig {
        &self.config
    }

    pub fn capacity(&self) -> usize {
        self.sender.capacity()
    }

    pub fn max_capacity(&self) -> usize {
        self.sender.max_capacity()
    }

    pub fn len(&self) -> usize {
        self.max_capacity().saturating_sub(self.capacity())
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn is_closed(&self) -> bool {
        self.closed.load(Ordering::Acquire)
            || self.sender.is_closed()
            || self.cancelled.is_cancelled()
    }

    pub async fn send(&self, envelope: MessageEnvelope) -> RuntimeResult<()> {
        if self.is_closed() {
            return Err(RuntimeError::new("channel_closed", "channel is closed"));
        }
        if envelope.channel != self.config.name {
            return Err(RuntimeError::new(
                "channel_mismatch",
                format!(
                    "envelope channel '{}' does not match '{}'",
                    envelope.channel, self.config.name
                ),
            ));
        }
        if self.config.requires_ack && !envelope.requires_ack {
            return Err(RuntimeError::new(
                "ack_required",
                "channel requires acknowledged delivery",
            ));
        }
        envelope.validate_with_limits(self.limits)?;

        match self.config.overflow_policy {
            OverflowPolicy::Reject => {
                self.sender
                    .try_send(envelope)
                    .map_err(|error| match error {
                        mpsc::error::TrySendError::Full(_) => {
                            RuntimeError::retryable("backpressure", "channel is full")
                        }
                        mpsc::error::TrySendError::Closed(_) => {
                            RuntimeError::new("channel_closed", "channel is closed")
                        }
                    })?
            }
            OverflowPolicy::Block => {
                let send = self.sender.send(envelope);
                if let Some(deadline) = self.deadline {
                    tokio::select! {
                        _ = self.cancelled.cancelled() => return Err(RuntimeError::cancelled()),
                        result = timeout_at(deadline, send) => match result {
                            Ok(Ok(())) => {}
                            Ok(Err(_)) => return Err(RuntimeError::new("channel_closed", "channel is closed")),
                            Err(_) => return Err(RuntimeError::deadline()),
                        },
                    }
                } else {
                    tokio::select! {
                        _ = self.cancelled.cancelled() => return Err(RuntimeError::cancelled()),
                        result = send => result.map_err(|_| RuntimeError::new("channel_closed", "channel is closed"))?,
                    }
                }
            }
        }
        self.notify.notify_one();
        Ok(())
    }

    pub async fn receive(&self) -> RuntimeResult<Option<MessageEnvelope>> {
        let mut receiver = self.receiver.lock().await;
        let receive = receiver.recv();
        if let Some(deadline) = self.deadline {
            tokio::select! {
                _ = self.cancelled.cancelled() => Err(RuntimeError::cancelled()),
                result = timeout_at(deadline, receive) => result.map_err(|_| RuntimeError::deadline()),
            }
        } else {
            tokio::select! {
                _ = self.cancelled.cancelled() => Err(RuntimeError::cancelled()),
                result = receive => Ok(result),
            }
        }
    }

    pub async fn receive_timeout(
        &self,
        duration: Duration,
    ) -> RuntimeResult<Option<MessageEnvelope>> {
        tokio::time::timeout(duration, self.receive())
            .await
            .map_err(|_| RuntimeError::deadline())?
    }

    pub async fn try_receive(&self) -> RuntimeResult<Option<MessageEnvelope>> {
        let mut receiver = self.receiver.lock().await;
        match receiver.try_recv() {
            Ok(envelope) => Ok(Some(envelope)),
            Err(mpsc::error::TryRecvError::Empty) => Ok(None),
            Err(mpsc::error::TryRecvError::Disconnected) => Ok(None),
        }
    }

    pub async fn close(&self) {
        self.closed.store(true, Ordering::Release);
        self.receiver.lock().await.close();
        self.notify.notify_waiters();
    }

    pub(crate) fn notify(&self) -> Arc<Notify> {
        Arc::clone(&self.notify)
    }
}

pub async fn select(channels: &[CspChannel]) -> RuntimeResult<(usize, MessageEnvelope)> {
    if channels.is_empty() {
        return Err(RuntimeError::new(
            "empty_select",
            "select requires at least one channel",
        ));
    }
    let notify = channels[0].notify();
    if channels
        .iter()
        .any(|channel| !Arc::ptr_eq(&channel.notify, &notify))
    {
        return Err(RuntimeError::new(
            "mixed_session_select",
            "select requires channels from the same session",
        ));
    }
    let cancelled = channels[0].cancelled.clone();
    let deadline = channels[0].deadline;
    loop {
        if cancelled.is_cancelled() {
            return Err(RuntimeError::cancelled());
        }
        if deadline.is_some_and(|value| Instant::now() >= value) {
            return Err(RuntimeError::deadline());
        }
        for (index, channel) in channels.iter().enumerate() {
            if let Some(envelope) = channel.try_receive().await? {
                return Ok((index, envelope));
            }
        }
        if channels.iter().all(CspChannel::is_closed) {
            return Err(RuntimeError::new(
                "channels_closed",
                "all selected channels are closed",
            ));
        }
        let notified = notify.notified();
        if let Some(deadline) = deadline {
            tokio::select! {
                _ = cancelled.cancelled() => return Err(RuntimeError::cancelled()),
                result = timeout_at(deadline, notified) => {
                    result.map_err(|_| RuntimeError::deadline())?;
                }
            }
        } else {
            tokio::select! {
                _ = cancelled.cancelled() => return Err(RuntimeError::cancelled()),
                _ = notified => {}
            }
        }
    }
}
