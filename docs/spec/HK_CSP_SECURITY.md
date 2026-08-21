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
