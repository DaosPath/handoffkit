## Summary

Describe what changed and why.

## User-visible impact

Explain the behavior, API, performance, compatibility, or documentation impact.
Write `None` only when the change is entirely internal.

## Validation

List the tests, benchmarks, or manual checks performed.

## Changelog

- [ ] Added or updated the appropriate subsystem/package changelog under
      `Unreleased`.
- [ ] Added a concise root `CHANGELOG.md` entry when the change has
      monorepo/release-level user impact.
- [ ] Marked as not required because this change has no user-visible impact.
- [ ] Benchmark claims include provider, model, conditions, and whether the
      result is local or official.

## Checklist

- [ ] Tests added or updated for changed behavior.
- [ ] Shared contracts remain compatible across affected runtimes.
- [ ] No secrets, private assets, or `.local-tests/` artifacts are included.
- [ ] Documentation and examples match the implemented behavior.
