# Migrating to HandoffKit 1.0.0

HandoffKit 1.0.0 is the first stable release. No breaking changes are expected
from 0.9.x.

## What Changed

- Package maturity is now `Development Status :: 5 - Production/Stable`.
- The public API listed in `docs/PUBLIC_API.md` is stable for the 1.x series.
- Workflow evaluation reports are available through `WorkflowEvaluator`.
- Async helpers are available on `Agent`, `Team`, and `RecipeRunner`.
- Built-in project templates are available through `TemplateScaffolder` and
  `handoffkit init`.

## Recommended Checks

```powershell
pip install -U handoffkit
handoffkit --version
handoffkit doctor
handoffkit api
```

## Compatibility Notes

- Existing sync calls such as `Agent.run()`, `Team.run()`, and
  `RecipeRunner.run()` continue to work.
- Existing validation calls keep returning the same success values or raising
  the same error types.
- Normal tests and demos stay offline by default.
