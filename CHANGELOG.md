# Changelog

All notable changes to the HandoffKit monorepo are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
HandoffKit uses semantic versioning for published releases. Subsystem changelogs
contain deeper engineering history; this root file remains the concise public
release summary.

## [Unreleased]

### Added

- Added the native C++ Fusion tier system: Lite, Medium, Pro, Ultra, and Genius,
  with configurable prompts, role packs, generation policy, structured
  handoffs, persistence, cache, panels, web context, and bounded DAG
  parallelism.
- Added complete Fusion documentation and a dedicated subsystem history:
  [Fusion architecture](docs/cpp/fusion/README.md) and
  [Fusion changelog](docs/cpp/fusion/CHANGELOG.md).

### Changed

- Centralized long-form runtime documentation under `docs/cpp`, `docs/python`,
  `docs/js`, and `docs/rust`, with a demo index for every runtime.
- Fusion Genius now uses six architect branches, merge, and final meta-judge
  refinement for eight planned calls.
- Loaded Fusion configuration remains authoritative unless the corresponding
  CLI option is explicitly supplied.

### Performance

- Ultra and Genius can execute independent DAG branches concurrently with a
  configurable limit. Local engineering measurements and conditions are
  recorded in the Fusion-specific changelog.

### Fixed

- Corrected Fusion configuration precedence, output-path overrides, reasoning
  cache isolation, merge-only generation settings, and truncated
  reasoning-only OpenAI-compatible responses.
- Corrected stale Debug assumptions in Fusion corpus, scenario, tier, and
  request-shape tests.

### Validation

- The dedicated Fusion Debug suites, base/deep scenarios, and CLI precedence
  checks pass. Detailed counts and local measurements are recorded in
  [Fusion changelog](docs/cpp/fusion/CHANGELOG.md).

## Changelog rules

- Add every user-visible feature, behavior change, performance improvement,
  compatibility change, deprecation, removal, security change, and meaningful
  bug fix to **Unreleased** in the same change that implements it.
- Keep this root changelog concise and release-oriented. Put subsystem-specific
  implementation history in that subsystem's changelog and link it here when
  the change affects users or releases.
- Use the sections `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`,
  `Security`, `Performance`, and `Validation` as applicable.
- Describe user impact and observable behavior, not only internal file changes.
- Include benchmark numbers only with the provider, model, conditions, and a
  clear statement of whether the result is local, reproducible, or official.
- At release time, move Unreleased entries under a versioned heading with an
  ISO date, then create a fresh Unreleased section.

## Subsystem and historical changelogs

- Fusion subsystem history: [`docs/cpp/fusion/CHANGELOG.md`](docs/cpp/fusion/CHANGELOG.md)
- Python package release history: [`packages/python/CHANGELOG.md`](packages/python/CHANGELOG.md)
- C++ release process and packaging notes: [`packages/cpp/RELEASE.md`](packages/cpp/RELEASE.md)
