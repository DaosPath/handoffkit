# Contributing to HandoffKit

Thanks for helping improve HandoffKit. This project values **contract-first**
multi-agent workflows, **offline-friendly tests**, and **Python ↔ JS parity**.

## Before you start

1. Read `packages/python/docs/PUBLIC_API.md` (Stable vs Extended).
2. Read `packages/python/docs/DEPRECATION.md`.
3. For security-sensitive changes, read `packages/python/docs/THREAT_MODEL.md`.
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
- **Parity:** if you change a shared contract or media/tool API in Python, update
  JS in the same PR (`packages/js/*`).
- Add/adjust tests for new behavior.
- Do not commit `.local-tests/`, secrets, API keys, or private game assets.
- CI must be green (Ruff, tests, coverage gates on tools/validation).

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
