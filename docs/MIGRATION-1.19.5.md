# HandoffKit 1.19.5 migration guide (pre-reorganization tree)

This guide covers the 1.19.5 repository reorganization. Public package names,
imports, wire contracts, and runtime behavior are unchanged; only source-tree
paths moved.

## What changed

History-preserving `git mv` moves only. No public API redesign happened in
this train.

| Old path | New path |
|---|---|
| `packages/python` | `python/packages/handoffkit` |
| `packages/localize` | `python/packages/handoffkit-localize` |
| `packages/js/<pkg>` | `js/packages/<pkg>` |
| `packages/rust` | `rust` |
| `packages/go` | `go/handoffkit` |
| `packages/cpp` | `cpp/packages/handoffkit` |
| `packages/cpp-ml` | `cpp/packages/handoffkit-ml` |
| `packages/contracts` | `shared/contracts` |
| `apps/web` | `apps/studio-web` |
| `benchmarks` | `validation/benchmarks` |

## What did NOT change

- Python imports: still `handoffkit.*`; PyPI name still `handoffkit`.
- npm names: still `@handoffkit/{core,csp,providers,node,browser,recipes,templates,cli}`.
- Rust crate names: unchanged (`handoffkit`, `handoffkit-cli`, …).
- Go module path: still `github.com/DaosPath/handoffkit/go`.
- C++ namespaces and CMake target names: unchanged.
- HK-CSP wire version: still `1.0`; canonical snake_case JSON unchanged.

## For consumers of published artifacts

Nothing to do. Install from PyPI/npm/crates.io as before. Published artifacts
never referenced repository-relative paths.

## For monorepo contributors

- pnpm workspace globs moved to `js/packages/*`.
- Cargo workspace lives at `rust/Cargo.toml`.
- Go module commands run from `go/handoffkit`.
- CMake configure uses `-S cpp/packages/handoffkit` (core) and
  `-S cpp/packages/handoffkit-ml` (ML).
- Shared contract fixtures live under `shared/contracts/…`; tests in every
  language resolve them relative to the repo root.
- CI workflow paths were updated in the same commits; no compatibility shims
  remain after validation.
- The machine-readable inventory lives at
  `docs/roadmap/repository-path-map.json` (`wave-5-validation` phase).

## Rollback

Reorganize-only history means `git checkout v1.18.0 -- .` restores the
previous layout without data migration. No state stores, databases, or on-disk
formats moved.
