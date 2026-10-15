# Maratón 1.20 — Sesión Dodo (2026-08-22, Orange Pi 6 Plus ARM64)

Sesión de trabajo autónomo nocturno. Todo verificado con CI local en ARM64
nativo; sin push a GitHub (sin credenciales en esta máquina, decisión de
Jampi: opción 2, solo local).

## Entregado

### 1. Proveedor SearXNG (`searxng`) para web_search — Python + JS

HandoffKit 1.20 ahora puede buscar vía instancia SearXNG autoalojada
(Dodo Explorer) en lugar de depender de motores de terceros.

- Python: `handoffkit/browser/search.py`
  - `search_searxng()` + rama en `web_search()` + alias `sx`/`dodo`
  - engine trace `searxng_json`; fallo cerrado `provider_unavailable`
    / `searxng_unconfigured` si falta la URL
- JS: `packages/js/browser/src/search.js` + `browser-core/constants.js`
  - `searxngJsonSearch()` + rama en `searchWithProviders()`
  - aliases en `PROVIDER_ALIASES` (sx, dodo)
- Configuración: env var `HANDOFFKIT_SEARXNG_URL` (p. ej.
  `http://127.0.0.1:8888`)
- Los resultados fluyen por ranking, allow/deny hosts y cache como
  cualquier proveedor built-in.

### 2. Verificación local (CI ARM64 casero)

| Suite | Resultado |
|---|---|
| pytest browser (test_browser + core + grounding) | 60/60 pass |
| pytest searxng (nuevo) | 6/6 pass |
| ruff check search.py + tests | clean |
| node:test browser-core core.test.js | 34/34 pass |
| node:test browser browser.test.js | 37/37 (+1 skip preexistente) |
| node:test browser-searxng (nuevo) | 3/3 pass |
| cmake C++ build ARM64 (flags del CI hosted) | OK |
| ctest 10 targets edge/security ARM64 | 10/10 passed |
| benchmark TLS handshake ARM64 nativo | 25 iters, p50<=p95<=p99 ✓ |

### 3. Diagnóstico del CI rojo (release/1.19.5)

Los jobs "Linux/macOS ARM64 edge qualification" fallan en GitHub-hosted
pero los mismos pasos pasan 10/10 aquí (ARM64 real). El fix `3348c73`
ya apunta a targets existentes; el fallo restante es ambiental del
runner hosted (probablemente el paso del benchmark TLS o dependencias
del runner), no del código. Pendiente: leer logs completos del run
32558423748 (requiere token admin) o re-disparar tras merge.

### 4. Documentación

- `packages/python/handoffkit/browser/README.md`: sección "SearXNG provider"
- `docs/roadmap/1.20-BROWSER-BACKGROUND-STATUS.md`: adaptadores actualizados

## Estado del repo

- Rama `browser/1.20-searxng` (= origin/browser/1.20-platform + 1 commit)
- Commit: feat(browser): add self-hosted SearXNG search provider
- Sin push (sin credenciales). Al tenerlas:
  `git push -u origin browser/1.20-searxng`

## Siguientes pasos sugeridos

1. Push + PR contra `browser/1.20-platform`, observar CI hosted
2. Portar `searxng` a Rust/C++/Go contracts (mismo patrón que DDG)
3. Añadir `searxng` a fixtures del conformance suite cross-runtime
4. Studio web: selector de proveedor incluye searxng cuando el host
   exporta HANDOFFKIT_SEARXNG_URL
