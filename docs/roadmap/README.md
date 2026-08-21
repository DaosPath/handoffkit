# HandoffKit version roadmap

Status: **planning only**. A roadmap entry, manifest, interface, schema, fixture,
or package name is not evidence that a capability exists.

## Current release state

HandoffKit 1.19 is not complete as a public release. The current branch is a
green development baseline with experimental and release-candidate security
paths. The remaining release decision is **Result B** until the 1.19.5 gates
are closed or explicitly removed from public scope.

The authoritative current capability ledger remains
[`HK_CSP_SECURITY.md`](../spec/HK_CSP_SECURITY.md). Future documents in this
directory must never override runtime evidence in that ledger.

The current evidence matrix is
[`1.19.0-FINAL-CLOSURE-REPORT.md`](./1.19.0-FINAL-CLOSURE-REPORT.md). The
earlier [`1.19.0-FINAL-AUDIT.md`](./1.19.0-FINAL-AUDIT.md) is retained as
history; the closure report supersedes stale capability wording and reports
declared, implemented, integrated, interoperability-tested, and
production-ready state without turning the baseline into a release claim.

## Planned release train

| Version range | Theme | Planned outcome |
|---|---|---|
| [1.19.5](./1.19.5-MASS-RELEASE.md) | Monorepo convergence | Massive, aligned package train after repository reorganization and release closure |
| [1.20](./1.20-BROWSER-PLATFORM.md) | Browser platform | Single 1.20 train: Core, Lite, Real, index, grounding, Studio, Hermes. Absorbs the former 1.20–1.29 split. Stays beta until every dimension is ≥9/10. |
| [1.20 Clinical Lab](./1.20-CLINICAL-LAB.md) | Sequential diagnosis lab | Experimental predefined-case sandbox. Clinical validity, official 897 run, live providers, and live retrieval remain unavailable. Not clinically validated. |
| [1.30-1.39](./1.30-1.39-APP-RUNTIME.md) | App runtime | Permissioned app manifests, isolated hosts, SDKs, Studio shell, lifecycle, and conformance |
| [1.40-1.49](./1.40-1.49-EXTENSION-ECOSYSTEM.md) | Extensions and complements | Provider, connector, tool, worker, UI-panel, recipe, template, and demo bundles |
| [1.50-1.59](./1.50-1.59-NATIVE-EDGE-ML.md) | Native, edge, and ML | Durable native workers, accelerator providers, media jobs, edge resilience, and multi-arch builds |
| [1.60-1.69](./1.60-1.69-DISTRIBUTED-PLATFORM.md) | Distributed platform | Federated trust, scheduling, replicated state, artifacts, observability, quota, and recovery |
| [1.70](./1.70-LTS.md) | LTS convergence | Compatibility freeze and evidence-based stable platform release |

Supporting plans:

- [Repository reorganization](./REPOSITORY-REORGANIZATION.md)
- [Release and capability governance](./RELEASE-GOVERNANCE.md)
- [Browser Real threat model](./1.20-BROWSER-REAL-THREAT-MODEL.md)

## Dependency order

```text
1.19 development baseline
  -> 1.19.5 release closure + repository convergence
  -> 1.20 browser platform (absorbs former 1.20-1.29)
  -> 1.30-1.39 app runtime
  -> 1.40-1.49 extension ecosystem
  -> 1.50-1.59 native/edge/ML
  -> 1.60-1.69 distributed platform
  -> 1.70 LTS
```

Later ranges may be replanned when evidence from the previous range changes the
architecture. Version numbers express dependency order, not calendar dates.

## Status vocabulary

| Status | Meaning |
|---|---|
| planned | Documented intent only; no implementation claim |
| experimental | Real execution path plus integration tests, but no production-readiness claim |
| provider-dependent | Real only when a detected maintained provider satisfies the documented gate |
| stable | Shipped runtime path, interoperability evidence, packaging, upgrade policy, and operational qualification |
| unavailable | Deliberately rejected at runtime; no fallback or documentation claim |

## Product rules

- Public cross-runtime contracts retain canonical `snake_case` wire JSON.
- Browser-safe packages contain contracts and policy only when platform I/O is
  unavailable.
- A compatibility facade may preserve existing imports during a migration, but
  it must not claim a backend that is absent.
- Every release range has explicit non-goals. Unfinished items move forward;
  tests and security policy are never weakened to preserve a version date.
- No tag or publication follows automatically from completing a roadmap file.
