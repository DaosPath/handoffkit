# packages/python layout

Keep this package tidy: **library vs demos vs local output**.

```
packages/python/
  handoffkit/                 # installable library (import handoffkit)
  tests/                      # unit/integration tests (pytest)
  tests_api/                  # optional live-API tests
  examples/
    demos/                    # product showcase scripts
    integrations/             # third-party stack examples
    fixtures/
      reports/                # golden showcase reports (versioned)
    output/                   # generated demo files (gitignored)
  scripts/                    # maintainer utilities
  reports/                    # local CLI/benchmark output only (gitignored)
  runs/                       # local run traces (gitignored)
  pyproject.toml
  README.md
  CHANGELOG.md
  LICENSE
  MANIFEST.in
```

Long-form Python documentation lives at [`docs/python/`](../../docs/python/).
The runnable demo index lives at [`docs/python/demos/`](../../docs/python/demos/).

## Rules

| Path | In git? | Purpose |
|------|---------|---------|
| `handoffkit/` | yes | Public API / runtime |
| `tests/` | yes | CI |
| `examples/demos/`, `examples/integrations/` | yes | Demos / integrations |
| `examples/fixtures/reports/` | yes | Frozen gallery / docs links |
| `examples/output/` | no | Generated sample projects |
| `reports/` | no (except optional README) | Default CLI `--output reports` |
| `runs/` | no | Transient traces |
| `build/`, `dist/`, `*.egg-info/`, `__pycache__/` | no | Build noise |

## Public API

Do **not** reorganize imports under `handoffkit/` without a deprecation cycle.
`handoffkit/__init__.py` is the stable surface.

## CLI output

Commands still default to writing under `reports/` (cwd-relative when you run from
`packages/python`). That directory is local-only; copy into
`examples/fixtures/reports/` only when intentionally refreshing a golden report.
