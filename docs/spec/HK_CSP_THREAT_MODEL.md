# HK-CSP threat model and implementation boundary (HandoffKit 1.19 development)

This document separates implemented controls from remaining release work. The
authoritative runtime-by-runtime status is `HK_CSP_SECURITY.md`.

## Assets and adversaries

Protected assets include in-flight envelopes, jobs, tool requests, artifacts,
model checkpoints, peer identities, authorization grants, durable state, and
private credentials. Relevant adversaries include network attackers,
unauthenticated clients, compromised authenticated workers, stale/revoked
credentials, malicious artifact producers, and local processes able to modify
weakly protected files.

## Trust boundaries

| Boundary | Implemented control and residual risk |
|---|---|
| Python/Node/Go/Rust TCP | Real TLS 1.3 and mTLS paths authenticate certificates and hostnames. The profiles remain experimental; C++ has no TLS backend. |
| Framing/decoding | Stable size/depth/version validation precedes authentication-sensitive dispatch. |
| Profile selection | Exact, fail-closed selection and an additive authenticated TLS endpoint transcript are integrated in Python, Node, Go, and Rust secure framed paths. C++ has no TLS path. |
| Peer identity | Four secure runtimes derive identity from verified certificate SAN/fingerprint and compare all declared claims. Local policy supplies capabilities. |
| Authorization | Four secure receive paths authorize locally after authentication and replay checks. |
| Replay | Peer/session/credential nonce, sequence, and timestamp checks are mandatory. Optional durable backends in all four secure runtimes survive listener restart and quarantine invalid state. |
| Durable state | Cryptographic replay is durable when configured. The Go ML gateway durably stores idempotency and terminal results, and marks in-flight jobs interrupted after restart. General session/queue recovery and automatic job resumption remain unavailable. |
| Native execution | The C++ bounded jthread worker and cpp-ml job path are real and concurrently tested. Remote access uses the maintained Go TLS sidecar; C++ does not claim TLS. |
| Artifact provenance | Maintained Ed25519 providers verify a shared vector. Go/C++ snapshot gates are mandatory on the remote cpp-ml route, but unrelated consumers are not yet universally gated. |
| Keys/credentials | Python/Node development file stores check lifecycle/path/POSIX permissions. Four TLS runtimes support tested credential/trust reload; OS keystores, CRL/OCSP, and zeroization guarantees remain absent. |
| Hybrid TLS | Compatible Node and Go providers prove X25519MLKEM768 handshakes, including Node 24 to Go 1.26 mTLS interoperability. Other providers fail closed and report unavailable. |
| Edge deployment | Profiles apply bounded runtime limits. A native ARM64 CI job is configured but has not yet completed for this branch; no ARM64 or unstable-network deployment guarantee follows. |
| Studio visibility | The optional Go gateway emits a private, bounded, validated event file. Studio reads it read-only and rejects unsafe or corrupt files; no Studio action can alter security policy, credentials, dispatch, or runtime state. |

## Threat/control ledger

| Threat | Required control | Current status |
|---|---|---|
| Eavesdropping | TLS 1.3 on public remote transport | experimental in Python/Node/Go/Rust; unavailable in C++ |
| Frame bombing | Bounds before allocation | stable baseline |
| Server impersonation | Trusted roots and hostname/SAN verification | integration-tested in four TLS runtimes |
| Client/node/worker impersonation | mTLS plus certificate-derived identity | integration-tested in four TLS runtimes |
| Capability escalation | Local authorized grants, never JSON claims | integrated on four secure receive paths |
| Replay/reordering | Peer/session nonce, sequence, timestamp | integrated; durable when configured in four secure runtimes |
| Security-profile downgrade | Exact selection plus authenticated transcript | integrated on Python/Node/Go/Rust TLS framed paths; unavailable in C++ |
| Artifact tampering/forgery | SHA-256 plus trusted Ed25519 signer policy | mandatory on remote cpp-ml; universal ingestion remains incomplete |
| Revoked/stale credentials | Expiry, revocation, reload | durable local policy and reload/rotation integrated; CRL/OCSP unavailable |
| State poisoning | Checksums, bounds, atomic commit, quarantine | replay/revocation/ML job state implemented; general session state unavailable |
| Observability deception | Validated private event schema and explicit empty/invalid state | experimental Go gateway emitter and Studio parser; no mock runtime claims |
| Harvest-now-decrypt-later | Provider-backed hybrid group with proof | provider-dependent in compatible Node/Go environments |

## Non-goals

- Protection after full host OS/kernel compromise.
- Physical side-channel resistance.
- Network anonymity or traffic-analysis resistance.
- Volumetric layer-3/layer-4 DDoS absorption.
- Claims of absolute security or "quantum proof" operation.
- Treating custom/research cryptography as a production provider.

## Release rule

A threat moves to implemented only when a maintained backend is connected to a
real execution path and positive, negative, and interoperability tests prove
the behavior. Data types and helper-only tests are insufficient.
