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
| Profile selection | Exact, fail-closed selection is conformance-tested. The peer handshake has no authenticated profile-negotiation transcript, so full downgrade defense remains planned. |
| Peer identity | Four secure runtimes derive identity from verified certificate SAN/fingerprint and compare all declared claims. Local policy supplies capabilities. |
| Authorization | Four secure receive paths authorize locally after authentication and replay checks. |
| Replay | Peer/session nonce, sequence, and timestamp checks are mandatory on secure framed paths, but their state is process-local. |
| Durable state | Business deduplication exists. Secure replay persistence, session/job recovery, migrations, and corruption quarantine do not. |
| Native execution | The C++ bounded jthread worker and cpp-ml job path are real and concurrently tested. They are not themselves remote TLS transports. |
| Artifact provenance | Maintained Ed25519 providers verify a shared vector in Python, Node, Go, Rust, and optional C++ Crypto. Universal artifact ingestion enforcement is incomplete. |
| Keys/credentials | Python/Node development file stores check lifecycle/path/POSIX permissions. OS keystores, live rotation/reload, CRL/OCSP, and zeroization guarantees are absent. |
| Hybrid TLS | Compatible Node and Go providers prove X25519MLKEM768 handshakes, including Node 24 to Go 1.26 mTLS interoperability. Other providers fail closed and report unavailable. |

## Threat/control ledger

| Threat | Required control | Current status |
|---|---|---|
| Eavesdropping | TLS 1.3 on public remote transport | experimental in Python/Node/Go/Rust; unavailable in C++ |
| Frame bombing | Bounds before allocation | stable baseline |
| Server impersonation | Trusted roots and hostname/SAN verification | integration-tested in four TLS runtimes |
| Client/node/worker impersonation | mTLS plus certificate-derived identity | integration-tested in four TLS runtimes |
| Capability escalation | Local authorized grants, never JSON claims | integrated on four secure receive paths |
| Replay/reordering | Peer/session nonce, sequence, timestamp | integrated but process-local; restart durability unavailable |
| Security-profile downgrade | Exact selection plus authenticated transcript | exact local selection implemented; authenticated transcript planned |
| Artifact tampering/forgery | SHA-256 plus trusted Ed25519 signer policy | implemented APIs/shared vectors; universal ingestion gate incomplete |
| Revoked/stale credentials | Expiry, revocation, reload | expiry/local denylist implemented; CRL/OCSP/reload/rotation unavailable |
| State poisoning | Authenticated/checksummed state, migration, quarantine | unavailable |
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
