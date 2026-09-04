# @handoffkit/browser

First-party background web complement for HandoffKit agents: **search → fetch/explore → HTML parse → Markdown**.

No bundled browser engine, no Cheerio, and no paid search APIs. Native `fetch`,
first-party HTML extraction, and runtime-selectable adapters (Google HTML,
DuckDuckGo HTML, Wikipedia OpenSearch, an explicit host-provided `user_browser`
bridge, or a `default_browser` bridge backed by the operating system's default
browser).

Connects to `@handoffkit/core` via `ToolRegistry` / `createBrowserAgentKit()`.

The default runtime uses native HTTP transport in the current process. It does
not open a user-browser tab or read cookies. `user_browser` is opt-in and uses
only an explicit bridge supplied by the host application. A full bridge can
search and return page content through `fetch(url, options)` or
`open(url, options)`; the library then performs bounded link exploration and
emits source-labelled Markdown. It is provider-dependent and unavailable
without the required bridge methods.

`default_browser` is an explicit loopback/HTTPS JSON bridge. Create it with
`createDefaultBrowserBridge({ endpoint: "http://127.0.0.1:8765" })` or set
`HANDOFFKIT_DEFAULT_BROWSER_BRIDGE_URL`. The host bridge owns the system
browser session and implements `POST /search` and `POST /fetch`; HandoffKit
never launches the browser, reads cookies, or silently falls back to HTTP.
Missing endpoints, unsafe remote HTTP, timeouts, and malformed responses fail
closed with `default_browser_*` error codes.

## Install

```bash
pnpm add @handoffkit/core @handoffkit/browser
```

## Serious agent construction

```js
import { createBrowserAgentKit } from "@handoffkit/browser";

const kit = createBrowserAgentKit({
  maxPages: 3,
  allowHosts: ["wikipedia.org", "nih.gov", "drugs.com"],
  providers: ["google", "duckduckgo", "wikipedia"], // explicit; default remains DDG/Wikipedia
  useCache: true, // .cache/handoffkit-browser
});

// ToolRegistry ready for agents (use registry.aexecute)
const { registry } = kit;

const hits = await kit.search("metformin mechanism");
const pack = await kit.gather({ query: "metformin side effects", maxPages: 3 });
console.log(pack.promptSection());
```

### Optional user-browser provider

An embedding application can expose its already-authorized browser session as a
small bridge. HandoffKit never discovers profiles, exports cookies, or controls
the browser implicitly:

```js
const userBrowser = {
  async search(query, { maxResults, timeoutMs }) {
    // The host owns this implementation and its permission boundary.
    return { results: await hostBrowserSearch(query, { maxResults, timeoutMs }) };
  },
  async fetch(url, options) {
    // Return DOM/reader content from the already-authorized session.
    return hostBrowserPage(url, options);
  },
};

const kit = createBrowserAgentKit({
  providers: ["user_browser", "duckduckgo"], // explicit composition
  userBrowser,
});
```

Search bridge results must contain a title and an `http(s)` URL (or equivalent
`href`/`link`). Page responses may contain `html`, `text`, `markdown`, and
`links`; HTML is normalized with the first-party extractor. Invalid URLs and
links are discarded. `gather`/`deepGather` enforce page, depth, host, link, and
timeout bounds and return `user_browser_fetch_bridge_required` when page
access is not exposed. They do not silently read pages with the HTTP
transport. `ResearchPack.toAgentMarkdown()` and the `agent_markdown` wire
field provide a bounded bundle with queries, citations, evidence, and errors.
Requesting only `user_browser` without a search bridge returns
`error_code: "user_browser_bridge_required"`; it does not silently switch to
DuckDuckGo.

For several focused searches, `kit.searchMany([...])` uses bounded
concurrency, merges duplicate URLs, and records matching query variants plus
a deterministic score. `gather`/`deepGather` use focused query variants
automatically (`maxSubQueries`, default 3) when no seed URL exists. During
bridge exploration, links are ranked against the query and likely action URLs
(`logout`, `delete`, `unsubscribe`, etc.) are skipped by default; traversal
metadata exposes skipped actions and visited depths.

## Agent tools

| Tool | Purpose |
|------|---------|
| `web_search` | Live ranked search → `{ title, url, score }[]` |
| `web_fetch` | Single-page scrape + extract |
| `web_explore` | Bounded BFS crawl |
| `html_to_markdown` | HTML (or URL) → Markdown / readme |
| `web_fetch_markdown` | Fetch → `PageMarkdown` |
| `web_research` | Search-then-fetch `ResearchPack` |
| `web_deep_research` | Bounded multi-query, multi-hop background research tool |
| `gatherDeepWebResearch` / `kit.deepGather` | Same deep route as a library helper |

## CLI

```bash
pnpm --dir js/packages/cli exec handoffkit-js browse search "metformin"
pnpm --dir js/packages/cli exec handoffkit-js browse search "metformin" --provider wikipedia
pnpm --dir js/packages/cli exec handoffkit-js browse research "metformin" --max-pages 2 --markdown
pnpm --dir js/packages/cli exec handoffkit-js browse deep "metformin side effects" --max-pages 8 --max-depth 2 --markdown
pnpm --dir js/packages/cli exec handoffkit-js browse fixture
pnpm --dir js/packages/cli exec handoffkit-js browse tools

```

## Recipe helper

```js
import { runWebGroundedAnswer } from "@handoffkit/recipes";
const out = await runWebGroundedAnswer({ query: "metformin", maxPages: 2 });
```

## Offline tests / live smoke

```bash
pnpm --dir js/packages/browser test
BROWSER_LIVE=1 pnpm --dir js/packages/browser test
pnpm browser:grounding:live

```

`browser:grounding:live` is a real-HTTPS, 30-question qualification. It
fetches the expiring corpus through `WebExplorer`, writes page SHA-256 hashes
and live quotes to `reports/BROWSER_1.20_GROUNDING_LIVE.json`, and exits non-zero
on unavailable pages, stale sources, invented URLs, or missing evidence. Its
deterministic oracle measures retrieval/citation integrity only; it does not
claim model-answer accuracy.

`gatherDeepWebResearch` records the transport, subqueries, candidates, depth,
page budget, blocked/error steps, citations, and elapsed time in
`ResearchPack.metadata`. `transport: "map"` keeps the HTTP route fully offline
for deterministic tests. The user-browser route is a host-controlled bridge;
it does not discover profiles or execute arbitrary page JavaScript itself.
Pass `providers: ["google"]`, `providers: ["wikipedia"]`,
`providers: ["duckduckgo"]`, `providers: ["user_browser"]`, or
`providers: ["default_browser"]` to select an
adapter. `createBrowserAgentKit({ providers: [...] })` carries the same
selection into `search`, `gather`, `deepGather`, and registered tools. The CLI
can report `user_browser_bridge_required` or `default_browser_bridge_required`
unless an embedding host supplies a bridge; it cannot invent one. Unknown or
unreachable providers remain observable errors and never silently become
another provider. Supplying `BrowserCache` also records cache hits, misses,
and writes.

Key-gated JSON providers (`brave`, `bing`, `kagi`) query the vendor APIs and
need `HANDOFFKIT_BRAVE_API_KEY`, `HANDOFFKIT_BING_API_KEY`, or
`HANDOFFKIT_KAGI_API_KEY`; without its key the provider reports
`provider_unavailable` and never calls the network.

Keyless HTML providers (`mojeek`, `marginalia`, `startpage`) extract anchors
leniently with own-domain links dropped; unknown markup yields no hits.
`suggestQueries("brave"|"bing", query)` returns up to 8 completions.

The Google adapter is HandoffKit's native HTTP route. It does not open Chrome,
read cookies, or use a user session. It unwraps Google result redirects and
rejects sponsored/ad redirectors and Google navigation links before normal host
ranking. HTML extraction also drops explicitly marked ad, promotion, consent,
newsletter, paywall, popup, and banner containers before Markdown conversion.
This is a bounded heuristic, not a guarantee that every publisher's ad markup
is recognised.

### Visibility and attribution

`user_browser` does not make a browser tab invisible. HandoffKit only
orchestrates the injected `search`/`fetch`/`open` calls; the embedding host
owns the browser UI, session, permissions, and foreground/background policy.
A bridge implemented by driving a visible tab must be reported as a visible
host harness, not as a background HandoffKit browser. Invisible operation with
the user's session requires a host-provided extension service worker,
offscreen document, or equivalent background bridge. If that bridge is not
available, use the default HTTP transport for background research or fail
closed with `user_browser_bridge_required`.

## Python parity

```python
from handoffkit.browser import web_search, gather_web_research, make_fixture_map_transport
```
