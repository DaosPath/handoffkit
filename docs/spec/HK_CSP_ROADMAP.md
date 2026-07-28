# HK-CSP runtime roadmap

HK-CSP separates delivery semantics from workflow payloads. `HandoffState`
defines what crosses an agent boundary; HK-CSP defines how, when, and between
which logical processes it crosses.

## 1.16 - Specification and local sessions

- Stable HK-CSP 1.0 wire contracts, schemas, fixtures, and negotiation.
- Python asyncio and browser-safe JavaScript bounded channels.
- In-process and NDJSON stdio execution.
- Rust contracts/protocol crates and C++ codecs/job adapters.
- Classic runtime remains the default; new runtime APIs are experimental.

## 1.17 - Rust runtime

Implemented and tested:

- Tokio sessions, bounded FIFO channels, blocking backpressure and local
  process supervision.
- Cancellation, deadlines, ACK/NACK, bounded retry, idempotency-key
  deduplication, progress and artifact references.
- Native Rust Agent, Team and Recipe classic/session execution.
- Native tool execution, Team/Recipe trace construction and side-effect-free
  replay summaries.
- Bounded NDJSON stdio, local subprocess workers, handshake, correlation,
  structured errors and graceful shutdown.
- Rust CLI doctor, inspect, run, worker and demo commands.
- Real-process interoperability in both directions with Python and JavaScript.

Still experimental: runtime, transport and CLI APIs. Not implemented in 1.17:
Unix sockets, TCP, WebSocket, daemon, distributed execution, ARM64 release
artifacts and Tauri adapters. Those move to 1.18 where they can share the Go
control-plane work instead of creating a premature second wire layer.

## 1.18 - Go distributed runtime

Planned: Go control plane, worker pools, capability routing, TCP/WebSocket and
Unix-socket transports, connection recovery, remote workers, Rust local daemon,
ARM64 release validation, callback-based Tauri adapter, and activation of
distributed mode across supported runtimes.

## 1.19 - Native compute and edge

Planned: C++ `std::jthread` runtime, bounded queues, embedded Linux profiles,
ML workers, progress/checkpoint streams, and Studio session visibility.

Future entries describe intent, not shipped functionality. Runtime APIs remain
experimental until cross-language testing supports stabilization in 1.19.
