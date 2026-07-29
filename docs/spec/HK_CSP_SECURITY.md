# HK-CSP Security Model (HandoffKit 1.19)

HK-CSP transports data; it does not grant authority. Receiving a tool call,
command, path, URL, job, or artifact reference never implies permission to use it.

## 1. Core Safeguards

- Validate every envelope before dispatch.
- Reject unsupported major protocol versions (HK-CSP Wire 1.0).
- Enforce frame and channel limits before allocating memory buffers.
- Redact credentials, tokens, and private keys from errors, traces, logs, and metadata.
- Use explicit `argv` arrays for child processes and never enable a shell implicitly.
- Keep stdio stdout protocol-only.
- Resolve filesystem artifacts through the runtime workspace policy.
- Require existing tool sandbox and capability approval policies for mutating operations.
- Authenticate and encrypt remote network transports before production use.
- Bound retries, deduplication storage, process count, and pending ACKs.

## 2. Production Security Architecture (1.19)

HandoffKit 1.19 introduces a production security layer across Python, JavaScript, Rust, Go, and C++:

### Security Profiles
- `local`: Development & local IPC (in-process, stdio, loopback). Bound to local interfaces.
- `standard`: TLS 1.3 encryption with server authentication or mTLS, standard ciphers (AES-256-GCM, ChaCha20-Poly1305, X25519, Ed25519/ECDSA).
- `hybrid-pq`: TLS 1.3 with hybrid post-quantum key exchange (X25519 + ML-KEM-768). Fails closed if post-quantum provider is required but unavailable.
- `research`: Experimental crypto lab only. Locked out of production transports and disabled by default.

### Peer Identity & Authentication
- Verifiable peer identity (`peer_id`, `node_id`, `worker_id`) tied to mTLS X.509 certificates or signed short-lived tokens.
- SAN matching, certificate expiration, revocation checking, and trust anchor management.

### Capability Authorization
- Strict allowlist-based authorization matching worker capabilities against job specifications, tool calls, and workspace path boundaries.

### Replay & Integrity Protection
- Nonce tracking, monotonic session sequence checking, bounded replay windows, and clock skew tolerances.
- Artifact integrity verification using SHA-256 content hashes and optional Ed25519 / ML-DSA cryptographic signatures.

### Key & Credential Management
- Pluggable `KeyStore` / `CredentialStore` supporting secure file storage, OS keystore adapters, password callbacks, and zeroization when supported by the runtime.
