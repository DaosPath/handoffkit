# HK-CSP Formal Threat Model & Security Specification (HandoffKit 1.19)

This document formalizes the threat model, assets, trust boundaries, adversary profiles, attack vectors, and non-goals for HandoffKit 1.19 ("Secure Production, Native Compute & Edge").

---

## 1. Trust Boundaries & Architecture Audit

HandoffKit 1.19 operates across ten explicit trust boundaries:

1. **Trust Boundary 1: Network Transport Layer**  
   Remote TCP, Unix Domain Sockets, and WebSockets. Untrusted inputs arrive over raw network sockets. Transport Security (TLS 1.3, mTLS) isolates this boundary.

2. **Trust Boundary 2: Protocol Framing & Handshake**  
   Length-delimited binary/NDJSON frames. Unauthenticated data parsed prior to envelope validation. Bounds checking and memory cap validation enforce safety before heap allocation.

3. **Trust Boundary 3: Peer Identity & Security Profile Negotiation**  
   Negotiation of `SecurityProfile` (`local`, `standard`, `hybrid-pq`, `research`). Transcript binding prevents downgrade attacks. Identity claims (`peer_id`, `node_id`, `worker_id`) are validated against mTLS certificates or cryptographic tokens.

4. **Trust Boundary 4: Capability Authorization Engine**  
   Authentication $\neq$ Authorization. Capability-based authorization policies control worker registrations, job assignments, tool execution, and filesystem workspace access.

5. **Trust Boundary 5: Replay & Message Integrity Layer**  
   Cryptographic nonces, monotonic sequence numbers, bounded replay windows, and timestamp tolerances protect against replay and reordering attacks.

6. **Trust Boundary 6: Durable State & Persistent Deduplication**  
   Deduplication storage, session logs, and recovery databases. Atomic file operations, checksums, and corruption quarantines protect state on disk.

7. **Trust Boundary 7: Subprocess & Native Worker Execution**  
   Subprocess execution without shell invocation (`execve` / `create_subprocess_exec`). Standard input/output isolation. C++ native compute workers isolated via `std::jthread` and bounded memory limits.

8. **Trust Boundary 8: Artifact Storage & Provenance**  
   Content hashing (SHA-256), cryptographic artifact signatures (Ed25519 / ML-DSA), and workspace path sandboxing prevent path traversal and artifact poisoning.

9. **Trust Boundary 9: Key & Credential Management**  
   Isolated `KeyStore` / `CredentialStore` abstractions. Private keys and certificates are kept out of trace logs, error messages, and version control.

10. **Trust Boundary 10: Experimental Crypto Lab Isolation**  
    Experimental/un-audited cryptographic algorithms (`packages/crypto-research`) are isolated in a sandbox. They cannot be selected in `standard` or `hybrid-pq` profiles and cannot listening publicly.

---

## 2. Protected Assets

- **In-Flight Messages & Envelopes**: Payload data, command arguments, HK-CSP envelopes.
- **Jobs & Tasks**: `DistributedJob`, `TrainingJob`, `EvaluationJob` specifications.
- **Execution Results & Metrics**: Job completion outputs, evaluation scores, logs.
- **Node & Worker Identities**: `peer_id`, `node_id`, `worker_id`, mTLS certificates, public keys.
- **Capabilities & Permissions**: `WorkerCapabilities`, tool allowlists, path access rules.
- **Durable State & Deduplication Logs**: Persisted session sequence numbers, deduplication databases.
- **Artifacts & Model Weights**: Checkpoints, GGUF files, dataset exports, media files.
- **Cryptographic Credentials**: Private keys, trust anchors, CA certificates, authentication tokens.

---

## 3. Adversary Profiles

1. **Unauthenticated External Attacker**: Connects to open network ports without valid certificates or credentials.
2. **Malicious / Compromised Worker**: Authenticates successfully but attempts capability escalation, path traversal, or resource exhaustion.
3. **Revoked Peer / Stale Node**: Possesses expired or revoked certificates and attempts to re-register or intercept job assignments.
4. **Active Network Attacker (Man-in-the-Middle)**: Intercepts network traffic, attempts TLS downgrade, replay attacks, or frame injection.
5. **Passive Network Eavesdropper**: Monitors network connections attempting to read cleartext payloads or extract credentials.
6. **Malicious Artifact Producer**: Submits modified or poisoned artifacts with matching basenames but altered content hashes.
7. **Local Non-Privileged Process**: Attempts to corrupt shared deduplication logs or inject shell commands.

---

## 4. Mitigated Attack Vectors

| Attack Vector | Defense Mechanism |
|---|---|
| **Eavesdropping / Wiretapping** | TLS 1.3 encryption (AES-256-GCM / ChaCha20-Poly1305). |
| **Tampering & Frame Bombing** | Strict frame length limits (`DEFAULT_MAX_MESSAGE_BYTES`), framing validation before buffer allocation. |
| **Impersonation & Rogue Nodes** | Mandatory mTLS or short-lived signed tokens; SAN identity matching. |
| **Replay Attacks** | Bounded replay window (nonces, timestamps, monotonic session sequence numbers). |
| **Downgrade Attacks** | Protocol transcript binding, typed allowlist profile selection; fail closed if `hybrid-pq` required but unavailable. |
| **Capability Escalation / Confused Deputy** | Capability authorization engine verifying worker capabilities against job specs. |
| **Path Traversal & Shell Injection** | Workspace path sandboxing, explicit `argv` array execution without shell wrappers. |
| **Quantum Harvest-Now-Decrypt-Later** | Hybrid Post-Quantum key exchange (`X25519 + ML-KEM-768`). |
| **Credential Leakage** | Redaction of tokens and private keys from logs, errors, and Studio UI. |
| **State & Dedup Poisoning** | Atomic write-replace storage, SHA-256 checksum validation, corruption quarantine. |

---

## 5. Non-Goals & Out-of-Scope (1.19)

HandoffKit 1.19 explicitly does **NOT** guarantee or cover:

- **Fully Compromised Host OS / Kernel**: If the underlying host kernel or hardware is compromised, local memory and keys can be extracted.
- **Physical Side-Channel Attacks**: Power analysis, EM emissions, or physical memory probe attacks.
- **Global Network Anonymity**: Network metadata (IP addresses, packet timing, connection volume) is not anonymized (no Tor/mixnets).
- **Absolute DDoS Immunity**: While rate limits and bounded queues mitigate exhaustion, a massive volumetric network flood at layer 3/4 must be filtered by perimeter firewalls.
- **Un-audited / Custom Production Cryptography**: Custom/experimental algorithms in the `Crypto Lab` are strictly for research and must **NEVER** be used in production.
- **"Impossible to Break / Quantum-Proof" Marketing Claims**: Security relies on standard cryptography and hybrid post-quantum algorithms as implemented by verified underlying providers.
