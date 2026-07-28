# handoffkit

Convenience facade for the independent HandoffKit Rust runtime.

HandoffKit 1.17 re-exports:

- canonical workflow contracts from `handoffkit-contracts`;
- HK-CSP 1.0 wire types from `handoffkit-protocol`;
- bounded Tokio sessions, processes, Agent, Team, and Recipe execution from
  `handoffkit-runtime`;
- local NDJSON stdio/subprocess transports from `handoffkit-transport`.

Contracts and wire semantics are stable. Runtime and transport APIs remain
experimental until the cross-language stabilization planned for 1.19.
