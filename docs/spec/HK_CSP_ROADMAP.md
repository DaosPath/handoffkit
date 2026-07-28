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

Planned: Tokio runtime/transports, tools, traces, local daemon, Unix sockets,
TCP, supervision, ARM64 targets, and callback-based Tauri integration.

## 1.18 - Go distributed runtime

Planned: Go control plane, worker pools, capability routing, TCP/WebSocket,
connection recovery, remote workers, and activation of distributed mode across
supported runtimes.

## 1.19 - Native compute and edge

Planned: C++ `std::jthread` runtime, bounded queues, embedded Linux profiles,
ML workers, progress/checkpoint streams, and Studio session visibility.

Future entries describe intent, not shipped functionality. Runtime APIs remain
experimental until cross-language testing supports stabilization in 1.19.
