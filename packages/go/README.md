# HandoffKit Go Runtime

Experimental Go implementation of HK-CSP 1.0 for HandoffKit Core 1.18.0.

## Implemented

- canonical snake_case contracts and shared fixture validation;
- bounded FIFO channels with blocking backpressure;
- sessions, ACK/NACK, retries, deadlines, cancellation, and deduplication;
- persistent file-backed deduplication;
- in-process, stdio NDJSON, Unix socket, and length-delimited TCP transports;
- subprocess workers without shell invocation;
- worker registry, capability routing, heartbeats, leases, and initial scheduler;
- real stdio interoperability with Python, JavaScript, and Rust;
- local CLI, worker, and daemon binaries.

## Status

The wire contract remains HK-CSP 1.0. Go runtime APIs are experimental in 1.18.0.
This is an initial distributed runtime, not a global cluster scheduler. Authentication,
multi-host consensus, Kubernetes orchestration, and durable distributed queues are out
of scope for this release.

## Commands

```sh
go test ./...
go test -race ./...
go run ./cmd/handoffkit csp doctor
go run ./cmd/handoffkit csp demo
go build -o ../../.local-tests/bin/handoffkit-worker ./cmd/handoffkit-worker
```

Process interoperability tests require built peer runtimes and explicit opt-in:

```sh
HANDOFFKIT_RUN_INTEROP_TESTS=1 go test ./interop -v
```
