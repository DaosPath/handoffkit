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
| TLS 1.3: Go | experimental | `BuildTLSConfig` installs system/configured roots, `RootCAs`, `ClientCAs`, `ServerName`, client-auth policy, and certificates. `ListenTCP`/`DialTCP` use the resulting `tls.Config`; real socket failures and `go test -race` are CI gates. Each secure received frame rechecks authenticated certificate validity, local/durable revocation, and rotation-window policy before transcript, replay, authorization, and dispatch. Direct `hybrid-pq` wrapping additionally verifies the negotiated group. |
| TLS 1.3: Rust | experimental | `handoffkit-transport` uses maintained rustls/ring client and server paths with native/configured roots, hostname verification, mTLS, timeout, structured failures, and real-socket tests. |
| TLS: C++ | unavailable | No maintained TLS connector/acceptor is integrated. OpenSSL Crypto used by optional artifact signing is not a TLS transport backend. |
| Certificate-bound identity | experimental | Python, Node, Go, and Rust derive peer/node/optional-worker IDs from an authenticated URI SAN, calculate the certificate fingerprint locally, check trust domain/issuer/expiry/local revocation, and assign capabilities from local fingerprint policy. |
| Declared identity spoof rejection | experimental | Secure receive tests reject mismatched `peer_id`, `node_id`, `worker_id`, `trust_domain`, credential fingerprint, and capabilities before dispatch. JSON identity is never the trust source. |
| Capability authorization | experimental | Local grants are mandatory on secure receive paths in Python, Node, Go, and Rust and execute after certificate authentication and replay checks. Empty peer grants fail closed. |
| Cryptographic replay protection | experimental | Secure receive paths in Python, Node, Go, and Rust enforce peer/session/credential/profile-scoped nonce, sequence, and timestamp state before authorization/dispatch. Their optional durable backends use a shared versioned/checksummed bounded format, atomic replacement, expiry/compaction, corruption quarantine, and real mTLS listener-restart tests. Deployments that do not configure the durable backend still reset replay state on restart; exactly-once is not claimed. |
| Business deduplication | stable | Durable idempotency stores remain separate from cryptographic replay state. They do not substitute for it. |
| Authenticated profile transcript | experimental | Python, Node, Go, and Rust secure framed transports add a typed HK-CSP 1.0 metadata extension binding protocol/profile, certificate-derived endpoint identities/fingerprints, TLS version/group, session, nonce, capabilities hash, timestamp, and endpoint-binding hash. Canonical shared vectors and real TLS routes reject hash tamper, identity change, replay, and a validly rehashed downgrade. The extension is protected by authenticated TLS and certificate endpoint binding; it is not advertised as a universal TLS exporter or standalone signature. C++ has no TLS transcript path. |
| SHA-256 artifact ingestion gate | partially integrated | Go and optional C++ Crypto have real bounded local-file gates for allowed roots/media/size, hash, producer/signer policy, quarantine evidence, and verified snapshots. cpp-ml TrainingJob/EvaluationJob consumption is forced through the C++ snapshot gate. The Go mTLS cpp-ml gateway forces signed input through its gate before the process boundary and revalidates inside C++; unrelated artifact consumers are not yet universally gated. |
| Ed25519 artifact signatures | partially integrated | Python (`cryptography`), Node (`node:crypto`), Go (`crypto/ed25519`), Rust (`ed25519-dalek`), and C++ with `HANDOFFKIT_WITH_CRYPTO=ON` (OpenSSL Crypto) sign and verify a shared public canonical vector. Negative tests cover tamper, wrong signer/key, disallowed algorithm, expiry, durable signer revocation, timestamp, and malformed signature. The remote Go→cpp-ml path requires verified Ed25519 input and signs verified checkpoint results before returning them. Other ingestion paths may still use explicit APIs, so a populated `signature` field alone is never accepted as verification. |
| ECDSA, ML-DSA, or SLH-DSA artifact signatures | unavailable | They are not allowlisted in the schema or advertised by runtime capabilities. No sign/verify backend is present. |
| `hybrid-pq`: Node | provider-dependent | Enabled only if the active OpenSSL provider accepts `X25519MLKEM768`. A real TLS trace proves the ServerHello named group, and a Node 24 client completes mTLS against Go 1.26 while Go asserts the negotiated curve and certificate-derived client identity. Provider absence returns false and profile selection fails; there is no standard fallback. |
| `hybrid-pq`: Go | provider-dependent | Normal compatibility builds report unavailable. A separate Go 1.26 provider workflow with `GODEBUG=tlsmlkem=1` proves `tls.X25519MLKEM768` on real sockets and in the Node 24 mTLS interoperability test, and rejects relabeling an X25519-only socket as hybrid. Provider absence fails closed. |
| `hybrid-pq`: Python/Rust/C++ | unavailable | Active providers do not expose the required group through these runtime integrations. Capability detection reports false and selection fails. No ML-KEM implementation exists in HandoffKit. |
| Durable local revocation policy | experimental | Python, Node, Go, and Rust persist bounded/checksummed entries for certificate/signer fingerprint, peer ID, issuer, and trust domain with reason/effective/expiry times. Secure TLS identity and artifact verification paths reload and enforce the policy; restart, corruption, live-update, renewed-certificate, issuer/domain, and signer tests are executable. This is local policy, not CRL/OCSP. |
| CRL/OCSP | unavailable | No provider-backed CRL or OCSP validator is integrated. HandoffKit does not fetch arbitrary revocation URLs. |
| Certificate/trust reload and rotation | experimental | Reloadable Python, Node, Go, and Rust TLS providers atomically validate and publish certificate/key/trust snapshots without listener restart. Real sockets prove new credential reconnect, transition-window old credential acceptance/rejection, trust-anchor reload, invalid/key-mismatch rollback, concurrent reload, and existing/new connection behavior. It is runtime-scoped rather than a universal certificate-management service. |
| Development file keystore | local-only | Python and Node expose a lifecycle interface, reject closed/irregular/symlink paths, and reject group/world-readable private keys on POSIX. It remains a development backend and is not an OS keystore. |
| OS keystore adapters | unavailable | No Windows, macOS, Linux secret-service, HSM, or KMS adapter is implemented. |
| Secret zeroization guarantee | unavailable | No verified zeroization guarantee is made for managed strings, PEM buffers, or development file stores. |
| C++ native compute worker | local-only | `NativeComputePool` uses `std::jthread`/`std::stop_token`, bounded queues, backpressure, cancellation, deadlines, lifecycle, progress, ArtifactRef results, graceful shutdown, and ACK/NACK adaptation. Concurrent Release tests and an executable benchmark exercise the in-process runtime. No C++ TLS transport exists. |
| cpp-ml HK-CSP worker | experimental | Local TrainingJob/EvaluationJob execution uses the bounded native pool and mandatory snapshot ingestion gate. An optional Go sidecar terminates maintained TLS 1.3/mTLS, certificate identity, durable replay, capability authorization, signed artifact policy, and durable idempotency before spawning the C++ worker without a shell. A tagged CI integration uses real client/gateway/worker processes and covers progress, signed checkpoints, cancellation, deadline, invalid artifacts, worker crash/restart, and reconnect. C++ itself still has no TLS backend; the path is same-host/shared-file-store oriented. |
| Five-runtime security conformance | experimental | Shared vectors cover SecurityConfig, PeerIdentity, exact profile selection, authorization, replay behavior/error codes, SignedArtifact wire format, and canonical payload in Python, JS, Go, Rust, and C++. `security-finalization-v1.json` indexes the shared durable replay/revocation, transcript, and edge-profile fixtures; its Studio event scope is explicitly Go emitter plus Go/TypeScript parser only. Cryptographic shared-vector tests cover every signing backend that is enabled. |
| Security benchmarks | partially integrated | Node measures live standard/hybrid handshakes, reconnect, TLS throughput, RSS delta, and Ed25519 sign/verify p50/p95/p99. C++ measures real worker latency, throughput, queue depth, and backpressure. Go emits a reproducible environmental JSON measurement for durable replay/revocation write/restart reload, transcript build/verify, Ed25519 sign/verify, and Studio event emit/parse; the ARM64 job runs it natively. Remote ML end-to-end latency and live TLS reload/rotation have no common reproducible benchmark harness yet. Every output says `Environmental measurement — not a performance guarantee.` |
| ARM64/edge profile | partially integrated | Shared `edge-small`, `edge-standard`, and `server` profiles apply real session/frame/retry limits in Python, JavaScript, Go, Rust, and the C++ local compute queue. The branch's native Linux ARM64 job passed TLS, durable-state, edge-small RSS, Rust, C++, cpp-ml CPU, and Go gateway routes. This is qualification evidence for that runner only; no broader ARM64 device/OS deployment or unstable-network guarantee is claimed. |
| Studio security visibility | experimental | The optional Go ML gateway `studioevents.FileSink` emits bounded, atomic, private, schema-validated read-only runtime events from the real mTLS route. Studio reads only the configured `HANDOFFKIT_STUDIO_SECURITY_EVENTS` file, rejects symlinks, non-regular/oversize/insecure/corrupt sources, and renders an explicit unconfigured or invalid state instead of mock facts. The tagged real-process test proves sessions, TLS identity, progress, signed/rejected artifacts, reconnect, replay, authorization, and sanitized runtime status. No Python, JavaScript, Rust, or C++ event emitter is claimed, and Studio never controls the runtime. |
| Durable secure recovery | partially integrated | Replay state is durable in the four secure runtimes. The Go cpp-ml gateway has an atomic/checksummed bounded job ledger: completed results survive reconnect/restart, idempotency conflicts fail closed, corruption is quarantined, and an active job found after restart is explicitly marked interrupted. General durable sessions/queues and automatic in-flight compute resumption are unavailable. |

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
5. validate the authenticated profile/identity/session transcript;
6. check peer/session replay state (durably when configured);
7. authorize using local grants;
8. dispatch.

Business idempotency remains a separate layer from cryptographic replay.

## Studio runtime source

The Studio security page is read-only. It is empty until
`HANDOFFKIT_STUDIO_SECURITY_EVENTS` points to an event file created by a
configured Go gateway `studioevents.FileSink`. The reader accepts only a
regular, non-symlink file within its byte/event bounds and, on POSIX, rejects
group- or world-writable sources. Event identities are certificate-derived;
fingerprints are rendered as `sha256:<12 hex>...<8 hex>`. Paths, keys, tokens,
private certificate material, and full fingerprints are rejected rather than
displayed. A source failure leaves the prior validated snapshot marked
disconnected; it never invents an active session.

## Artifact verification rule

An artifact is verified only after canonical payload construction, SHA-256
comparison, algorithm allowlisting, cryptographic signature verification,
producer/key matching, and validity/revocation checks all succeed. Carrying a
hash or signature field is not verification.
