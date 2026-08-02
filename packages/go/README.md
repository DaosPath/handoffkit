# HandoffKit Go Runtime

Experimental Go implementation of HK-CSP 1.0 for HandoffKit 1.19 development.

## Implemented

- canonical snake_case contracts and shared fixture validation;
- bounded FIFO channels with blocking backpressure;
- sessions, ACK/NACK, retries, deadlines, cancellation, and deduplication;
- persistent file-backed deduplication;
- in-process, stdio NDJSON, Unix socket, and length-delimited TCP transports;
- real TLS 1.3 TCP client/listener with configured/system roots, hostname
  verification, mTLS, certificate-derived identity, replay, and local
  authorization before dispatch;
- maintained-provider Ed25519 artifact signing and verification;
- provider-dependent `X25519MLKEM768` in compatible Go builds, with fail-closed
  capability detection, negotiated-group checks on wrapped sockets, and no
  profile fallback;
- subprocess workers without shell invocation;
- worker registry, capability routing, heartbeats, leases, and initial scheduler;
- real stdio interoperability with Python, JavaScript, and Rust;
- local CLI, worker, and daemon binaries.

## Status

The wire contract remains HK-CSP 1.0. Go runtime and security APIs remain
experimental. Real-socket integration and race tests cover the secure path,
but this is not a global cluster scheduler. The secure TCP path has optional
durable replay, durable local revocation, and atomic certificate/trust reload.
The optional cpp-ml gateway adds a durable idempotency/result ledger and a
signed snapshot gate around a same-host C++ worker process. CRL/OCSP, general
durable session/queue recovery, multi-host consensus, Kubernetes orchestration,
and durable distributed queues remain unavailable.

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
