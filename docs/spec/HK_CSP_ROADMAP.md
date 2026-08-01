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

The released 1.18 baseline added the Go control plane, distributed scheduling,
bounded TCP/Unix transports, workers, and cross-runtime stdio coverage. It did
not establish ARM64 release validation, a Tauri security adapter, or secure
durable recovery.

## 1.19 development - security and native compute

Implemented on the development branch: real TLS 1.3 paths in Python, Node, Go,
and Rust; certificate-bound identity/authorization/replay; maintained Ed25519
providers; provider-dependent hybrid TLS in compatible Node/Go environments;
five-runtime security conformance; a bounded C++ `std::jthread` worker; and a
real cpp-ml TrainingJob/EvaluationJob path with progress and checkpoint/report
artifacts.

Not implemented and excluded from current public scope: C++ TLS, ARM64/edge
validation, low-memory/unstable-network qualification, Studio security
visibility, durable session/job/replay recovery, OS keystores, trust-store live
reload, certificate rotation, CRL/OCSP, and zeroization guarantees.

These entries describe development status, not a released 1.19 product.
Runtime security APIs remain experimental until the documented gaps close.
