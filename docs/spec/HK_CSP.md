# HK-CSP 1.0

HK-CSP is HandoffKit's **Communicating Sequential Processes** layer. It is not
Content Security Policy. HandoffKit contracts define the information exchanged
by agents; HK-CSP defines how logical processes exchange that information while
a workflow is running.

## Layering

1. Contracts: handoffs, tools, traces, jobs, progress, and artifacts.
2. Protocol: sessions, envelopes, acknowledgements, errors, and versioning.
3. Transports: in-process, stdio, Unix sockets, TCP, and WebSocket.
4. Runtime: processes, channels, supervision, cancellation, and routing.
5. Workers: providers, tools, browser tasks, media tasks, and native compute.

Applications may use the contract layer without using the CSP runtime. Existing
`Agent`, `Team`, `RecipeRunner`, and `HandoffState` behavior remains available
through classic mode.

## Runtime modes

- `classic`: existing direct sequential execution.
- `session`: CSP execution in one runtime, optionally crossing local stdio.
- `distributed`: worker routing across network transports. Reserved until the
  distributed runtime is installed; unsupported runtimes must fail fast.

## Processes and channels

A process is a logical task, coroutine, actor, or worker. It is not necessarily
an operating-system process. A session owns processes and named channels.

Channels are bounded FIFO queues. The default capacity is 64. The default
overflow policy is `block`; `reject` is available when waiting is undesirable.
Messages are never silently dropped.

Core operations are `spawn`, `send`, `receive`, `select`, `ack`, `nack`,
`cancel`, and `close`. Parent cancellation and deadlines propagate to child
processes. Closing a session closes its channels and waits for owned processes.

## Delivery model

Messages that do not request acknowledgement are delivered at most once by the
runtime. Messages requesting acknowledgement may be retried and are therefore
at least once. Exactly-once delivery is not claimed.

Retries preserve `message_id`, `correlation_id`, and `idempotency_key`, while
incrementing `attempt`. Default policy: three total attempts, 100 ms initial
delay, 2 s maximum delay. Deduplication is bounded and in-memory; it is lost when
the session stops.

## Compatibility

The protocol uses `major.minor` versions. A peer rejects an unsupported major
version. Unknown fields and newer minor versions are accepted where required
fields remain valid. All canonical JSON uses `snake_case`.

Runtime APIs are experimental through HandoffKit 1.19. The 1.0 wire contracts
are stable from HandoffKit 1.16.

## Non-goals for 1.0

- durable queues or persistence,
- exactly-once delivery,
- global ordering across independent connections,
- binary artifact transfer inside message envelopes,
- implicit execution of shell commands received from a peer.
