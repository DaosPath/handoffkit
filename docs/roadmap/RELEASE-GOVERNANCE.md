# Release and capability governance

Status: **planned policy for future release trains**.

## Evidence rule

A capability can advance beyond `planned` only when all applicable columns are
supported by concrete evidence:

| Column | Required evidence |
|---|---|
| declared | Public name, contract, scope, status, and failure behavior |
| implemented | Maintained provider or runtime code performs the operation |
| integrated | A supported product route invokes that code by default or through an explicit supported configuration |
| interoperability tested | Independent runtimes/providers complete the real route and agree on wire/error behavior |
| production ready | Packaging, upgrades, operations, security review, resource limits, supported-platform matrix, and failure recovery are qualified |

Enums, schemas, dataclasses, structs, documentation, fixtures, mocks, flags,
unused configuration, and isolated unit tests do not satisfy implementation or
integration.

## Mandatory release gates

Every participating product must pass the applicable gates before versioning:

1. **Runtime:** real positive path and structured fail-closed negative paths.
2. **Integration:** supported transport, application, worker, or extension route.
3. **Security:** identity, authorization, replay, resource bounds, unsafe-input,
   downgrade, and secret-handling review.
4. **Interoperability:** shared canonical fixtures plus real-process or real-
   socket tests between every claimed runtime pair.
5. **Recovery:** restart, reconnect, migration, corruption, rollback, and partial
   failure behavior for durable components.
6. **Performance:** reproducible environmental measurements with p50/p95/p99,
   throughput, memory, and explicit non-guarantee notice.
7. **Packaging:** build the final artifact, install it in a clean environment,
   read its version/metadata, and exercise a consumer.
8. **Documentation:** capability ledger, threat model, migration guide,
   changelog, supported platforms, and explicit unavailable items.
9. **CI:** final commit green; no skipped gate introduced by the release diff.
10. **Supply chain:** no embedded credentials, checksums/SBOM where applicable,
    provenance/attestation, and release artifact inventory.

## Versioning rules

- Change versions only after scope and affected-product inventory are final.
- Shared public wire changes require Python/JS parity and applicable Go/Rust/C++
  conformance in the same release train.
- Independent products may retain independent semver, but every product in a
  massive train must still be built, tested, packaged, and listed in the
  release manifest.
- A repository path move does not permit import, package, crate, module, CMake
  target, CLI, or wire-format breakage in a patch release.
- Breaking public names wait for a major release unless a compatibility facade
  and documented deprecation window preserve behavior.

## Massive release definition

A massive release is an aligned validation and artifact train, not permission
to publish unfinished features. It requires:

- one immutable source commit;
- an affected-product and version matrix;
- all package artifacts built from that commit;
- clean-environment installation for each ecosystem;
- cross-runtime conformance and end-to-end smoke routes;
- migration and rollback instructions;
- zero hidden fallback from an unavailable profile;
- explicit approval before tag or Publish.

## Capability detection

- Detect maintained providers at runtime/build time.
- Report `false` when unavailable.
- Reject explicit unavailable profiles with a structured error.
- Never silently downgrade to another security, browser, storage, or compute
  provider.
- UI and Studio display only reported runtime facts, never roadmap intent.

## Roadmap review gate

At the end of each version range:

1. compare roadmap claims with executable paths;
2. move unsupported items forward or mark them unavailable;
3. record measured compatibility and operational gaps;
4. update the next range before implementation begins;
5. do not backfill a success label from documentation alone.
