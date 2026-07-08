# HandoffKit

Structured state transfer for multi-agent workflows.

This repository is a monorepo:

```text
handoffkit/
  packages/
    python/          # Python package published to PyPI as handoffkit
    core/            # JavaScript contract package: @handoffkit/core
  apps/
    web/             # Next.js demo and docs workspace
  package.json       # pnpm workspace commands
```

## Python Package

The published Python package lives in [`packages/python`](packages/python).

Common commands from repo root:

```bash
pnpm python:install
pnpm python:lint
pnpm python:test
pnpm python:build
pnpm python:twine
```

Direct Python workflow:

```bash
cd packages/python
pip install -e ".[dev]"
pytest -q
python -m build
python -m twine check dist/*
```

## Web App

The Next.js showcase app lives in [`apps/web`](apps/web).

```bash
pnpm install
pnpm web:dev
pnpm web:lint
pnpm web:build
```

## JavaScript Core

The JavaScript/TypeScript contract package lives in [`packages/core`](packages/core).
It includes offline agents/teams, async runs, tool schema adapters, traces, and
report helpers for Next.js and Node apps.

```bash
pnpm core:check
pnpm core:test
```

## Package README

Full PyPI/GitHub package documentation:

- [`packages/python/README.md`](packages/python/README.md)
- [`packages/python/CHANGELOG.md`](packages/python/CHANGELOG.md)
- [`packages/python/docs`](packages/python/docs)

## Local Artifacts

Keep smoke tests, benchmark caches, temporary virtualenvs, and generated logs inside:

```text
.local-tests/
```

Do not commit `.local-tests/`, `.cache/`, `dist/`, `build/`, `*.egg-info`,
generated live benchmark logs, or API keys.

## License

MIT. See [`LICENSE`](LICENSE).
