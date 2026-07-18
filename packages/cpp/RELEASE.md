# HandoffKit C++ release process

C++ does not use PyPI/npm **Trusted Publisher** directly. The trusted path is:

1. GitHub Release on tag `vX.Y.Z` (same monorepo release as Python/JS)
2. CI builds and attaches `handoffkit-cpp-X.Y.Z` source tarball + `SHA256SUMS`
3. **OIDC Artifact Attestations** on the tarball (`id-token: write`, `attestations: write`)
4. Consumers install via CMake FetchContent / `find_package` / Conan / vcpkg

No long-lived Conan or C++ registry API keys in the repository for the primary path.

## Comparison with other runtimes

| Artifact | Trigger | Auth |
|----------|---------|------|
| PyPI `handoffkit` | GitHub Release | Trusted Publisher OIDC |
| npm `@handoffkit/*` | GitHub Release | OIDC provenance (+ token today) |
| C++ tarball + attestation | GitHub Release | OIDC attestations (`actions/attest-build-provenance`) |
| Conan Center | PR after release | Human / Conan CI review |
| vcpkg port | PR after release | Human / Microsoft CI review |

## GitHub Actions wiring

Defined in `.github/workflows/publish.yml`:

| Job | When | What |
|-----|------|------|
| `quality-gate-cpp` | always on Publish workflow | cmake + ctest |
| `build-cpp-release-asset` | after quality gates | `package_source_tarball` → artifact |
| `publish-cpp-release-assets` | `release: published` only | attach assets + OIDC attestation |

Environment: `cpp-release` (optional protection rules).

Permissions on publish-cpp job:

- `contents: write` — upload release assets
- `id-token: write` — OIDC for attestations
- `attestations: write` — write provenance

## Local packaging

```powershell
cmake -S packages/cpp -B packages/cpp/build -DHANDOFFKIT_BUILD_TESTS=OFF -DHANDOFFKIT_BUILD_EXAMPLES=OFF
cmake --build packages/cpp/build --target package_source_tarball --config Release
# outputs: packages/cpp/build/handoffkit-cpp-<version>.tar.gz + SHA256SUMS
```

Or:

```powershell
pwsh packages/cpp/scripts/package_release.ps1
```

## Consumer install smoke (every PR / local)

CI runs this after `cmake --install`. Locally:

```powershell
pwsh packages/cpp/scripts/consumer_install_smoke.ps1
```

```bash
bash packages/cpp/scripts/consumer_install_smoke.sh
```

Must print `consumer_core OK` / `consumer_install_smoke OK` and link **`handoffkit::core`** only.

Reference app: `examples/consumer_core/`.

## Packaging checklist (maintainers)

### Every code change that ships

- [ ] `project(VERSION)` in `CMakeLists.txt` matches `version.hpp` and `conanfile.py`
- [ ] `cmake --build` + `ctest` green
- [ ] Contract fixtures still round-trip (all files under `packages/contracts/fixtures/`)
- [ ] `cmake --install` prefix is usable with `find_package(handoffkit CONFIG)`
- [ ] Consumer smoke: `examples/consumer_core` builds against the install prefix (`handoffkit::core`)

### Public C++ release asset

- [ ] Job packages self-contained tree (include, src, cmake, CMakeLists, LICENSE, README)
- [ ] Attach to GitHub Release; attestation via `actions/attest-build-provenance`
- [ ] Document `URL_HASH SHA256=...` for FetchContent (copy from release `SHA256SUMS`)
- [ ] Fill real `sha256` in `conandata.yml` for that version (replace the zero placeholder)
- [ ] Optional: open Conan Center Index PR
- [ ] Optional: open vcpkg port PR (template under `vcpkg-overlay/ports/handoffkit`)

### After first GitHub Release publishes `handoffkit-cpp-1.14.0.tar.gz`

1. Download `SHA256SUMS` from the release assets.
2. Put the hash into `conandata.yml` → `sources."1.14.0".sha256`.
3. Document FetchContent snippet in the release notes:

```cmake
include(FetchContent)
FetchContent_Declare(
  handoffkit
  URL https://github.com/DaosPath/handoffkit/releases/download/v1.14.0/handoffkit-cpp-1.14.0.tar.gz
  URL_HASH SHA256=<paste-from-SHA256SUMS>
)
# Prefer installing the tarball and find_package; or add_subdirectory after extract.
```

### Local Conan smoke

```bash
cd packages/cpp
conan create . --build=missing
```

### Verify attestation (after CI publishes assets)

```bash
gh attestation verify handoffkit-cpp-X.Y.Z.tar.gz --repo DaosPath/handoffkit
```

## Conan / vcpkg (in-repo readiness)

- **Conan:** `conanfile.py` + `test_package/` + `conandata.yml` (URL placeholders until first release asset)
- **vcpkg:** `vcpkg.json` + overlay port `vcpkg-overlay/ports/handoffkit/`

External PR merge is outside this monorepo's CI bar.

## CMake options

| Option | Default | Meaning |
|--------|---------|---------|
| `HANDOFFKIT_BUILD_TESTS` | ON | CTest targets |
| `HANDOFFKIT_BUILD_EXAMPLES` | ON | In-tree example binaries |
| `HANDOFFKIT_BUILD_DEMOS` | ON | `handoffkit_demos` (fusion + demo catalog); OFF = core-only install |
| `HANDOFFKIT_BUILD_CLI` | ON | `handoffkit-cli` (requires demos) |
| `HANDOFFKIT_FETCH_JSON` | ON | Fetch nlohmann_json if missing |
| `HANDOFFKIT_WITH_HTTP` | OFF | OpenAI-compatible HTTP provider (cpp-httplib) |

Installed targets: `handoffkit::core`, optional `handoffkit::demos`, interface `handoffkit::handoffkit`.

## Out of scope for early C++ releases

- Automatic push to Conan Center (PR-based)
- Automatic vcpkg upstream PR
- Live network LLM calls in CI
