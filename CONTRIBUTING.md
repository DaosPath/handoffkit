# Contributing to HandoffKit

Thanks for helping improve HandoffKit. This project values **contract-first**
multi-agent workflows, **offline-friendly tests**, and **Python ↔ JS parity**.

## Before you start

1. Read `docs/python/PUBLIC_API.md` (Stable vs Extended).
2. Read `docs/python/DEPRECATION.md`.
3. For security-sensitive changes, read `docs/python/THREAT_MODEL.md`.
4. Follow monorepo rules in local `AGENTS.md` when present (workspace layout,
   keep public samples PG-rated; never commit private game assets or secrets).

## Development setup

```bash
# Python
cd packages/python
python -m pip install -e ".[dev]"
ruff check --no-cache .
pytest -q

# JavaScript
pnpm install
pnpm js:check
pnpm js:test
```

## Pull requests

- Keep changes focused; prefer small PRs.
- Add every user-visible change to the appropriate changelog under `Unreleased`
  in the same PR. Use a subsystem changelog for detailed engineering history
  and the root `CHANGELOG.md` for concise monorepo/release impact.
- Fusion changes belong in `docs/cpp/fusion/CHANGELOG.md`; summarize them in
  the root changelog only when they affect users, packaging, compatibility, or
  release notes.
- Changelog entries must explain user impact. Benchmark claims must name the
  provider, model, conditions, and whether the result is local or official.
- **Parity:** if you change a shared contract or media/tool API in Python, update
  JS in the same PR (`packages/js/*`).
- Add/adjust tests for new behavior.
- Do not commit `.local-tests/`, secrets, API keys, or private game assets.
- CI must be green (Ruff, tests, coverage gates on tools/validation).

## Changelog workflow

1. Identify the owning changelog. For Fusion, use
   `docs/cpp/fusion/CHANGELOG.md`; otherwise use the relevant package or
   subsystem changelog when one exists.
2. Add the detailed entry under `Unreleased` while implementing the change.
3. Add a concise root `CHANGELOG.md` entry only when the change has
   monorepo/release-level user impact.
4. Use the most relevant heading: `Added`, `Changed`, `Fixed`, `Performance`,
   `Security`, `Deprecated`, `Removed`, or `Validation`.
5. State what users can now do, what changed, or what failure was corrected.
6. At release time, move entries to `## [x.y.z] - YYYY-MM-DD` and recreate an
   empty `Unreleased` section in each changelog being released.

Pure formatting, comments, or internal refactors with no observable effect may
be marked as not requiring a changelog entry in the pull request template.

## Issues

- Use clear titles: `bug:`, `feat:`, `docs:`, `security:`.
- Include reproduction steps and package versions.
- Security vulnerabilities: follow `SECURITY.md` (do not open public issues for
  exploitable bugs before disclosure).

## Maintainers

HandoffKit aims for **at least two maintainers** for review coverage and release
hygiene. Until a second maintainer is onboarded, releases require green CI and
explicit human approval of Publish/GitHub Release.

## Code of conduct

Be respectful. No harassment. Assume good intent; require evidence for claims
about security or benchmarks.
