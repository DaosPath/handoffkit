# Release Process

HandoffKit releases use GitHub Actions CI for validation and PyPI Trusted
Publishing for uploads.

## Trusted Publisher Setup

Configure both package indexes before publishing with the workflow:

| Index | Owner | Repository | Workflow | Environment |
|---|---|---|---|---|
| TestPyPI | `DaosPath` | `handoffkit` | `publish.yml` | `handoffkit` |
| PyPI | `DaosPath` | `handoffkit` | `publish.yml` | `pypi` |

Do not store PyPI package tokens in files or GitHub Secrets. The publish
workflow uses GitHub OIDC through `pypa/gh-action-pypi-publish`.

## Patch Release Checklist

1. Update version metadata in `pyproject.toml` and `handoffkit/__init__.py`.
2. Update `CHANGELOG.md` and README release notes.
3. Run local validation:

```powershell
cd packages/python
ruff check --no-cache .
pytest -q
python -m build
python -m twine check dist/*
```

4. Create a release branch:

```powershell
git checkout -b release/X.Y.Z
git add .github .gitignore README.md package.json pnpm-lock.yaml pnpm-workspace.yaml apps packages
git commit -m "Prepare HandoffKit X.Y.Z"
git push -u origin release/X.Y.Z
```

5. Wait for CI to pass on the release branch.
6. Merge the release branch into `main`.
7. Push `main`.
8. Create and push the version tag (e.g. `vX.Y.Z`).
9. Run the `Publish` workflow manually to publish the Python package to TestPyPI.
10. Verify installation from TestPyPI in a clean environment.
11. Publish the GitHub Release. This automatically triggers:
    - PyPI Trusted Publishing for `handoffkit` (Python).
    - NPM publishing with OIDC provenance for `@handoffkit/core` and `@handoffkit/node` (JS/TS), using the repository secret `NPM_TOKEN`.
12. Verify installation from both PyPI and npm in clean environments.

## Notes

- HandoffKit 1.0.0 was uploaded manually with `twine`. HandoffKit 1.0.1 and later are prepared for Trusted Publishing.
- The npm packages use GitHub OIDC provenance linked to the publish workflow, but still require the `NPM_TOKEN` secret to be set up under repository Secrets in GitHub.
