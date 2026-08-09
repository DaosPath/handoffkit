# Rust runtime support matrix

HandoffKit Rust 1.19 is a native Tokio implementation. It does not depend on
Python.

| Capability | State | Stability |
|---|---|---|
| Canonical contracts and fixtures | Implemented, cross-runtime tested | Stable wire |
| HK-CSP 1.0 envelope negotiation | Implemented, cross-runtime tested | Stable wire |
| Bounded FIFO and blocking backpressure | Implemented, unit tested | Experimental API |
| Cancellation and deadlines | Implemented, unit tested | Experimental API |
| ACK/NACK, retry, idempotency, dedup | Implemented, unit tested | Experimental API |
| In-process processes/workers | Implemented, unit tested | Experimental API |
| NDJSON stdio and subprocess workers | Implemented, interop tested | Experimental API |
| Agent, Team, Recipe classic/session | Implemented, unit tested | Experimental API |
| Tool registry and async tool execution | Implemented, unit tested | Experimental API |
| Team/Recipe traces and replay summaries | Implemented, unit tested | Experimental API |
| CLI doctor/inspect/run/worker/demo | Implemented, subprocess tested | Experimental API |
| Rust to Python/JavaScript stdio | Implemented, real-process tested | Experimental API |
| Python/JavaScript to Rust stdio | Implemented, real-process tested | Experimental API |
| Unix sockets and TCP | Implemented, real-socket tested | Experimental API |
| TLS 1.3, mTLS, certificate identity, replay, and authorization | Implemented in `handoffkit-transport`, real-socket tested | Experimental API; C++ is not covered |
| Distributed scheduler/workers | Implemented in `handoffkit-runtime`, fixture/restart/corruption tested | Experimental API; durable state is optional and in-flight work becomes explicit `interrupted` |
| Tauri callback adapter | Deferred | Not implemented |

Security limits and operational semantics are documented in
[`HK_CSP_SECURITY.md`](../spec/HK_CSP_SECURITY.md) and
[`HK_CSP_WIRE.md`](../spec/HK_CSP_WIRE.md).
