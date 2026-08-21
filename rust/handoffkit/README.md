# handoffkit

Convenience facade for the independent HandoffKit Rust runtime.

HandoffKit 1.19 development re-exports:

- canonical workflow contracts from `handoffkit-contracts`;
- HK-CSP 1.0 wire types from `handoffkit-protocol`;
- bounded Tokio sessions, processes, Agent, Team, and Recipe execution from
  `handoffkit-runtime`;
- local transports plus experimental rustls/ring TLS 1.3 TCP, mTLS,
  certificate identity/replay/authorization, and Ed25519 artifact security
  from `handoffkit-transport`.

Contracts and wire semantics are stable. Runtime and transport APIs remain
experimental. Hybrid-PQ, certificate rotation, CRL/OCSP, OS keystores, and
durable secure recovery are unavailable in the Rust provider.
