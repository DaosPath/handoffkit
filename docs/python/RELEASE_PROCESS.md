# Release Process

HandoffKit releases use GitHub Actions CI and Trusted Publishing for PyPI, npm,
and crates.io. Production publishing is triggered by pushing a version tag such
as `vX.Y.Z` after every participating subsystem has passed its release gate.

## Trusted Publisher Setup

Configure the package indexes before publishing with the workflow:

| Registry | Owner | Repository | Workflow | Environment |
|---|---|---|---|---|
| TestPyPI | `DaosPath` | `handoffkit` | `publish.yml` | `handoffkit` |
| PyPI | `DaosPath` | `handoffkit` | `publish.yml` | `pypi` |
| npm `@handoffkit/*` | `DaosPath` | `handoffkit` | `publish.yml` | none |
| crates.io HandoffKit crates | `DaosPath` | `handoffkit` | `publish.yml` | none |

Do not store PyPI or npm publish tokens in files or GitHub Secrets. The workflow
uses GitHub OIDC through `pypa/gh-action-pypi-publish` for Python and an
OIDC-capable npm CLI for the public JavaScript packages (including `@handoffkit/browser`).
Rust publishing uses `rust-lang/crates-io-auth-action` and an ephemeral OIDC
token. Configure a Trusted Publisher independently for `handoffkit-contracts`,
`handoffkit-protocol`, `handoffkit-runtime`, `handoffkit-transport`,
`handoffkit-cli`, and `handoffkit` before each crate's first publication.

The npm job first creates the package archives with `pnpm pack`, preserving the
workspace dependency rewrites, and then publishes those `.tgz` files with
`npm publish` so npm Trusted Publishing performs the OIDC exchange.

npm Trusted Publishing is configured **per package**, not once for the entire
`@handoffkit` scope. Configure these package settings independently on
npmjs.com:

- `@handoffkit/core`
- `@handoffkit/csp`
- `@handoffkit/providers`
- `@handoffkit/templates`
- `@handoffkit/browser`
- `@handoffkit/recipes`
- `@handoffkit/node`
- `@handoffkit/cli`

For every package use GitHub Actions with organization/user `DaosPath`,
repository `handoffkit`, workflow filename `publish.yml`, no environment name,
and allow `npm publish`. These values are case-sensitive. A working Trusted
Publisher for `@handoffkit/core` does not authorize the other packages.

## Patch Release Checklist

1. Update version metadata only for participating products. Core subsystem
   releases may advance Rust without changing Python, JavaScript, Browser, C++,
   ML, or Fusion when those products are unchanged.
2. Move the root `Unreleased` notes under the new version and update the Python
   package changelog and README release summary.
3. Run local validation:

```powershell
pnpm ci:js

cargo fmt --manifest-path packages/rust/Cargo.toml --all --check
cargo clippy --manifest-path packages/rust/Cargo.toml --workspace --all-targets -- -D warnings
cargo test --manifest-path packages/rust/Cargo.toml --workspace

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
5. For a Rust-only subsystem release, do not create a global `vX.Y.Z` tag while
   Python, npm, or C++ remain on another version. After explicit approval, use
   `workflow_dispatch` with target `crates` and `release_version`; the crates job
   publishes only the Rust workspace in dependency order.
6. Optionally run the `Publish` workflow manually to publish the Python build to
   TestPyPI, then verify installation in a clean environment.
7. Create and push the annotated version tag only for an aligned monorepo
   release:

```powershell
git tag -a vX.Y.Z -m "HandoffKit X.Y.Z"
git push origin vX.Y.Z
```

8. The tag push automatically triggers:
   - PyPI Trusted Publishing for `handoffkit`.
   - npm Trusted Publishing for all eight `@handoffkit/*` packages, including
     `@handoffkit/csp` and `@handoffkit/browser`.
   - crates.io Trusted Publishing for contracts, protocol, runtime, transport,
     CLI, and the convenience crate in dependency order.
   - C++ source tarball construction, GitHub Release creation, asset upload, and
     OIDC provenance attestation.
9. Verify the published Python, npm, and Rust versions and inspect the C++
   release assets and checksums.
10. For a partial npm release, correct the affected package's Trusted Publisher,
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
