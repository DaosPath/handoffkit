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

The green development baseline contains real TLS 1.3 paths in Python, Node, Go,
and Rust; certificate-bound identity/authorization/replay; maintained Ed25519
providers; provider-dependent hybrid TLS in compatible Node/Go environments;
five-runtime security conformance; a bounded C++ `std::jthread` worker; and a
real cpp-ml TrainingJob/EvaluationJob path with progress and signed checkpoint
artifacts.

Later finalization work added optional durable replay in the four secure
runtimes, durable local revocation, live trust/certificate reload and rotation,
a bounded Go completed-job ledger, native Linux ARM64 runner configuration,
applied
edge profiles, and read-only Studio visibility sourced from real Go gateway
events. The Python, Node, Go, and Rust distributed schedulers also gained an
optional shared-format durable store for queued jobs, counters, and dedup
identities. The file stores support validated private backup/restore before
runtime startup. Restarted in-flight assignments are marked interrupted by
default; opt-in auto-resume requeues them as at-least-once work. These capabilities are classified as
**experimental** in the security ledger, with the documented scope limits
preserved. No capability is promoted by the roadmap text alone.

Provider-dependent C++ TLS is now available behind `HANDOFFKIT_WITH_TLS=ON`
with OpenSSL TLS 1.3/mTLS, file-backed CRL, signed OCSP response validation,
and a common certificate/replay/authorization/dispatch path. OCSP responder
fetch (AIA/HTTP/HTTPS), cross-runtime OS-keystore adapters, and verified global
secret zeroization remain unavailable; C++ selects Windows Credential Manager,
macOS Keychain, or Linux Secret Service only when detected, and native
`SecureBuffer` remains scoped.
Still incomplete: universal artifact-ingestion enforcement, durable
channel/session buffers, unsupported durable state migrations, upgrade/rollback
orchestration, automatic in-flight compute resumption, exactly-once external
effects, broad ARM64 device/OS qualification, unstable-network qualification,
and reproducible remote benchmark archives.

These entries describe development status, not a released 1.19 product. The
authoritative evidence and exact classifications are in
[`HK_CSP_SECURITY.md`](./HK_CSP_SECURITY.md). Forward release planning starts at
[`docs/roadmap/README.md`](../roadmap/README.md).
