# HandoffKit Compatibility

## Python Versions

HandoffKit supports Python 3.10, 3.11, 3.12, 3.13, and 3.14. CI runs the full
test, lint, build, and package metadata checks across that matrix.

## Runtime Dependencies

The core package has no runtime dependencies. Development extras install test,
lint, build, and package validation tools only.

## Offline Test Policy

Normal tests and demos run offline by default using deterministic local
providers. Real provider tests must remain opt-in and require explicit
environment variables.

## Provider Policy

Provider adapters normalize tool schemas and tool-call payloads without requiring
external SDKs. Malformed provider payloads should fail with clear local
validation errors.

## Package Policy

Every release candidate should pass:

```powershell
ruff check --no-cache .
pytest -q
python -m build
python -m twine check dist/*
```
