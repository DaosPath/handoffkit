# Deprecation Policy

HandoffKit follows a predictable deprecation process for the **1.x** series.

## Principles

1. **No silent breaks** for APIs listed as **Stable** in `PUBLIC_API.md`.
2. **Prefer additive changes** over renames; use aliases when renaming.
3. **Document early** — deprecations appear in CHANGELOG and this file.

## Timeline

| Stage | Meaning |
|-------|---------|
| **Deprecated** | Still works; emits `DeprecationWarning` (Python) or docs note (JS). |
| **Soft removal target** | Earliest minor after **two** published minors, or next major. |
| **Removed** | Only in a **major** version (`2.0.0`) unless the API was Experimental. |

Example: deprecated in `1.14.0` → still present through `1.15` / `1.16` → may remove in `2.0.0`.

## API tiers (P1)

### Stable (hard compatibility)

Core workflow contracts and execution primitives listed under **Stable** in
`PUBLIC_API.md` (Agent, Team, HandoffState, Tool*, validation, traces, etc.).

### Extended (soft compatibility)

Media context handoffs, showcase helpers, CLI convenience functions, benchmarks.
We avoid breaks, but may rename with aliases more aggressively.

### Experimental

Provider-specific integrations, Studio web APIs, optional native packages
(Rust/C++ runtime). May change without a major bump; marked in docs.

## How we deprecate (Python)

```python
import warnings

def old_name(...):
    warnings.warn(
        "old_name is deprecated; use new_name instead",
        DeprecationWarning,
        stacklevel=2,
    )
    return new_name(...)
```

## How we deprecate (JavaScript)

- Keep the old export.
- JSDoc `@deprecated` on the old symbol.
- Re-export new name; document in CHANGELOG.

## Release cadence (P1)

- Prefer **fewer, larger minors** with consolidated changelogs over rapid
  micro-releases.
- Security / P0 fixes may ship as **patch** releases outside the cadence.
- Publish only from green CI (`quality-gate` for Python + JS check/test).
