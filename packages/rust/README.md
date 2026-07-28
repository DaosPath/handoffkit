# HandoffKit Rust

Independent Rust crates. No Python runtime required.

## HandoffKit 1.16

- `handoffkit-contracts`: workflow, tool, trace, validation, and report contracts.
- `handoffkit-protocol`: lightweight HK-CSP wire contracts and version negotiation.
- `handoffkit`: convenience facade re-exporting both layers.

The 1.16 contracts/protocol crates intentionally contain no Tokio or network stack. Runtime,
transport, browser, and CLI crates are scheduled for 1.17 after cross-runtime wire fixtures are
stable.

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```
