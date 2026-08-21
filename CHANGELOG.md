# Changelog

All notable changes to the HandoffKit monorepo are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
HandoffKit uses semantic versioning for published releases. Subsystem changelogs
contain deeper engineering history; this root file remains the concise public
release summary.

## [1.19.0-beta.1] - 2026-08-10

First HandoffKit 1.19 beta publication. This is a scoped experimental
baseline, not the final 1.19 release. PyPI publishes `handoffkit==1.19.0b1`;
npm publishes the dependency-complete `@handoffkit/core`, `@handoffkit/csp`,
and `@handoffkit/node` packages as `1.19.0-beta.1`.

Exactly-once effects, global zeroization, OCSP responder fetch, ML-DSA,
SLH-DSA, common five-runtime ECDSA, and hybrid-PQ outside Node/Go remain
unavailable and fail closed.

## [Unreleased]

The current 1.20 development line continues from the 1.19 beta baseline.
Browser Platform work is a **single 1.20 train** (the former 1.20–1.29 split is
absorbed). 1.20 stays beta until every scorecard dimension is ≥9/10. See
`reports/BROWSER_1.20_SCORECARD.md`. No tag or publication is implied.

### Added

- Clinical Sequential Reasoning Lab (`handoffkit.clinical`, `@handoffkit/clinical`,
  `/demos/clinical-lab`): experimental predefined-case sequential sandbox.
  Scoring is fail-closed and `heuristic_only` until independent judges exist.
  `clinical_validity` stays null. Official 897-case corpus, live providers, and
  live retrieval remain unavailable. Research never falls back to professional.
  `gold_replay` is an immutable recorded fixture only. Status: experimental /
  research and education only / not clinically validated.

- Browser Core I/O-free contracts (`@handoffkit/browser-core` and Python/Rust/Go/C++
  equivalents) with golden vectors at `packages/contracts/conformance/browser-core-v1.json`.
- Named Lite/Real packages: `@handoffkit/browser-lite` (facade re-export) and
  `@handoffkit/browser-real` (supervised Playwright service, Chromium only via
  explicit `install-chromium`). `@handoffkit/browser` never imports Real.
- Search `provider_trace`, `fallback_reason`, `strict_provider`, and opt-in
  `search_plan=platform`. Workspace `project_index` is opt-in and is not a
  complete Internet index. ResearchPack v2 adds snapshots, claims, and
  at-least-once checkpoints.
- Browser Core network/filesystem policy helpers (`assert_network_url` /
  `assertFilesystem`) deny loopback, private networks, and local files by
  default. Browser Real enforces those checks before navigate/download/screenshot
  paths. C++ HTML extraction now emits Markdown tables and JSON-LD to match
  JS/Python. Studio Inspector renders authorized screenshots and exposes
  pause/resume/cancel/retry only against a configured control sink.
- Studio Browser Inspector (`/studio/browser`) reads only real NDJSON from
  `HANDOFFKIT_STUDIO_BROWSER_EVENTS`. Hermes surfaces browser progress, sources,
  errors, and cancel without hosting Chromium.

- Added an auditable evidence-dossier mode to Python and JavaScript grounded
  research recipes. Each direct claim needs a locally matched quote and
  semantic alignment with its requirement; cross-claim synthesis references a
  verified claim ledger, and deterministic composition can avoid a free-form
  final model pass. Known URL seeds affect ranking only and are still fetched
  through the real research route. Fixed audit rubrics may add locally verified
  quote anchors and claim-ID inference rules; stale anchors fail closed.
- Added the expiring live grounding qualification: 30 HTTPS sources are fetched
  through HandoffKit WebExplorer, each page is hashed, quotes are extracted from
  current Markdown, and invented/redirected/fixture citations fail closed.
  `reports/BROWSER_1.20_GROUNDING_LIVE.json` records a 30/30 run with
  factual/completeness/citation metrics at 1.0. This is a retrieval/evidence
  oracle, not an LLM answer-accuracy claim; the corpus must be refreshed after
  its expiry date.

- Screen-dubbing media pipeline and agent recipe (`screen_dubbing` /
  `screen-dubbing`): OCR + ASR consensus, a long-context producer prompt for
  one full-episode translation pass, and an improved offline `demo-media`
  that shows those handoffs. Python and JavaScript stay 1:1
  (`merge_ocr_asr_segments` / `mergeOcrAsrSegments`,
  `build_screen_narration_prompt` / `buildScreenNarrationPrompt`,
  `parse_screen_narration_json` / `parseScreenNarrationJson`).
- Expanded the experimental `user_browser` provider in JavaScript and Python
  from search-only to an explicit host page bridge (`fetch`/`open`). The bridge
  normalizes HTML/Markdown/links, supports bounded multi-page same-host
  exploration with depth/page/link/timeout limits, fails closed when page
  access is absent, and emits `ResearchPack.agent_markdown` with queries,
  citations, evidence, and structured errors. No browser profile, cookie, or
  HTTP fallback is used by this route.
- Added the experimental `default_browser` provider in JavaScript and Python.
  It speaks a bounded loopback/HTTPS JSON bridge (`POST /search`, `POST
  /fetch`) owned by the host's system-default browser. Missing endpoints,
  unsafe remote HTTP, timeouts, and malformed responses fail closed; no
  browser launch, cookie access, or silent HTTP fallback is performed.
- Added bounded multi-query user-session search with duplicate-source
  provenance and deterministic scoring. Browser-bridge traversal now ranks
  links against the research query, skips likely state-changing action links by
  default, and records traversal/action-skip metadata in agent Markdown.
- Clarified that `user_browser` visibility belongs to the embedding host:
  HandoffKit does not hide or foreground tabs, and a visible host harness is
  not evidence of an invisible HandoffKit browser integration.
- Hardened `google_browser` organic-result parsing: internal Google links,
  redirectors, ad URLs, non-HTTP schemes, fragments, and duplicates are
  removed before results reach the agent. Challenge pages remain a structured
  `provider_challenge` with no fallback. `scripts/js/browser-real-google-search.mjs`
  records explicit headless Chromium outcomes; local probes may be challenged
  or time out and therefore do not close the live-CI gate.
- Added `pnpm js:pack:checksums`, which emits SHA-256 manifests for all twelve
  JS tarballs on the current runner. The Browser Platform matrix uploads one
  manifest per hosted OS/architecture; local x64 output is environmental and
  does not claim cross-architecture release evidence.
- Patched the production dependency graph to Playwright 1.62.1 and nanoid
  3.3.18, and added `pnpm security:dependencies`. The local high/critical
  production audit is clean; this remains separate from CodeQL and hosted
  source-security review.
- Added an experimental, background-only `web_deep_research` route to the
  JavaScript, Python, and C++ Browser Lite surfaces. It expands bounded
  subqueries, ranks candidates, explores/fetches through the configured HTTP or
  fixture transport, and returns citations, limits, timings, and partial errors
  without opening a user browser window. This does not claim Browser Real,
  Chromium, page JavaScript, cookies, credentials, screenshots, or a complete
  local web index.
- Added runtime-selectable DuckDuckGo/Wikipedia provider adapters to the
  Browser Lite search, with canonical `providers_requested`,
  `providers_used`, `errors`, and `error_code` fields across JavaScript,
  Python, and C++. Deep research now reports cache hits/misses/writes and
  reuses cached Markdown pages when a cache is supplied. Provider names do not
  imply live reachability or an independent search index.
- Added an explicit native Google HTML search adapter to Browser Lite across
  JavaScript, Python, and C++. It unwraps result redirects, drops sponsored
  and Google-navigation links, and shares bounded host ranking with the other
  providers. HTML extraction now removes explicitly marked ad/consent/promo
  containers before Markdown conversion; the default provider list remains
  DuckDuckGo/Wikipedia and Google is opt-in.
- Browser agent kits now propagate an explicit provider allowlist through direct
  search/research helpers and registered tools across JavaScript, Python, and
  C++; the JavaScript browse CLI accepts repeated or comma-separated provider
  flags and keeps option values out of the query.
- Added an experimental, provider-dependent `user_browser` search adapter for
  JavaScript and Python. Hosts must inject an explicit `search(query, options)`
  bridge for an already-authorized browser session; results are reduced to
  validated HTTP(S) URLs, and missing/invalid bridges return structured errors.
  The default remains DuckDuckGo/Wikipedia, no cookies or credentials are read,
  and no silent fallback occurs when only `user_browser` is requested.
- Added real TLS 1.3 client/server transports for Python, Node, Go, and Rust,
  including configured/system roots, hostname verification, mTLS, structured
  failures, timeouts, and real-socket positive and negative tests. Added a
  provider-gated C++ OpenSSL client/listener with TLS 1.3, mTLS, SAN-bound
  identity, fingerprint policy, timeouts, and framed real sockets; default C++
  builds still report the provider as unavailable.
- Browser Real now owns Chromium through Playwright `BrowserServer`, records
  its child process, returns `session.interrupted` after a real process exit,
  and relaunches/revalidates through `session.retry`. Local evidence includes
  the real Playwright operation matrix, clean JS tarball consumer imports,
  environmental p50/p95/p99 measurements, and the five-runtime C++ TCP
  TLS/mTLS interoperability matrix. Hosted soak, cross-architecture results,
  full security review, and provider/model answer accuracy remain open gates.
- Added a real Browser Real protocol interop gate for the C++ client and Node
  service over TCP TLS 1.3 + mTLS. The C++ path binds source and capabilities
  to the certificate identity, emits/verifies the HK-CSP security transcript,
  checks response correlation, and rejects repeated response nonce/sequence.
  Evidence uses an injected deterministic session engine and does not claim
  Chromium coverage: `reports/BROWSER_1.20_BROWSER_REAL_CPP_INTEROP.json`.
- Browser Real egress tests now exercise a real Chromium private subresource
  rejection, redirect-target rejection, and a real DNS rejection for non-global
  `localhost` answers. Chromium uses a CDP Fetch interceptor so redirects are
  checked before continuation; non-Chromium engines retain the compatibility
  route hook.
- Studio Browser Inspector now has a reproducible axe-core 4.12.1 WCAG A/AA
  audit at 375/768/1024/1440, with keyboard-name, landmark, skip-link, and
  focus-indicator checks. Its pause/resume/cancel/retry controls are exercised
  through the live Studio API over TCP TLS 1.3+mTLS; hosted and cross-architecture
  qualification remain separate release gates.
- Added certificate-derived peer identity for those four secure transports.
  URI SAN claims and locally calculated fingerprints are checked against every
  declared identity field; capabilities come from local fingerprint policy.
- Integrated peer/session-scoped nonce, sequence, and timestamp replay checks
  and local capability authorization into secure receive paths before
  dispatch. Added optional durable replay backends in Python, Node, Go, and
  Rust with bounded versioned state, checksums, atomic replacement,
  expiry/compaction, corruption quarantine, and real listener-restart tests.
- Added atomic certificate/trust reload and transition-window rotation in the
  four TLS runtimes, plus a durable local revocation policy for certificate,
  signer, peer, issuer, and trust-domain subjects. C++ OpenSSL can also enforce
  a configured PEM CRL and signed DER/PEM OCSP response on real mTLS
  handshakes. OCSP responder fetch (AIA/HTTP/HTTPS) remains unavailable and
  fails closed in every runtime.
- Added an additive HK-CSP 1.0 security transcript on Python, Node, Go, Rust,
  and C++ shared-vector paths. It binds profile, certificate endpoints, TLS
  negotiation, session, nonce, capabilities, and timestamp; the canonical
  UTF-8 payload/hash vector is checked byte-for-byte by all five runtimes and
  rejects replay/tamper/downgrade.
- Added maintained-provider Ed25519 artifact signing and verification in
  Python, Node, Go, Rust, and optional C++ Crypto, with one canonical shared
  vector and negative trust/tamper/expiry/revocation tests.
- Added provider-detected ECDSA-P256-SHA256 artifact signing and verification
  in Python (`cryptography`) and optional C++ OpenSSL Crypto. The explicit
  `ecdsa-p256-sha256` id uses SHA-256/DER signatures and uncompressed-point
  fingerprints; JS/Go/Rust and the common five-runtime vector remain
  unavailable, so no cross-runtime ECDSA capability is claimed.
- Added provider-detected, fail-closed `X25519MLKEM768` TLS in compatible Node
  and Go environments, including a Node 24 to Go 1.26 mTLS interoperability
  gate that checks the negotiated curve and certificate-bound client identity.
  Python, Rust, C++, browser-safe JS, and incompatible providers report it
  unavailable; no fallback to `standard` occurs.
- Added a C++20 bounded native worker using `std::jthread`/`std::stop_token`,
  backpressure, cancellation, deadlines, progress, artifact results,
  ACK/NACK adaptation, and graceful shutdown.
- Added real local cpp-ml `TrainingJob` and `EvaluationJob` execution through
  the native worker, including progress, checkpoint/report artifacts,
  cancellation, deadlines, failures, and CPU/CUDA metadata.
- Added mandatory Go/C++ artifact ingestion gates with root/media/size/hash,
  Ed25519 producer/signer policy, quarantine records, and immutable snapshots.
  cpp-ml consumes verified snapshots rather than reopening unverified inputs.
- Added an optional Go TLS/mTLS gateway to the local cpp-ml process and a
  provider-gated direct C++ TLS worker in cpp-ml 0.6.0. `--tls-policy` uses the
  common dispatcher over real TCP, derives identity/capabilities from the
  certificate and local fingerprint policy, and persists replay/scheduler
  state. The older `--policy` NDJSON mode remains local-subprocess compatibility
  only. CI is configured to exercise both real-process routes; exactly-once and
  global zeroization remain unavailable.
- Added a bidirectional real TCP interoperability gate: independent Python,
  Node.js, Go, and Rust TLS 1.3+mTLS clients reach fresh C++ cpp-ml workers,
  and the C++ client reaches independent Python, Node.js, Go, and Rust TLS
  servers. Go and Rust reverse servers are standalone commands, not client
  server modes. The gate verifies certificate admission, uint32-big-endian
  framing, and real responses; it does not claim cross-runtime transcript byte
  parity.
- Added shared `edge-small`, `edge-standard`, and `server` profiles that apply
  concrete session/frame/retry limits in Python, JavaScript, Go, Rust, and the
  C++ local queue. Native Linux ARM64 and macOS ARM64 qualification jobs cover
  the named runtime/security routes; no broader ARM64 device/OS or
  unstable-network guarantee is claimed.
- Added optional read-only Studio runtime security visibility for the Go ML
  gateway. Its bounded atomic event sink records certificate-authenticated
  sessions, profile/TLS state, replay and authorization rejections, jobs,
  artifacts, reconnects, and sanitized runtime status. Studio rejects unsafe,
  corrupt, or unconfigured sources and shows no mock session data.
- Added optional durable distributed-scheduler state in Python, Node, Go, and
  Rust. One shared checksummed/versioned fixture proves queued jobs, counters,
  and dedup identities across runtimes. Restarted in-flight assignments become
  explicit interrupted records and require retry/fail; no automatic execution
  or exactly-once guarantee is claimed. Pre-commit failures roll back, while a
  post-rename directory-sync uncertainty keeps the committed mutation visible.
- Added fail-closed unavailable-capability admission checks across the runtime
  scheduler/configuration paths: `metadata.require_exactly_once=true` is
  rejected with `exactly_once_unavailable`; OCSP fetch/responder/response
  configuration is rejected with `ocsp_fetch_unavailable` outside the scoped
  C++ response-file validator; unsupported ML-DSA/SLH-DSA and non-provider
  ECDSA artifact paths surface structured `artifact_algorithm_unsupported`
  errors.
- Added a checked, durable scheduler migration path for the supported legacy
  `v0` envelope and opt-in deterministic `auto_resume`/`AutoResumeInterrupted`
  in Python, Node, Go, and Rust. The mode is explicitly at-least-once; no
  exactly-once side-effect guarantee is claimed.
- Added validated private backup/restore operations to the four file-backed
  scheduler stores and the Go gateway job ledger. Backups use the same checksum,
  size, permission, and atomic replacement rules; unsupported state versions
  still fail closed. The explicitly supported v0 scheduler envelope is migrated
  in place with a new checksum. Automatic in-flight resume and exactly-once
  side effects remain intentionally unclaimed by default.
- Added live Go secure-frame checks for certificate expiry, durable revocation,
  and rotation-window expiry on existing TLS connections, plus real-process
  Studio event coverage for mTLS, progress, artifacts, reconnect, replay, and
  authorization rejection.
- Added bounded Go fuzz executions and property checks for durable state,
  transcript parsing/canonicalization, artifact metadata, edge configuration,
  Studio events, replay restart, revocation windows, and rotation windows.
- Added shared five-runtime security conformance vectors and live security
  benchmarks for TLS/reconnect/throughput/signatures and C++ workers.
- Added development file-backed credential stores in Python and Node with
  lifecycle/path/POSIX private-key permission checks.
- Added a provider-dependent Windows C++ `OsKeyStore` backed by Credential
  Manager, optional macOS Keychain/Linux Secret Service providers, plus a
  scoped native `SecureBuffer` wipe primitive used for C++ artifact signer key
  storage and tests. No cross-runtime OS-keystore or global zeroization
  guarantee is claimed.
- Added the C++ durable scheduler with private checksummed state, atomic
  restart recovery, v0→v1 migration, interrupted assignments, and opt-in
  deterministic at-least-once retry. C++ replay state also supports validated
  private backup/restore and v0-to-v1 migration. Added the common C++ TLS dispatcher with
  certificate-bound identity, replay, local authorization, and capability
  claim rejection before handler dispatch, and connected it to the direct
  cpp-ml TLS worker route.
- Added experimental isolated Crypto Lab (`packages/python/handoffkit/crypto_research`) for education, fuzzing, and research, strictly forbidden from production runtime fallbacks.
- Added a JavaScript package-consumer smoke gate: all eight tarballs are built,
  installed offline from generated artifacts, imported through public entry
  points, and checked for package metadata versions. This validates packaging;
  it does not imply registry publication or version alignment.

### Changed

- `gold_replay` and `mai_style_gold_replay` emit `accuracy: null`. They remain
  regression fixtures and never count as diagnostic accuracy. Vague queries
  return `evidence_not_available` instead of dumping `full_case`. Cost reports
  use versioned resource units rather than invented clinical USD.

### Security

- Public security status is now classified as stable, experimental,
  provider-dependent, planned, or unavailable in `HK_CSP_SECURITY.md`.
- Algorithm names, signature fields, JSON identity claims, and profile enums no
  longer count as support. Runtime capability reports are provider-derived and
  unsupported profile selection fails closed.
- Secure Python and Node sockets must originate from their validated transport
  factories; Go verifies the negotiated group when a TLS socket is wrapped as
  `hybrid-pq`. External contexts cannot silently bypass profile requirements.
- OCSP responder fetch, global zeroization guarantees, durable channel/session
  buffers, exactly-once external effects, and default automatic in-flight
  resumption remain unavailable. The five
  scheduler implementations expose opt-in at-least-once auto-resume only.
  C++ OpenSSL file-CRL/response validation, provider-selected OS keystores, and
  scoped native wiping are provider-dependent and integration-tested;
  artifact gates, Ed25519, provider-gated Python/C++ ECDSA, the development keystore, C++ native
  worker, benchmarks, ARM64/edge, and durable scheduler recovery are now
  experimental within their named tested scopes. Studio visibility remains
  experimental and limited to the optional Go gateway event source. Reload,
  rotation, and secure replay remain experimental per-runtime controls, not
  claims of universal production readiness.
- TLS integration certificates and private keys are generated into temporary
  directories for each test process. No reusable TLS or artifact-signing
  private key is committed as a test fixture.
- Added the evidence matrix in `docs/roadmap/1.19.0-FINAL-AUDIT.md`; it keeps
  declared, implemented, integrated, interoperability-tested, and
  production-ready claims separate for every scoped capability.

### Compatibility

- HK-CSP wire version remains `1.0`. Shared snake_case security conformance now
  covers Python, JavaScript, Go, Rust, and C++; TLS implementations use the
  same ephemeral certificate-generation profile, not pairwise interoperability
  across every runtime.
- Python package metadata marks this development baseline as Beta rather than
  Production/Stable.
- Rust dependency resolution is locked to the declared Rust 1.82 MSRV and CI
  checks the complete workspace with that toolchain.

## [1.18.0] - 2026-07-28

### Added

- Added HK-CSP distributed runtime scheduler, worker registry with load/capability routing, heartbeat monitoring, lease deadlines, and persistent deduplication log compaction in Rust, Python, JavaScript, and Go.
- Added native Go runtime module (`github.com/DaosPath/handoffkit/go`) implementing HK-CSP 1.0 contracts, framing, bounded channels, sessions, ACK/NACK, retries, file dedup store, worker CLI, TCP/Unix transports, and cross-runtime stdio/process interop.
- Added comprehensive reliability baseline across Python, JavaScript, Rust, Go, C++, and cpp-ml, including Hypothesis, fast-check, proptest, Go generative tests, Loom state models, state-machine generators, differential validation corpus, stress profiles, and cargo-fuzz targets.
- Added length-delimited TCP framing with reconnect backoff, Unix domain socket transports, subprocess worker execution with stderr draining, and distributed job assignment/progress contracts.
- Added C++ and cpp-ml CSP adapters for training/evaluation jobs, job progress, and artifact references.

### Security

- Enforced framing byte limits before memory allocation, JSON depth validation, connection attempt limits, secret sanitization in error tracebacks, and non-shell subprocess execution.
- Formally documented that cryptography, TLS, mTLS, post-quantum signatures, and key management remain reserved for HandoffKit 1.19.0.

### Compatibility

- Wire version remains `1.0`. Canonical snake_case contracts remain 100% interoperable across Python, JavaScript, Rust, Go, C++, and cpp-ml.


### Added

- Added independent `handoffkit-runtime`, `handoffkit-transport`, and
  `handoffkit-cli` Rust crates plus the expanded `handoffkit` facade.
- Added Tokio HK-CSP sessions, bounded FIFO channels, blocking backpressure,
  cancellation, deadlines, ACK/NACK, bounded retries, idempotency-key
  deduplication, local processes, progress events, and artifact references.
- Added native Rust Agent, Team, Recipe, and RecipeRunner execution with classic
  and additive session modes.
- Added native asynchronous tool registration/execution plus Team/Recipe trace
  construction and side-effect-free replay summaries.
- Added bounded NDJSON stdio and local subprocess transports with protocol
  negotiation, correlation, structured errors, graceful shutdown, and orphan
  protection.
- Added Rust CLI commands `csp doctor`, `inspect`, `run`, `worker`, and `demo`.
- Added real-process Rust to Python/JavaScript and Python/JavaScript to Rust
  interoperability demos and CI coverage.

### Security

- Added message-size and nesting-depth limits, timestamp/config validation,
  bounded process and pending-ACK counts, retry limits, malformed NDJSON
  rejection, unknown-message NACKs, and secret-redacted errors.

### Compatibility

- HK-CSP wire version remains `1.0`; canonical snake_case contracts are
  unchanged.
- Python, JavaScript, C++, Browser, ML, and Fusion product versions remain at
  their existing releases. Rust runtime packages alone advance to 1.17.0.
- Distributed execution, Unix sockets, TCP, WebSocket, daemon and Tauri adapters
  remain unimplemented and are not claimed by this release.

## [1.16.0] - 2026-07-27

### Added

- Published the HK-CSP 1.0 specification, security model, canonical JSON
  schemas, and deterministic fixtures for sessions, channels, envelopes,
  delivery results, process errors, worker capabilities, jobs, progress, and
  artifact references.
- Added Python asyncio CSP sessions with bounded FIFO channels, blocking
  backpressure, ACK/NACK, retries, in-memory deduplication, deadlines,
  cancellation, in-process execution, and NDJSON stdio transport.
- Added browser-safe `@handoffkit/csp` and Node stdio/subprocess transports.
- Added additive CSP session execution for Python and JavaScript Team/Recipe
  runtimes while preserving classic defaults.
- Converted the Rust package into lightweight `handoffkit-contracts`,
  `handoffkit-protocol`, and `handoffkit` workspace crates.
- Added C++20 HK-CSP codecs and cpp-ml adapters for training/evaluation jobs,
  progress, capabilities, and artifacts without changing training math.
- Added offline Python-to-JavaScript stdio interoperability coverage and CLI
  commands `handoffkit csp doctor`, `demo`, and `inspect`.

### Changed

- Aligned Python, JavaScript, Rust, and C++ metadata to 1.16.0.
- Extended CI/release gates with Rust fmt/clippy/tests, cpp-ml CSP adapters,
  cross-runtime stdio testing, `@handoffkit/csp`, and prepared crates.io OIDC
  publishing.

### Compatibility

- Existing classic Agent, Team, RecipeRunner, and HandoffState behavior remains
  unchanged by default. Distributed mode remains unavailable until 1.18 and
  fails with an explicit error.

## [1.15.0] - 2026-07-26

### Added

- **Browser runtime (cross-language):** first-party web search, fetch/explore,
  HTML→Markdown, research packs, ranking, soft-block detection, and optional
  disk cache — no Chrome, Cheerio, or paid search SDKs.
- Published new npm package **`@handoffkit/browser`** (tools +
  `createBrowserAgentKit`, CLI `handoffkit-js browse`).
- Python **`handoffkit.browser`** modular package + CLI `handoffkit browse` +
  recipe `run_web_grounded_answer`.
- C++ **`handoffkit::browser`** library split from core (`handoffkit_browser`),
  with explore headers kept as compatibility aliases.
- npm Trusted Publishing matrix and docs now include `@handoffkit/browser`.

### Changed

- JS recipes optionally peer on `@handoffkit/browser` for
  `runWebGroundedAnswer`.
- Aligned Python / JS / C++ package metadata to **1.15.0**.

### Fixed

- Made npm Trusted Publishing idempotent and independently retryable per package;
  existing versions are skipped and a manual npm-only retry accepts an explicit
  release version.
- Documented that every `@handoffkit/*` package requires its own npm Trusted
  Publisher configuration even though all packages share the same scope and
  workflow.

## [1.14.2] - 2026-07-23

### Added

- Added a fully native C++ DRACO benchmark runner with JSONL loading, direct
  baseline generation, all five Fusion tiers, resumable per-task artifacts,
  batched MET/UNMET judging, official weighted aggregation, manifests, and
  JSON/Markdown summaries.
- Added native OpenAI-compatible `GET /models` discovery through
  `providers models <name>`, including OpenCode Go model enumeration.
- Added the native C++ Fusion tier system: Lite, Medium, Pro, Ultra, and Genius,
  with configurable prompts, role packs, generation policy, structured
  handoffs, persistence, cache, panels, web context, and bounded DAG
  parallelism.
- Added complete Fusion documentation and a dedicated subsystem history:
  [Fusion architecture](docs/cpp/fusion/README.md) and
  [Fusion changelog](docs/cpp/fusion/CHANGELOG.md).

### Changed

- Hardened all six pnpm packages and the private web workspace with recursive
  syntax checks, strict cross-package TypeScript validation, atomic filesystem
  writes, safer scaffolding and extension loading, and consistent package
  metadata.
- Provider requests now compose caller cancellation with timeouts, avoid
  retrying user cancellations, bound and redact HTTP errors, and keep transport
  options out of model payloads.
- Real JavaScript Fusion now uses the public `@handoffkit/providers` API and
  runs panel calls concurrently with configurable cancellation and timeout.
- Release automation now validates actual pnpm tarballs and publishes npm and
  PyPI packages through GitHub Actions Trusted Publishing/OIDC.
- DRACO resume now freezes dataset content, provider/model, judge, tier, range,
  token budgets, retries, and parallelism so incompatible runs cannot silently
  reuse prior answers. `--no-resume` explicitly clears task artifacts first.
- Redesigned the monorepo README around the current 1.14.1 runtime status,
  contract model, evidence-producing demos, trace/replay workflow, and native
  C++ Fusion. The shared README SVG suite now uses one consistent visual system
  with larger type, reduced density, and improved dark-theme readability.
- Corrected the root runtime matrix so Rust is described as an unpublished
  contract layer rather than an installable crates.io package, and C++ is
  described as a native C++20 runtime.
- Centralized long-form runtime documentation under `docs/cpp`, `docs/python`,
  `docs/js`, and `docs/rust`, with a demo index for every runtime.
- Fusion Genius now uses six architect branches, merge, and final meta-judge
  refinement for eight planned calls.
- Loaded Fusion configuration remains authoritative unless the corresponding
  CLI option is explicitly supplied.

### Performance

- Ultra and Genius can execute independent DAG branches concurrently with a
  configurable limit. Local engineering measurements and conditions are
  recorded in the Fusion-specific changelog.

### Fixed

- Made C++ provider metrics and fallback state safe under concurrent calls,
  added configurable HTTP timeouts, and bounded/sanitized HTTP error bodies.
- Prevented malformed npm tarballs caused by incorrect Windows hard-link
  deduplication by packing with pnpm and inspecting archive entries before
  publication.
- DRACO criterion judging now disables provider-side hidden thinking when
  supported, preventing reasoning-only truncation before the required JSON
  verdicts are emitted.
- Corrected Fusion configuration precedence, output-path overrides, reasoning
  cache isolation, merge-only generation settings, and truncated
  reasoning-only OpenAI-compatible responses.
- Corrected stale Debug assumptions in Fusion corpus, scenario, tier, and
  request-shape tests.

### Validation

- The full JavaScript release gate passes 94 package/web tests, strict
  TypeScript 6 checking, ESLint, recursive source checks, and archive inspection
  for all six public npm packages.
- Python Ruff, tests, wheel/sdist build, and Twine metadata checks pass for the
  aligned 1.14.2 release.
- C++ core-only and HTTP builds pass their deterministic test suites, including
  provider concurrency, HTTP parsing, DRACO loader/scorer, and resume guards.
- A local DRACO-compatible baseline over tasks 0–19 generated with
  `opencode-go/qwen3.7-plus` and judged with
  `opencode-go/deepseek-v4-pro` (thinking disabled) completed 20/20 tasks and
  783/783 criteria with no missing verdicts. Mean normalized score was 37.194%
  and median 34.5248%. This is a local reproducible engineering run, not an
  official leaderboard submission.
- The native DRACO parser validates the local original dataset as 100 tasks,
  3,934 weighted criteria, and 10 domains. HTTP and offline C++ builds pass the
  deterministic loader/scorer/baseline/resume test with Echo.
- The dedicated Fusion Debug suites, base/deep scenarios, and CLI precedence
  checks pass. Detailed counts and local measurements are recorded in
  [Fusion changelog](docs/cpp/fusion/CHANGELOG.md).

## Changelog rules

- Add every user-visible feature, behavior change, performance improvement,
  compatibility change, deprecation, removal, security change, and meaningful
  bug fix to **Unreleased** in the same change that implements it.
- Keep this root changelog concise and release-oriented. Put subsystem-specific
  implementation history in that subsystem's changelog and link it here when
  the change affects users or releases.
- Use the sections `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`,
  `Security`, `Performance`, and `Validation` as applicable.
- Describe user impact and observable behavior, not only internal file changes.
- Include benchmark numbers only with the provider, model, conditions, and a
  clear statement of whether the result is local, reproducible, or official.
- At release time, move Unreleased entries under a versioned heading with an
  ISO date, then create a fresh Unreleased section.

## Subsystem and historical changelogs

- Fusion subsystem history: [`docs/cpp/fusion/CHANGELOG.md`](docs/cpp/fusion/CHANGELOG.md)
- Python package release history: [`packages/python/CHANGELOG.md`](packages/python/CHANGELOG.md)
- C++ release process and packaging notes: [`packages/cpp/RELEASE.md`](packages/cpp/RELEASE.md)
