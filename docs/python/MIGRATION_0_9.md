# Migrating to HandoffKit 0.9.0

0.9.0 is a stabilization release. No breaking changes are expected from 0.8.x.

## What Changed

- Package metadata now marks HandoffKit as beta.
- Public API candidates are documented in `docs/python/PUBLIC_API.md`.
- Compatibility policy is documented in `docs/python/COMPATIBILITY.md`.
- Provider tool-call parsing reports clearer errors for malformed payloads.
- Public API imports and signatures are covered by compatibility tests.

## What Did Not Change

- `HandoffState.validate()` still returns `self` or raises `HandoffValidationError`.
- `StructuredOutputSchema.validate()` still returns the input dictionary or raises
  `OutputValidationError`.
- `Agent.run_with_tools()` keeps existing modes and provider adapter behavior.
- `RecipeRunner.run()` keeps its existing call shape.
- Trace and replay still never re-execute providers, tools, shell commands, or
  file writes.

## Recommended Upgrade Check

```powershell
pip install --upgrade handoffkit
handoffkit doctor
handoffkit api
python -c "from handoffkit import Agent, Team, RunTrace, ReplayRunner; print('OK')"
```
