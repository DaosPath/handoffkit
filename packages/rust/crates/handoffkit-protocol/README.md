# handoffkit-protocol

Lightweight HK-CSP wire contracts and protocol negotiation for Rust.

This crate remains independent from Tokio and network transports. HandoffKit
1.17 adds configurable size/depth validation, RFC 3339 deadline checks,
bounded retry policy validation, and redacted process errors without changing
the stable HK-CSP 1.0 wire format.
