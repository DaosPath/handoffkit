# HandoffKit (Rust)

> **Status: under construction — not published to crates.io**

Rust package for **shared contract types** (`HandoffState`, `RunTrace`, and
related reports) using the same snake_case JSON wire format as Python and
JavaScript.

## What works today

- Core data structures and serde serialization
- Cross-runtime fixture parity tests (`cargo test`)

## What is not ready

- Full multi-agent runtime (Agent/Team execution loop)
- crates.io release
- Feature parity with Python/`@handoffkit/core`

## Roadmap

Python and JavaScript are the production runtimes. Rust will grow as a
first-class runtime **after** the Stable public API (see
`docs/python/PUBLIC_API.md`) is frozen and deprecation policy is in
force.

## Develop

```bash
cargo test --manifest-path packages/rust/Cargo.toml
```
