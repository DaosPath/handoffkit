# HandoffKit Rust 1.19 development

Independent Rust implementation of HandoffKit and HK-CSP. It does not invoke or
embed Python.

## Crates

| Crate | Capability | Status |
|---|---|---|
| `handoffkit-contracts` | Handoffs, tools, traces, reports | Stable wire contracts |
| `handoffkit-protocol` | HK-CSP envelopes, config, ACK/NACK, jobs | Stable HK-CSP 1.0 wire; validation hardened |
| `handoffkit-runtime` | Tokio sessions, channels, processes, Agent/Team/Recipe, tools, trace/replay | Implemented and tested; experimental API |
| `handoffkit-transport` | Bounded local transports plus TLS 1.3 TCP, mTLS, identity/replay/authorization and Ed25519 artifacts | Implemented and integration-tested; experimental API |
| `handoffkit-cli` | Doctor, inspect, run, worker, demo | Implemented and tested; experimental API |
| `handoffkit` | Convenience facade | Implemented |

## Runtime guarantees

- bounded FIFO channels with blocking backpressure by default;
- async send/receive/select and clean channel closure;
- parent-to-child cancellation and session deadlines;
- ACK/NACK delivery with bounded exponential retry;
- in-memory idempotency-key deduplication;
- structured, redacted process/transport errors;
- bounded process and pending-ACK counts;
- progress events and `ArtifactRef` payloads;
- classic and HK-CSP session modes for Agent, Team, and Recipe;
- stdio handshake, request correlation, graceful subprocess shutdown, and
  orphan protection through `kill_on_drop`.
- rustls/ring TLS 1.3 client and listener paths with configured/native roots,
  hostname checks, mTLS, certificate-derived URI SAN identity, local grants,
  and replay checks before dispatch;
- Ed25519 artifact signing/verification with shared cross-runtime vectors.

There is no exactly-once claim. Deduplication is memory-local and is lost on
restart. Secure replay state is also process-local. The rustls/ring provider
does not expose the required hybrid-PQ group, so `hybrid-pq` reports unavailable
and fails closed. Certificate rotation, CRL/OCSP, OS keystores, and durable
secure recovery are unavailable.

## Commands

```bash
cargo run --manifest-path rust/Cargo.toml -p handoffkit-cli -- csp doctor
cargo run --manifest-path rust/Cargo.toml -p handoffkit-cli -- csp demo
cargo run --manifest-path rust/Cargo.toml -p handoffkit-cli -- csp inspect trace.ndjson
cargo run --manifest-path rust/Cargo.toml -p handoffkit-cli -- csp worker
cargo run --manifest-path rust/Cargo.toml -p handoffkit-cli -- csp run <worker> [args...]
```

## Validation

```bash
cargo fmt --manifest-path rust/Cargo.toml --all --check
cargo clippy --manifest-path rust/Cargo.toml --workspace --all-targets -- -D warnings
cargo test --manifest-path rust/Cargo.toml --workspace
```

Set `HANDOFFKIT_RUN_INTEROP_TESTS=1` to execute Rust-initiated Python and
JavaScript subprocess tests. The CI interoperability job also runs Python and
JavaScript clients against the Rust worker.
