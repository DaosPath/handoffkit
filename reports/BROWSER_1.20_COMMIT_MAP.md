# HandoffKit 1.20 — commit map after history rewrite

On 2026-10-15 the commits of `browser/1.20-platform` after `d7d3b38` were rewritten
to remove an attribution trailer from their messages. Trees are byte-identical
(same `git rev-parse HEAD^{tree}`), so CI runs and evidence that cite an old
SHA apply unchanged to the new SHA below. Old SHAs remain the `headSha` of
their GitHub Actions runs.

| Old | New | Subject |
|---|---|---|
| `3f27cb1` | `fc335a7` | fix(1.20): CI macOS x64 usa macos-15-intel (macos-13 retirado, job colgado 24h) |
| `c394e97` | `eb40876` | fix(1.20): Rust runtime usa CAS explicito en vez de fetch_update (deprecado en stable, try_update > MSRV 1.82) |
| `e5320ab` | `7a332e4` | fix(1.20): allow clippy::double_must_use en trait Transport (falso positivo de async_trait en clippy 1.99) |
| `dd0b99b` | `8b2da10` | docs(1.20): README al dia — 1.19.5 publicado (PyPI/npm/crates.io), seccion Browser 1.20, Go en runtimes |
| `3a3a685` | `7cb0382` | fix(1.20): OpenCode envia x-opencode-session (400 MissingSessionID) + catalogos y fusion al dia |
| `15ad204` | `0bb8b3d` | fix(1.20): cierra alertas CodeQL high — ReDoS lineal, hosts por URL, ids Web Crypto, init sin API key en claro |
| `efd1531` | `978f372` | docs(1.20): evidencia CI hosted 5 arquitecturas — Search 10/10, Performance 10/10 |
| `5ccdb7b` | `016b6a4` | fix(1.20): CLI JS init sin API key en claro (paridad Python) + scripts de evidencia con rutas post-reorg |
| `e4d9431` | `b98bd96` | fix(1.20): init renombra variable a credential_env_var (falso positivo CodeQL: solo guarda el nombre de la env var) |
| `f15884d` | `e170d98` | fix(1.20): paridad C++ browser con JS/Python — parsers lineales, hosts por hostname, data:/vbscript: bloqueados |
| `73a8b4d` | `fc9cd41` | docs(1.20): organiza repo y pone la documentacion al dia con 1.19.5 / 1.20 |
| `51bb356` | `13d72b1` | docs(1.20): refresca evidencia sobre el arbol actual (grounding, Chromium, Studio, C++ interop, bench, audit) |
| `8d90f75` | `5a236a3` | chore(1.20): version 1.20.0 en JS/Python/Rust/C++ — Production/Stable, changelog 1.20.0 |
| `7837464` | `8d45273` | docs(1.20): Security 10/10 — CodeQL 0 alertas abiertas en la rama; scorecard 100/100 |
| `35395bd` | `3eea66f` | refactor(1.20): npm 12 -> 10 paquetes — browser-core pasa a @handoffkit/browser/core, browser-lite se integra en @handoffkit/browser |
| `eefc540` | `b168ada` | chore(1.20): @handoffkit/clinical privado — no se publica en npm (lab experimental, sin validez clinica) |
| `17fc897` | `698d7fa` | chore(1.20): adelgaza PyPI y npm cli — sin clinical/crypto_research en el wheel, casos 100/400 bajo demanda |
| `03012a6` | `02812dc` | docs(roadmap): plan 1.21 — agentes generalistas siempre encendidos (estilo Dots) + limpieza de demos y handoffkit[labs] |
| `a14d9a0` | `c86d0c4` | docs(roadmap): 1.21 suma evals de agentes, evidencia programada, CI canario, paridad C++ e higiene; indice web propio cancelado para siempre |
| `eeca02b` | `a2d0049` | docs(1.20): evidencia del commit final 17fc897 — 9 paquetes npm x 5 arquitecturas, probe Google sin fallback |
| `2d9d8de` | `b67a2b9` | docs(roadmap): 1.21 gate 15 — soak del host de agentes (mide HandoffKit, no Chromium) |
| `17d084e` | `0a28c52` | docs(roadmap): 1.21 gate 15 — tests de liberacion de recursos en vez de soak (HandoffKit es base, no servicio) |
| `2238f85` | `c54eab6` | docs(roadmap): 1.21 — los dots viven en HandoffKit Harness; HandoffKit queda como base (contratos y librerias) |
