# handoffkit.browser

First-party background web search / fetch / explore / HTML→Markdown for Python agents.

Separate from core — import explicitly:

```python
from handoffkit.browser import (
    create_browser_agent_kit,
    DEFAULT_SEARCH_PROVIDERS,
    gather_web_research,
    make_fixture_map_transport,
    web_search,
)

kit = create_browser_agent_kit({"providers": ["wikipedia"]})
hits = kit["search"]("metformin")
```

Wire JSON uses **snake_case** (parity with `@handoffkit/browser` and C++ `handoffkit::browser`).

The default transport is bounded native HTTP in the current process. No user
browser tab or cookies are read. `user_browser` is an opt-in,
provider-dependent bridge supplied by the host application. A full bridge
exposes `search(...)` and `fetch(url, ...)` (or `open(url, ...)`) for page
content; bounded link exploration and source-labelled Markdown then stay in
the library. `default_browser` uses an explicit loopback/HTTPS JSON bridge
owned by the host's system-default browser. Set
`HANDOFFKIT_DEFAULT_BROWSER_BRIDGE_URL` or pass `DefaultBrowserBridge(endpoint=...)`.
The host implements `POST /search` and `POST /fetch`; HandoffKit never opens
the browser, reads cookies, or silently falls back to HTTP. Missing endpoints,
unsafe remote HTTP, timeouts, and malformed responses fail closed with
`default_browser_*` error codes.

## Features

| Surface | Notes |
|---------|--------|
| `web_search` | Google/DuckDuckGo/Wikipedia HTTP adapters or explicit `user_browser` / `default_browser` bridge |
| `web_fetch` / `web_explore` | Bounded fetch / BFS crawl + soft-block detection |
| `html_to_markdown` / `PageMarkdown` | First-party HTML→MD (no BeautifulSoup/Cheerio) |
| `gather_web_research` | Search-then-fetch `ResearchPack` |
| `gather_deep_web_research` | Bounded multi-query, multi-hop background research |
| `web_deep_research` | Agent-facing bounded multi-query, multi-hop background tool |
| `register_browser_tools` | 7 tools on `ToolRegistry` |
| `create_browser_agent_kit` | Transport + tools + helpers; optional user-browser bridge |
| Disk cache | `BrowserCache` / `use_cache=True` → `.cache/handoffkit-browser` |

## CLI

```bash
handoffkit browse search "metformin"
handoffkit browse fetch https://example.com --markdown
handoffkit browse research "metformin" --max-pages 2 --markdown
handoffkit browse fixture
handoffkit browse tools
```

## Tests

```bash
pytest packages/python/tests/test_browser.py -q
HANDOFFKIT_BROWSER_LIVE=1 pytest packages/python/tests/test_browser.py -q -k live
```

`gather_deep_web_research` records subqueries, candidates, limits, transport,
depth, citations, errors and duration in `ResearchPack.metadata`. It is a
bounded HTTP/fixture route unless `user_browser` or `default_browser` is selected;
that route uses only the explicit page bridge and is not a JavaScript-capable Browser Real
engine. The bridge must expose `search(query, max_results=..., timeout_ms=...)`
and return a list or `{"results": [...]}`. For page research it must also
expose `fetch(url, ...)` or `open(url, ...)`, returning `html`, `text`,
`markdown`, and/or `links`. Invalid URLs/links are dropped. Missing page
access returns `error_code == "user_browser_fetch_bridge_required"` and never
silently falls back to HTTP. `ResearchPack.to_agent_markdown()` and the
`agent_markdown` wire field provide bounded queries, citations, evidence, and
errors for agent context. Selecting only `user_browser` without a search
bridge returns `error_code == "user_browser_bridge_required"` (or
`default_browser_bridge_required`) and never
silently falls back to DuckDuckGo.
`DEFAULT_SEARCH_PROVIDERS` is the explicit DuckDuckGo/Wikipedia default; pass
`providers=["google"]` to use the native Google HTML adapter. It unwraps
Google result redirects and rejects sponsored/ad redirectors and Google
navigation links before host ranking. HTML extraction drops explicitly marked
ad/promotion/consent/newsletter/paywall/popup/banner containers; this is a
bounded heuristic, not a promise to recognise every publisher's ad markup. Kit
provider settings propagate to direct helpers and registered tools. Use
`create_browser_agent_kit({"providers": ["user_browser"], "user_browser": bridge})`
to opt in. Use `providers=["default_browser"]` with `DefaultBrowserBridge`
for the host's system-default browser bridge.

Grounded multi-query recipes run sequentially with a bounded delay by default,
reducing burst rate limits against public HTML endpoints. Provider challenge
pages fail closed with a structured error.

`run_web_grounded_answer` accepts `providers=["google"]`,
`providers=["default_browser"]`, and bounded
`search_queries=[...]` to merge focused native HTTP searches before selecting
and fetching Markdown evidence. It does not open Chrome or read a user-browser
session.

### Visibilidad y atribución

`user_browser` no oculta una pestaña. HandoffKit solo orquesta las llamadas
`search`/`fetch`/`open` del puente inyectado; la aplicación host controla la
interfaz, la sesión, los permisos y si el navegador funciona en primer plano
o en segundo plano. Un puente que conduce una pestaña visible debe informarse
como arnés visible del host, no como navegador en segundo plano de HandoffKit.
Para operar sin interfaz usando la sesión del usuario se necesita un puente
del host basado en service worker, documento offscreen o equivalente. Si no
existe, usa el transporte HTTP predeterminado para investigación invisible o
falla cerrado con `user_browser_bridge_required` o
`default_browser_bridge_required`.

`kit["search_many"]([...])` runs bounded focused searches, merges duplicate
URLs, and preserves query provenance and scores. `gather_web_research` also
expands up to `max_sub_queries` variants when no seed URL exists. Bridge
exploration ranks links against the query and skips likely action links such as
logout/delete/unsubscribe by default; traversal metadata records these skips.

## Recipe

```python
from handoffkit.recipes.web import run_web_grounded_answer
```

La receta ejecuta el flujo completo: búsqueda live → índice Markdown →
selección exacta de URLs por el proveedor → páginas convertidas a Markdown →
respuesta basada en todas las páginas. `strict_grounding=True` (por defecto)
falla cerrado si el proveedor no cumple los contratos de selección o cobertura;
las URLs quedan solo en la evidencia operativa, no son obligatorias en la
respuesta. Candidatos binarios/descarga (PDF, archivos comprimidos, Office y
rutas `/pdf/` o `/download/`) no entran al índice; si una página seleccionada
no se puede recuperar, la ruta falla cerrado y no genera respuesta parcial.

Para investigación auditable, `evidence_sections` extrae un hallazgo por
requisito y exige una cita breve localizada nuevamente en el Markdown
recuperado. Una cita literal pero semánticamente ajena se rechaza.
`synthesis_sections` solo puede derivar conclusiones desde identificadores del
ledger verificado: una inferencia positiva requiere al menos dos afirmaciones
soportadas. Una rúbrica fija también puede declarar `deterministic_findings`
con un enunciado y `evidence_claims` exactos. La ruta acepta la inferencia solo
cuando todos los IDs existen y sus estados permiten esa polaridad; es una regla
del caller, no evidencia generada por el modelo. La evidencia ausente solo puede
sustentar una limitación. `dossier_compose_mode="deterministic"` omite la
redacción libre final y renderiza el ledger. `seed_results` prioriza URLs
conocidas, pero las páginas se recuperan en vivo y permanecen dentro de la
auditoría de búsqueda.

Las secciones directas pueden declarar anclas `deterministic_evidence`. Cada
ancla contiene requisito, enunciado y cita esperada; solo queda soportada si la
página recuperada en vivo todavía contiene la cita y la cita/enunciado son
relevantes al requisito. Una ancla ausente u obsoleta queda `not_found`, sin
fallback a una afirmación no verificada.

Las secciones pueden renderizarse como `bullets`, `paragraph` o `table`. Una
tabla declara `columns` y cada inferencia determinista aporta `cells` con la
misma longitud; filas no soportadas no aparecen como datos verificados.

### Grounding live reproducible

El corpus live de 30 preguntas se ejecuta desde el runner JavaScript del
monorepo (`pnpm browser:grounding:live`) porque necesita el transporte HTTPS
WebExplorer. El informe guarda únicamente metadatos, SHA-256 y citas breves en
`reports/BROWSER_1.20_GROUNDING_LIVE.json`; no usa fixtures ni afirma precisión
de respuestas de un modelo. `live_grounding_oracle` y
`score_live_grounding_run` ofrecen la misma validación fail-closed en Python
para consumir una corrida ya capturada. El corpus expira y debe refrescarse
antes de repetir la calificación.
