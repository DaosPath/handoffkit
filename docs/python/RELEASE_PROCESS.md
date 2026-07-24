# Release Process

HandoffKit releases use GitHub Actions CI and Trusted Publishing for both PyPI
and the public npm packages. Production publishing is triggered by pushing a
version tag such as `v1.14.2`.

## Trusted Publisher Setup

Configure the package indexes before publishing with the workflow:

| Registry | Owner | Repository | Workflow | Environment |
|---|---|---|---|---|
| TestPyPI | `DaosPath` | `handoffkit` | `publish.yml` | `handoffkit` |
| PyPI | `DaosPath` | `handoffkit` | `publish.yml` | `pypi` |
| npm `@handoffkit/*` | `DaosPath` | `handoffkit` | `publish.yml` | none |

Do not store PyPI or npm publish tokens in files or GitHub Secrets. The workflow
uses GitHub OIDC through `pypa/gh-action-pypi-publish` for Python and an
OIDC-capable npm CLI for the six public JavaScript packages.

The npm job first creates the package archives with `pnpm pack`, preserving the
workspace dependency rewrites, and then publishes those `.tgz` files with
`npm publish` so npm Trusted Publishing performs the OIDC exchange.

npm Trusted Publishing is configured **per package**, not once for the entire
`@handoffkit` scope. Configure these six package settings independently on
npmjs.com:

- `@handoffkit/core`
- `@handoffkit/providers`
- `@handoffkit/templates`
- `@handoffkit/recipes`
- `@handoffkit/node`
- `@handoffkit/cli`

For every package use GitHub Actions with organization/user `DaosPath`,
repository `handoffkit`, workflow filename `publish.yml`, no environment name,
and allow `npm publish`. These values are case-sensitive. A working Trusted
Publisher for `@handoffkit/core` does not authorize the other five packages.

## Patch Release Checklist

1. Update aligned version metadata for Python, JavaScript, and C++.
2. Move the root `Unreleased` notes under the new version and update the Python
   package changelog and README release summary.
3. Run local validation:

```powershell
pnpm ci:js

cd packages/python
ruff check --no-cache .
pytest -q
python -m build
python -m twine check dist/*

cd ../cpp
cmake -S . -B build-release -DCMAKE_BUILD_TYPE=Release -DHANDOFFKIT_WITH_HTTP=OFF
cmake --build build-release --config Release
ctest --test-dir build-release -C Release --output-on-failure
```

4. Commit only the intended release files and push `main`.
5. Optionally run the `Publish` workflow manually to publish the Python build to
   TestPyPI, then verify installation in a clean environment.
6. Create and push the annotated version tag:

```powershell
git tag -a vX.Y.Z -m "HandoffKit X.Y.Z"
git push origin vX.Y.Z
```

7. The tag push automatically triggers:
   - PyPI Trusted Publishing for `handoffkit`.
   - npm Trusted Publishing for all six `@handoffkit/*` packages.
   - C++ source tarball construction, GitHub Release creation, asset upload, and
     OIDC provenance attestation.
8. Verify the published Python and npm versions and inspect the C++ release
   assets and checksums.
9. For a partial npm release, correct the affected package's Trusted Publisher,
   then run `Publish` manually with target `npm` and the existing
   `release_version`. The workflow skips package versions that are already
   public and retries every package independently.

## Notes

- HandoffKit 1.0.0 was uploaded manually with `twine`. Later releases use
  Trusted Publishing.
- Trusted Publishing authenticates only during the CI publish operation, so a
  local `npm whoami` result is not relevant to the release job.
- The workflow installs an npm CLI version with OIDC support and grants only
  `id-token: write` plus the minimum repository permissions required by each
  job.
