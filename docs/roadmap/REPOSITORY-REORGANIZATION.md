# Repository reorganization plan

Status: **planned for the 1.19.5 train**. No path below exists merely because it
appears in this document.

## Goals

- Put each language ecosystem at the repository root.
- Give every language consistent `packages`, `demos`, `extensions`, and `tests`
  ownership where applicable.
- Separate shared contracts from implementations.
- Keep applications, cross-runtime demos, documentation, validation, and build
  tooling easy to find.
- Preserve all public package/import/crate/module/CMake/CLI names during 1.19.5.

## Proposed target tree

```text
handoffkit/
  python/
    packages/
      handoffkit/
      handoffkit-localize/
    demos/
    extensions/
    tests/
  js/
    packages/
      core/
      csp/
      node/
      browser/
      providers/
      recipes/
      templates/
      cli/
    demos/
    extensions/
    tests/
  rust/
    crates/
    demos/
    extensions/
    fuzz/
  go/
    handoffkit/
    commands/
    demos/
    extensions/
  cpp/
    packages/
      handoffkit/
      handoffkit-ml/
    demos/
    extensions/
    tests/
  shared/
    contracts/
    schemas/
    fixtures/
    test-vectors/
  apps/
    studio-web/
    media-studio/
  demos/
    cross-runtime/
  validation/
    benchmarks/
    conformance/
    packaging/
  docs/
  tools/
  scripts/
  .github/
```

Names may be adjusted by an architecture decision record before moves begin,
but the language-first ownership model is fixed for this plan.

The 1.19.5 move keeps the current browser package intact. It does not pre-create
empty Core/Lite/Real packages; that functional split belongs to the 1.20-1.29
[Browser Platform plan](./1.20-1.29-BROWSER-PLATFORM.md).

## Current-to-target map

| Current path | Planned path |
|---|---|
| `packages/python` | `python/packages/handoffkit` |
| `packages/localize` | `python/packages/handoffkit-localize` |
| `packages/js/*` | `js/packages/*` |
| `packages/rust` | `rust` |
| `packages/go` | `go/handoffkit` plus `go/commands` where split |
| `packages/cpp` | `cpp/packages/handoffkit` |
| `packages/cpp-ml` | `cpp/packages/handoffkit-ml` |
| `packages/contracts` | `shared/contracts` with schemas/fixtures/test vectors separated by role |
| language-specific `examples` | owning language `demos` |
| root cross-runtime examples | `demos/cross-runtime` |
| root `benchmarks` | `validation/benchmarks` |
| `apps/web` | `apps/studio-web` |
| `apps/media-studio` | unchanged unless its manifest requires normalization |

## Ownership rules

- `packages`: publishable or reusable runtime libraries.
- `demos`: executable examples; never required by core package import/install.
- `extensions`: optional providers, connectors, adapters, workers, or UI panels.
- `tests`: ecosystem-specific tests that do not belong beside a package.
- `shared`: wire contracts and language-neutral fixtures only; no runtime code.
- `validation`: cross-runtime conformance, benchmarks, package consumers, and
  release evidence.
- `apps`: end-user applications; they consume packages and never become a
  hidden runtime dependency.

## Migration waves

### Wave 0 - inventory and freeze

- Freeze feature merges and record the complete tracked tree.
- Map every manifest, workspace member, CI path, publish path, docs link,
  generated artifact, and ignored build directory.
- Add a machine-readable path map and forbidden-old-path audit.

The current inventory is machine-readable at
[`repository-path-map.json`](./repository-path-map.json). The
`workspace:paths` gate validates that every current path exists. It is not a
migration claim and does not permit packages to read from the future target
paths; the forbidden-old-path audit remains a post-move gate.

### Wave 1 - shared assets

- Move contracts, schemas, fixtures, and test vectors first.
- Keep canonical fixture identifiers stable.
- Update all five runtimes in one commit series and run conformance after each
  logical move.

### Wave 2 - language roots

- Move one language at a time using history-preserving renames.
- Update only paths and build configuration in that wave.
- Re-run that ecosystem's complete test/package/install gate before the next
  language moves.

### Wave 3 - demos and extensions

- Move demos out of publishable cores.
- Prove every core package builds with demos disabled or absent.
- Classify optional integrations under `extensions`; do not create empty
  packages that claim future support.

### Wave 4 - applications and validation

- Move Studio web path with route and deployment compatibility.
- Centralize cross-runtime benchmarks/conformance without changing wire data.
- Update local-test rules so generated artifacts remain inside ignored paths.

### Wave 5 - release tooling

- Update pnpm workspace, Cargo workspace, Go module commands, CMake install,
  Python build, release scripts, coverage, code scanning, and workflows.
- Build all final artifacts from a clean clone.
- Remove compatibility paths only after no artifact or workflow reads them.

## Invariants

- Python imports remain `handoffkit.*`.
- npm names remain `@handoffkit/*`.
- Rust crate names remain unchanged.
- Go public module/import paths remain compatible.
- C++ namespaces and installed CMake targets remain unchanged.
- HK-CSP wire version and canonical JSON remain unchanged.
- Published artifacts contain no repository-relative runtime dependency.
- `pnpm` remains the JavaScript package manager.

## Validation gates

- clean clone bootstrap on Windows and Linux;
- full CI plus native ARM64;
- package and install every product;
- scan built archives for old paths, symlinks, secrets, build outputs, and
  accidental demos;
- verify docs links and examples;
- compare public API/export manifests before and after;
- consumer projects compile/run without knowing source-tree layout;
- rollback rehearsal to the pre-move tag/commit without data migration loss.

## Risks and controls

| Risk | Control |
|---|---|
| history becomes unreadable | pure move commits before content changes |
| package imports break | artifact install/consumer tests, not source-tree imports |
| CI misses a runtime | machine-readable participating-product matrix |
| old paths survive secretly | forbidden-old-path scan after clean build |
| release mixes reorganization and new APIs | feature freeze until 1.19.5 is cut |
| local artifacts become tracked | preserve `.local-tests` and generated-output ignore rules |
