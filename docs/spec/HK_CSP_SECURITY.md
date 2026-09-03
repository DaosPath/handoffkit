# HK-CSP security status (HandoffKit 1.19 development)

This document records executable implementation status, not release intent. An
enum, schema, fixture, helper, mock, or isolated unit test is not evidence that
a control protects a transport or dispatch path.

Status terms:

- **stable**: integrated, negatively and positively tested, and supported for
  production use within the documented scope;
- **experimental**: implemented and integration-tested, but not yet declared
  production-ready;
- **provider-dependent**: enabled only after the active provider proves the
  primitive; selection fails closed when absent;
- **local-only**: implemented and tested only on a local file/process path; it
  is not evidence of a remote transport or production deployment;
- **partially integrated**: a real implementation protects named execution
  paths, but is not yet mandatory on every relevant ingestion/dispatch path;
- **planned**: designed or represented, but not implemented end to end;
- **unavailable**: the current build must neither select nor advertise it.

## Capability ledger
| Capability | Status | Execution evidence and limits |
|---|---|---|
| Bounded framing and envelope validation | stable | Real framed paths and negative tests in Python, Node, Rust, and Go. |
| Local stdio/subprocess transport | stable | Cross-process Python/Node/Rust/Go interoperability remains covered in CI. |
| TLS 1.3: Python | experimental | Real asyncio TCP sockets in `test_csp_tls_integration.py`: configured CA, hostname, server/client certificates, mTLS, expired/wrong-host/unknown-CA/missing-client failures, timeout/close, public-bind rejection, and rejection of secure-context overrides or direct secure socket wrapping. System roots are used when no CA override is supplied. |
| TLS 1.3: Node | experimental | Real Node TLS sockets in `tls.integration.test.js`: SNI/`servername`, hostname/CA checks, mTLS, invalid certificates, unauthorized peers, timeout, close, and rejection of secure `tlsOptions` overrides or direct secure socket wrapping. The browser-safe package contains contracts and policy only. |
| TLS 1.3: Go | experimental | `BuildTLSConfig` installs system/configured roots, `RootCAs`, `ClientCAs`, `ServerName`, client-auth policy, and certificates. `ListenTCP`/`DialTCP` use the resulting `tls.Config`; real socket failures and `go test -race` are CI gates. Direct `hybrid-pq` wrapping additionally verifies the negotiated group. |
| TLS 1.3: Rust | experimental | `handoffkit-transport` uses maintained rustls/ring client and server paths with native/configured roots, hostname verification, mTLS, timeout, structured failures, and real-socket tests. |
| TLS: C++ | unavailable | No maintained TLS connector/acceptor is integrated. OpenSSL Crypto used by optional artifact signing is not a TLS transport backend. |
| Certificate-bound identity | experimental | Python, Node, Go, and Rust derive peer/node/optional-worker IDs from an authenticated URI SAN, calculate the certificate fingerprint locally, check trust domain/issuer/expiry/local revocation, and assign capabilities from local fingerprint policy. |
| Declared identity spoof rejection | experimental | Secure receive tests reject mismatched `peer_id`, `node_id`, `worker_id`, `trust_domain`, credential fingerprint, and capabilities before dispatch. JSON identity is never the trust source. |
| Capability authorization | experimental | Local grants are mandatory on secure receive paths in Python, Node, Go, and Rust and execute after certificate authentication and replay checks. Empty peer grants fail closed. |
| Cryptographic replay protection | experimental | Secure receive paths enforce peer/session-scoped nonce, sequence, and timestamp state before authorization/dispatch. A failed replay validation does not mutate state; an authenticated message that passes replay and later fails authorization remains consumed. State is process-local and resets on restart. |
| Business deduplication | stable | Durable idempotency stores remain separate from cryptographic replay state. They do not substitute for it. |
| Profile selection/downgrade helper | partially integrated | Five-runtime conformance requires an exact offered/required profile and rejects unavailable providers without fallback. No authenticated profile-negotiation transcript is yet exchanged between peers, so full downgrade protection remains planned. |
| SHA-256 artifact integrity | partially integrated | Artifact sign/verify paths in Python, Node, Go, Rust, and optional C++ Crypto calculate and compare SHA-256. The cpp-ml worker verifies input size/hash and hashes output checkpoint/report files. General artifact ingestion is not yet universally gated. |
| Ed25519 artifact signatures | partially integrated | Python (`cryptography`), Node (`node:crypto`), Go (`crypto/ed25519`), Rust (`ed25519-dalek`), and C++ with `HANDOFFKIT_WITH_CRYPTO=ON` (OpenSSL Crypto) sign and verify a shared public canonical vector. Negative integration tests use ephemeral keys and cover tamper, wrong signer/key, disallowed algorithm, expiry, revocation, timestamp, and malformed signature. Verification is available through explicit signing APIs and the cpp-ml artifact boundary; it is not a universal ingestion gate. A populated `signature` field alone is never accepted. |
| ECDSA, ML-DSA, or SLH-DSA artifact signatures | unavailable | They are not allowlisted in the schema or advertised by runtime capabilities. No sign/verify backend is present. |
| `hybrid-pq`: Node | provider-dependent | Enabled only if the active OpenSSL provider accepts `X25519MLKEM768`. A real TLS trace proves the ServerHello named group, and a Node 24 client completes mTLS against Go 1.26 while Go asserts the negotiated curve and certificate-derived client identity. Provider absence returns false and profile selection fails; there is no standard fallback. |
| `hybrid-pq`: Go | provider-dependent | Normal compatibility builds report unavailable. A separate Go 1.26 provider workflow with `GODEBUG=tlsmlkem=1` proves `tls.X25519MLKEM768` on real sockets and in the Node 24 mTLS interoperability test, and rejects relabeling an X25519-only socket as hybrid. Provider absence fails closed. |
| `hybrid-pq`: Python/Rust/C++ | unavailable | Active providers do not expose the required group through these runtime integrations. Capability detection reports false and selection fails. No ML-KEM implementation exists in HandoffKit. |
| Local credential denylist | experimental | Python, Node, Go, and Rust reject configured certificate fingerprints on authenticated connections; artifact trust policies also reject revoked signer keys. This is local policy, not CRL/OCSP. |
| CRL/OCSP and trust-store reload | unavailable | No online/offline PKI revocation backend or live trust-anchor reload is integrated. |
| Certificate rotation/reconnect lifecycle | unavailable | Active listeners do not reload credentials, reject a superseded certificate after reload, or prove reconnect with a newly activated credential. |
| Development file keystore | local-only | Python and Node expose a lifecycle interface, reject closed/irregular/symlink paths, and reject group/world-readable private keys on POSIX. It remains a development backend and is not an OS keystore. |
| OS keystore adapters | unavailable | No Windows, macOS, Linux secret-service, HSM, or KMS adapter is implemented. |
| Secret zeroization guarantee | unavailable | No verified zeroization guarantee is made for managed strings, PEM buffers, or development file stores. |
| C++ native compute worker | local-only | `NativeComputePool` uses `std::jthread`/`std::stop_token`, bounded queues, backpressure, cancellation, deadlines, lifecycle, progress, ArtifactRef results, graceful shutdown, and ACK/NACK adaptation. Concurrent Release tests and an executable benchmark exercise the in-process runtime. No C++ TLS transport exists. |
| cpp-ml HK-CSP worker | local-only | Real TrainingJob/EvaluationJob execution runs through the native pool, validates input artifacts, streams progress, emits hashed checkpoint/report artifacts, reports CPU/CUDA metadata, and tests cancellation, deadlines, capability denial, integrity failure, and graceful shutdown. It is local-file oriented and not a remote TLS worker. |
| Five-runtime security conformance | experimental | Shared vectors cover SecurityConfig, PeerIdentity, exact profile selection, authorization, replay behavior/error codes, SignedArtifact wire format, and canonical payload in Python, JS, Go, Rust, and C++. Cryptographic shared-vector tests cover every signing backend that is enabled. |
| Security validation/benchmarks | experimental | Node measures live standard/hybrid handshakes, reconnect, TLS throughput, RSS delta, and Ed25519 sign/verify p50/p95/p99. C++ measures real worker latency, throughput, queue depth, and backpressure. Every output is an environmental measurement — not a performance guarantee. |
| ARM64/edge production profile | unavailable | No ARM64 build gate, low-memory suite, or unstable-network suite exists. Edge enum/config values are contracts, not deployment support. |
| Studio security visibility | unavailable | Studio has no runtime-derived security session view. No mock security status may be shown as runtime fact. |
| Durable secure recovery | unavailable | Durable session/job recovery, replay-state persistence, migrations, corruption quarantine, and recovery tests are absent. Process-local replay reset is documented and tested. |

## 1.20 development deltas (experimental, not released)

The rows below extend the 1.19.5 ledger above with 1.20 Browser Platform
scope. They have real execution and integration evidence for their documented
scope and are **near-stable** within that scope. `stable` additionally
requires the immutable release build, clean-install/upgrade evidence,
supported-platform qualification, and operational recovery gates from the
release governance policy. No status is promoted by documentation alone.

| Capability | Status | Execution evidence and limits |
|---|---|---|
| TLS 1.3: C++ | experimental/provider-dependent | `HANDOFFKIT_WITH_TLS=ON` links the maintained OpenSSL SSL provider and exposes real TCP client/listener framing with TLS 1.3, CA roots, hostname verification, mTLS, URI SAN identity, local fingerprint capability policy, timeouts, structured errors, and OCSP response validation when OpenSSL exposes OCSP. Default builds without the provider report unavailable. OCSP responder fetch remains unavailable and fails closed. |
| Hostname verification | experimental | Python, Node, Go, Rust, and C++ configure the endpoint name in their real TLS client transport; wrong-host sockets fail before CSP dispatch. Browser-safe JS retains policy/contracts only and never implements TLS. |
| Trust anchors / certificate validation | experimental | System or explicitly configured CA roots are installed in each secure transport; server/client certificates, issuer chain, validity period, and mTLS requirements are checked on real handshakes. An unknown CA or missing client certificate fails closed. |
| SAN validation and certificate identity | experimental | URI SAN is parsed locally into `peer_id`, `node_id`, and optional `worker_id`; the trust domain, issuer, validity window, and SHA-256 certificate fingerprint are checked locally. Declared JSON identity/capabilities never replace the certificate-bound identity. |
| CRL: C++ OpenSSL provider | experimental/provider-dependent | `SecurityConfig.crl_path` loads a PEM CRL into the OpenSSL `X509_STORE` with `X509_V_FLAG_CRL_CHECK{,_ALL}`. The real C++ TLS test generates a CA/client CRL and rejects the revoked client certificate. This remains file-backed CRL checking. |
| Cryptographic replay protection (durable option) | experimental | Secure receive paths in Python, Node, Go, and Rust enforce peer/session/credential/profile-scoped nonce, sequence, and timestamp state before authorization/dispatch. Optional durable backends use a shared versioned/checksummed bounded format, atomic replacement, expiry/compaction, corruption quarantine, and real mTLS listener-restart tests. Deployments without the durable backend reset replay state on restart; exactly-once is not claimed. |
| Authenticated profile transcript | experimental | Python, Node, Go, Rust, and C++ use the same compact UTF-8 JSON/lexicographic-key SHA-256 transcript vector. Canonical shared vectors and real TLS routes reject hash tamper, identity change, replay, and a validly rehashed downgrade. |
| SHA-256 artifact ingestion gate | experimental | Go and optional C++ Crypto have real bounded local-file gates for allowed roots/media/size, hash, producer/signer policy, quarantine evidence, and verified snapshots. cpp-ml TrainingJob/EvaluationJob consumption is forced through the C++ snapshot gate. Unrelated artifact consumers remain outside this experimental scope. |
| Ed25519 artifact signatures (1.20 scope) | experimental | The 1.19.5 shared-vector coverage above plus durable signer revocation checks, timestamp validation, and a verified Go-to-cpp-ml checkpoint path: the real Go gateway requires verified Ed25519 input and signs verified checkpoint results before returning them. A populated `signature` field alone is never accepted as verification. |
| ECDSA-P256-SHA256 artifact signatures | experimental/provider-dependent | Python `cryptography` and C++ OpenSSL EVP support an explicit `ecdsa-p256-sha256` id, P-256 key matching, SHA-256/DER sign/verify, canonical point fingerprints, and tamper/wrong-key/expiry/revocation tests. Capability detection probes the provider and fails closed. JS/Go/Rust and a shared five-runtime vector remain unavailable, so ECDSA is not a common stable capability. |
| ML-DSA or SLH-DSA artifact signatures | unavailable | All runtimes reject these ids with structured `artifact_algorithm_unsupported`; no maintained sign/verify provider or official vectors are integrated. |
| Durable local revocation policy | experimental | Python, Node, Go, and Rust persist bounded/checksummed entries for certificate/signer fingerprint, peer ID, issuer, and trust domain with reason/effective/expiry times. Secure TLS identity and artifact verification paths reload and enforce the policy; restart, corruption, live-update, renewed-certificate, issuer/domain, and signer tests are executable. This is local policy, not CRL/OCSP. |
| CRL/OCSP (1.20 scope) | partially integrated | C++ OpenSSL enforces a configured PEM CRL and verifies a signed DER/PEM OCSP response against the authenticated peer certificate, issuer, trust store, status, and freshness on the real handshake. Responder fetch (`ocsp_fetch`, AIA/HTTP/HTTPS) is unavailable; Python/JavaScript/Go/Rust config and transport paths reject fetch, responder URL, response-file, or required-OCSP requests with structured fail-closed errors. |
| Certificate/trust reload and rotation | experimental | Reloadable Python, Node, Go, and Rust TLS providers atomically validate and publish certificate/key/trust snapshots without listener restart. Real sockets prove new credential reconnect, transition-window old credential acceptance/rejection, trust-anchor reload, invalid/key-mismatch rollback, concurrent reload, and existing/new connection behavior. It is runtime-scoped rather than a universal certificate-management service. |
| Development file keystore (1.20 scope) | experimental | The 1.19.5 lifecycle/path/permission checks above plus real keystore lifecycle tests covering write/read/close/reject paths. It remains explicitly development-only and is not an OS keystore. |
| OS keystore adapters | experimental/provider-dependent | C++ `OsKeyStore` selects Windows Credential Manager, macOS Keychain, or Linux Secret Service only when that provider is detected at build time; otherwise `available()` is false and operations fail with `os_keystore_unavailable`. `SecurityConfig.credential_source=os_keystore` loads a certificate+key PEM bundle into the real TLS context and rejects file fallback or key mismatch. No HSM/KMS, Python, or Node adapter is claimed. |
| Secret zeroization guarantee | partially integrated | C++ `SecureBuffer` is move-only, wipes moved-from storage, wipes rvalue `std::string` input, and uses `OPENSSL_cleanse` (or a volatile wipe without OpenSSL); `ArtifactSigner` stores private PEM material in it and `test_secure_memory` exercises clear/destruction/move. Allocator copies, OpenSSL/provider internals, returned `std::string`, and managed runtimes remain uncovered; a global guarantee remains unavailable. |
| cpp-ml HK-CSP worker (TLS route) | experimental/provider-dependent | Local TrainingJob/EvaluationJob execution uses the bounded native pool and mandatory snapshot ingestion gate. The `--tls-policy` executable route uses real C++ TLS/mTLS plus the common `CspDispatcher`, durable scheduler/replay state, certificate-bound identity, and local fingerprint capabilities; `cpp/packages/handoffkit-ml/tests/test_tls_worker.py` drives the executable over TCP and proves capability-claim rejection and replay persistence. `cpp/packages/handoffkit-ml/tests/interop/test_tcp_interoperability.py` drives independent Python, Node.js, Go, and Rust TLS clients against fresh C++ workers and independent TLS servers from the C++ client over framed TCP. The older `--policy` NDJSON route remains local-subprocess compatibility only. Exactly-once and global zeroization are not claimed. |
| Five-runtime security conformance (1.20 scope) | experimental | The 1.19.5 shared vectors above plus authenticated transcript bytes and fail-closed unavailable capabilities. C++ real TLS tests additionally cover dispatcher receive order, duplicate replay, and capability-claim rejection. The bidirectional TCP gate proves Python/Node/Go/Rust-to-C++ framing and mTLS admission. Studio event scope remains explicitly Go emitter plus Go/TypeScript parser only. |
| Security benchmarks (1.20 scope) | experimental | Node measures live standard/hybrid handshakes, reconnect, TLS throughput, RSS delta, and Ed25519 sign/verify p50/p95/p99. C++ measures real worker latency, throughput, queue depth/backpressure, and TLS 1.3 handshake p50/p95/p99 via `test_tls_transport --benchmark` in Linux and ARM64 CI. Go emits reproducible environmental JSON for durable replay/revocation write/restart reload, transcript build/verify, Ed25519 sign/verify, and Studio event emit/parse. |
| ARM64/edge profile | experimental | Shared `edge-small`, `edge-standard`, and `server` profiles apply real session/frame/retry limits in Python, JavaScript, Go, Rust, and the C++ local compute queue. Native Linux ARM64 and macOS ARM64 CI cover the named runtime/security routes; Windows ARM64, unstable-network diversity, and device fleets remain unqualified. |
| Studio security visibility | experimental | The optional Go ML gateway `studioevents.FileSink` emits bounded, atomic, private, schema-validated read-only runtime events from the real mTLS route. Studio reads only the configured `HANDOFFKIT_STUDIO_SECURITY_EVENTS` file, accepts production sources only when every event is labeled `go`, rejects symlinks, non-regular/oversize/insecure/corrupt/mixed-runtime sources, and renders an explicit unconfigured or invalid state instead of mock facts. No Python, JavaScript, Rust, or C++ event emitter is claimed, and Studio never controls the runtime. |
| Durable secure recovery | experimental/scoped | Replay state is durable when configured in the secure runtimes. C++ `DurableReplayProtection` and `DurableScheduler` use bounded, versioned, checksummed, private state with atomic replacement, quarantine, validated backup/restore, migration, and explicit interrupted records; tests prove restart, peer/session scopes, replay backup/restore and v0 migration, corruption quarantine, asynchronous claim/complete/fail, and deterministic opt-in at-least-once retry. Exactly-once external effects remain unavailable: a crash after an external side effect and before its commit marker cannot be solved by a file ledger. Channel/session buffers, unsupported migrations, and distributed consensus remain unavailable. |

### `standard` (1.20 development scope)

In the 1.20 scope, `standard` is **experimental** in Python, Node, Go, and
Rust, and **provider-dependent experimental** in C++ when
`HANDOFFKIT_WITH_TLS=ON`. Default C++ builds without that provider report
`tls_backend_unavailable`; the C++ transport exposes `CspDispatcher` for the
certificate-authenticated replay/authorization/dispatch route. Canonical
cross-runtime transcript wire parity is closed by the shared vector; full
provider/session operational qualification remains experimental.

### Secure receive order (1.20 development scope)

Python, Node, Go, and Rust secure framed transports enforce:

1. receive bounded frame;
2. decode and validate envelope;
3. authenticate the TLS peer;
4. derive certificate identity and compare declared identity;
5. validate the authenticated profile/identity/session transcript;
6. check peer/session replay state (durably when configured);
7. authorize using local grants;
8. dispatch.

Business idempotency remains a separate layer from cryptographic replay.

The C++ provider-gated route uses the same order through
`CspDispatcher::receive_and_dispatch`: receive/decode/validate, certificate
identity, replay, local authorization, then handler. Peer JSON capabilities are
rejected. This is not a claim of exactly-once external effects.

### Studio runtime source (1.20 development scope)

The Studio security page is read-only. It is empty until
`HANDOFFKIT_STUDIO_SECURITY_EVENTS` points to an event file created by a
configured Go gateway `studioevents.FileSink`. The reader accepts only a
regular, non-symlink file within its byte/event bounds and, on POSIX, rejects
group- or world-writable sources. Event identities are certificate-derived;
fingerprints are rendered as `sha256:<12 hex>...<8 hex>`. Paths, keys, tokens,
private certificate material, and full fingerprints are rejected rather than
displayed. A source failure leaves the prior validated snapshot marked
disconnected; it never invents an active session.

## Profiles

### `local`

Development and local IPC profile. Plaintext network listeners are restricted to
loopback. `allow_insecure_loopback` never authorizes a public bind.

### `standard`

TLS 1.3 with verified server identity, configured or system trust roots,
optional mandatory client authentication, certificate-bound identity, replay,
and local authorization before dispatch. It is **experimental** in Python,
Node, Go, and Rust, and **unavailable** in C++.

### `hybrid-pq`

Provider-dependent TLS 1.3 using the officially exposed
`X25519MLKEM768` group. It is exercised in compatible Node and Go provider
environments only. Unsupported builds report false and reject the profile;
they never downgrade to `standard`.

### `research`

Isolated experimentation only. It is not a remote production transport profile
and cannot satisfy `standard` or `hybrid-pq`.

## Secure receive order

Python, Node, Go, and Rust secure framed transports enforce:

1. receive bounded frame;
2. decode and validate envelope;
3. authenticate the TLS peer;
4. derive certificate identity and compare declared identity;
5. check peer/session replay state;
6. authorize using local grants;
7. dispatch.

Replay remains process-local. Business idempotency remains a separate layer.

## Artifact verification rule

An artifact is verified only after canonical payload construction, SHA-256
comparison, algorithm allowlisting, cryptographic signature verification,
producer/key matching, and validity/revocation checks all succeed. Carrying a
hash or signature field is not verification.
