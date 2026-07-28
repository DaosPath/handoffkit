import {
  BackpressureError,
  ChannelClosedError,
  ChannelConfig,
  CspError,
  DeadlineExceededError,
  DEFAULT_MAX_MESSAGE_BYTES,
  DeliveryAck,
  DeliveryNack,
  DistributedRuntimeUnavailableError,
  MessageTooLargeError,
  MessageEnvelope,
  OverflowPolicy,
  RuntimeMode,
  SessionConfig,
} from "./contracts.js";

function randomId(prefix) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

export class Transport {
  async send(_envelope) { throw new CspError("Transport.send() is not implemented."); }
  async receive() { throw new CspError("Transport.receive() is not implemented."); }
  async close() { throw new CspError("Transport.close() is not implemented."); }
}

export class CspChannel {
  constructor(config, { maxMessageBytes = DEFAULT_MAX_MESSAGE_BYTES } = {}) {
    this.config = config instanceof ChannelConfig ? config : new ChannelConfig(config);
    this.maxMessageBytes = maxMessageBytes;
    this.queue = [];
    this.receivers = [];
    this.senders = [];
    this.readableWaiters = new Set();
    this.closed = false;
  }
  get name() { return this.config.name; }
  get size() { return this.queue.length; }
  notifyReadable() { for (const resolve of this.readableWaiters) resolve(); this.readableWaiters.clear(); }
  async send(value) {
    const envelope = value instanceof MessageEnvelope ? value : MessageEnvelope.fromWire(value);
    if (this.closed) throw new ChannelClosedError(`Channel ${this.name} is closed.`);
    if (envelope.channel !== this.name) throw new TypeError(`Envelope channel does not match ${this.name}.`);
    if (envelope.encodedSize() > this.maxMessageBytes) throw new MessageTooLargeError(`Envelope exceeds ${this.maxMessageBytes} bytes.`);
    if (envelope.deadline && Date.parse(envelope.deadline) <= Date.now()) {
      throw new DeadlineExceededError("Envelope deadline has elapsed.");
    }
    const receiver = this.receivers.shift();
    if (receiver) { receiver.resolve(envelope); return; }
    if (this.queue.length < this.config.capacity) { this.queue.push(envelope); this.notifyReadable(); return; }
    if (this.config.overflowPolicy === OverflowPolicy.REJECT) throw new BackpressureError(`Channel ${this.name} is at capacity.`);
    await new Promise((resolve, reject) => this.senders.push({ envelope, resolve, reject }));
  }
  promoteSender() {
    const sender = this.senders.shift();
    if (!sender) return;
    const receiver = this.receivers.shift();
    if (receiver) receiver.resolve(sender.envelope);
    else this.queue.push(sender.envelope);
    sender.resolve();
    this.notifyReadable();
  }
  tryReceive() {
    const value = this.queue.shift();
    if (value) this.promoteSender();
    return value ?? null;
  }
  receive() {
    const value = this.tryReceive();
    if (value) return Promise.resolve(value);
    if (this.closed) return Promise.reject(new ChannelClosedError(`Channel ${this.name} is closed.`));
    return new Promise((resolve, reject) => this.receivers.push({ resolve, reject }));
  }
  waitReadable() {
    if (this.queue.length || this.closed) return { promise: Promise.resolve(), cancel() {} };
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    this.readableWaiters.add(resolve);
    return { promise, cancel: () => this.readableWaiters.delete(resolve) };
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    const error = new ChannelClosedError(`Channel ${this.name} is closed.`);
    for (const receiver of this.receivers.splice(0)) receiver.reject(error);
    for (const sender of this.senders.splice(0)) sender.reject(error);
    this.notifyReadable();
  }
}

export async function select(channels) {
  const list = [...channels];
  if (!list.length) throw new TypeError("select requires at least one channel");
  while (true) {
    for (const channel of list) {
      const value = channel.tryReceive();
      if (value) return [channel, value];
      if (channel.closed) throw new ChannelClosedError(`Channel ${channel.name} is closed.`);
    }
    const waits = list.map((channel) => ({ channel, ...channel.waitReadable() }));
    await Promise.race(waits.map((wait) => wait.promise));
    for (const wait of waits) wait.cancel();
  }
}

export class ProcessHandle {
  constructor(processId, promise, cancel) { this.processId = processId; this.promise = promise; this.cancel = cancel; }
  get done() { return this.settled === true; }
  wait() { return this.promise; }
}

export class ProcessContext {
  constructor(session, processId, signal) { this.session = session; this.processId = processId; this.signal = signal; }
  get cancelled() { return this.session.cancelled || this.signal.aborted; }
  waitCancelled() {
    if (this.cancelled) return Promise.resolve();
    return new Promise((resolve) => this.signal.addEventListener("abort", resolve, { once: true }));
  }
  send(channel, envelope) { return this.session.send(channel, envelope); }
  receive(channel) { return this.session.receive(channel); }
  select(channels) { return this.session.select(channels); }
  ack(envelope, metadata = {}) { return this.session.ack(envelope, metadata); }
  nack(envelope, options) { return this.session.nack(envelope, options); }
}

export class CspSession {
  constructor(config) {
    this.config = config instanceof SessionConfig ? config : new SessionConfig(config);
    if (this.config.runtimeMode === RuntimeMode.DISTRIBUTED) throw new DistributedRuntimeUnavailableError("Distributed runtime is not installed.");
    this.channels = new Map();
    this.processes = new Map();
    this.pendingAcks = new Map();
    this.pendingEnvelopes = new Map();
    this.dedup = new Map();
    this.cancelled = false;
    this.closed = false;
    this.deadlineTimer = null;
    this.armDeadline();
  }
  get sessionId() { return this.config.sessionId; }
  armDeadline() {
    if (!this.config.deadline || this.closed || this.cancelled) return;
    const remaining = Date.parse(this.config.deadline) - Date.now();
    if (remaining <= 0) {
      queueMicrotask(() => this.cancel());
      return;
    }
    const delay = Math.min(remaining, 2147483647);
    this.deadlineTimer = setTimeout(() => {
      this.deadlineTimer = null;
      if (delay < remaining) this.armDeadline();
      else this.cancel();
    }, delay);
    this.deadlineTimer.unref?.();
  }
  channel(name, options = {}) {
    if (this.cancelled || this.closed) throw new CspError("CSP session is closed or cancelled.");
    if (!this.channels.has(name)) this.channels.set(name, new CspChannel(new ChannelConfig({ name, capacity: options.capacity ?? this.config.channelCapacity, requiresAck: options.requiresAck }), { maxMessageBytes: this.config.maxMessageBytes }));
    return this.channels.get(name);
  }
  send(channel, envelope) {
    if (envelope.sessionId !== this.sessionId) throw new TypeError("Envelope sessionId does not match session.");
    if (!envelope.deadline && this.config.deadline) {
      envelope = MessageEnvelope.fromWire({ ...envelope.toWire(), deadline: this.config.deadline });
    }
    return this.channel(channel).send(envelope);
  }
  async receive(channel) {
    while (true) {
      const envelope = await this.channel(channel).receive();
      if (envelope.idempotencyKey && this.dedup.has(envelope.idempotencyKey)) { this.ack(envelope, { duplicate: true }); continue; }
      this.pendingEnvelopes.set(envelope.messageId, envelope);
      return envelope;
    }
  }
  async select(names) {
    const resolved = [...names];
    while (true) {
      const [channel, envelope] = await select(resolved.map((name) => this.channel(name)));
      if (envelope.idempotencyKey && this.dedup.has(envelope.idempotencyKey)) {
        this.ack(envelope, { duplicate: true });
        continue;
      }
      this.pendingEnvelopes.set(envelope.messageId, envelope);
      return [channel.name, envelope];
    }
  }
  spawn(processId, handler) {
    if (this.processes.has(processId)) throw new TypeError(`Process ${processId} already exists.`);
    const controller = new AbortController();
    const handle = new ProcessHandle(
      processId,
      Promise.resolve().then(() => handler(new ProcessContext(this, processId, controller.signal))),
      () => controller.abort(),
    );
    this.processes.set(processId, handle);
    handle.promise.then(
      () => { handle.settled = true; },
      () => { handle.settled = true; },
    );
    return handle;
  }
  ack(envelope, metadata = {}) {
    const ack = new DeliveryAck({ messageId: envelope.messageId, metadata });
    this.pendingEnvelopes.delete(envelope.messageId);
    if (envelope.idempotencyKey) {
      this.dedup.delete(envelope.idempotencyKey);
      this.dedup.set(envelope.idempotencyKey, true);
      while (this.dedup.size > this.config.dedupCapacity) this.dedup.delete(this.dedup.keys().next().value);
    }
    this.pendingAcks.get(envelope.messageId)?.resolve(ack);
    return ack;
  }
  nack(envelope, { code, message, retryable = false, metadata = {} }) {
    const nack = new DeliveryNack({ messageId: envelope.messageId, code, message, retryable, metadata });
    this.pendingEnvelopes.delete(envelope.messageId);
    this.pendingAcks.get(envelope.messageId)?.resolve(nack);
    return nack;
  }
  async sendWithAck(channel, original) {
    if (!original.requiresAck) throw new TypeError("sendWithAck requires requiresAck=true");
    let envelope = original;
    for (let attempt = 1; attempt <= this.config.retryPolicy.maxAttempts; attempt += 1) {
      let resolve;
      const resultPromise = new Promise((done) => { resolve = done; });
      this.pendingAcks.set(envelope.messageId, { resolve });
      let timeoutId;
      let result;
      try {
        await this.send(channel, envelope);
        const timeoutPromise = new Promise((done) => {
          timeoutId = setTimeout(
            () => done(new DeliveryNack({ messageId: envelope.messageId, code: "ack_timeout", message: "Acknowledgement deadline elapsed.", retryable: true })),
            this.config.ackTimeoutMs,
          );
        });
        result = await Promise.race([resultPromise, timeoutPromise]);
      } finally {
        clearTimeout(timeoutId);
        this.pendingAcks.delete(envelope.messageId);
      }
      if (result instanceof DeliveryAck) return result;
      if (!result.retryable || attempt >= this.config.retryPolicy.maxAttempts) throw new CspError(`Message was not acknowledged: ${result.code}: ${result.message}`);
      const delay = Math.min(this.config.retryPolicy.baseDelayMs * (2 ** (attempt - 1)), this.config.retryPolicy.maxDelayMs);
      if (delay) await new Promise((done) => setTimeout(done, delay));
      envelope = envelope.nextAttempt();
    }
    throw new CspError("Retry loop exited unexpectedly.");
  }
  wait() { return Promise.all([...this.processes.values()].map((handle) => handle.wait())); }
  cancel() {
    if (this.cancelled) return;
    this.cancelled = true;
    clearTimeout(this.deadlineTimer);
    this.deadlineTimer = null;
    for (const handle of this.processes.values()) if (!handle.done) handle.cancel();
    for (const channel of this.channels.values()) channel.close();
  }
  async close() { if (this.closed) return; this.closed = true; this.cancel(); for (const channel of this.channels.values()) channel.close(); await Promise.allSettled([...this.processes.values()].map((handle) => handle.wait())); }
}

export class CspRuntime {
  constructor({ mode = RuntimeMode.SESSION } = {}) { this.mode = mode; }
  createSession({ sessionId = randomId("session"), config = null } = {}) {
    if (this.mode === RuntimeMode.DISTRIBUTED) throw new DistributedRuntimeUnavailableError("Distributed runtime becomes available in HandoffKit 1.18.");
    return new CspSession(config ?? new SessionConfig({ sessionId, runtimeMode: this.mode }));
  }
  makeEnvelope(init) { return makeEnvelope(init); }
}

export function makeEnvelope({ sessionId, channel, source, payloadType, payload, sequence, target = null, kind = "data", requiresAck = false, idempotencyKey = null }) {
  return new MessageEnvelope({ messageId: randomId("msg"), sessionId, channel, kind, source, target, sequence, payloadType, payload, requiresAck, idempotencyKey });
}
