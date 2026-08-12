# @handoffkit/browser

First-party background web complement for HandoffKit agents: **search → fetch/explore → HTML parse → Markdown**.

No bundled browser engine, no Cheerio, and no paid search APIs. Native `fetch`,
first-party HTML extraction, and runtime-selectable adapters (DuckDuckGo HTML,
Wikipedia OpenSearch, or an explicit host-provided `user_browser` bridge).

Connects to `@handoffkit/core` via `ToolRegistry` / `createBrowserAgentKit()`.

The default runtime uses native HTTP transport in the current process. It does
not open a user-browser tab or read cookies. `user_browser` is opt-in and uses
only an explicit bridge supplied by the host application. A full bridge can
search and return page content through `fetch(url, options)` or
`open(url, options)`; the library then performs bounded link exploration and
emits source-labelled Markdown. It is provider-dependent and unavailable
without the required bridge methods.

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
  providers: ["duckduckgo", "wikipedia"], // default; applied to kit helpers and tools
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
pnpm --dir packages/js/cli exec handoffkit-js browse search "metformin"
pnpm --dir packages/js/cli exec handoffkit-js browse search "metformin" --provider wikipedia
pnpm --dir packages/js/cli exec handoffkit-js browse research "metformin" --max-pages 2 --markdown
pnpm --dir packages/js/cli exec handoffkit-js browse deep "metformin side effects" --max-pages 8 --max-depth 2 --markdown
pnpm --dir packages/js/cli exec handoffkit-js browse fixture
pnpm --dir packages/js/cli exec handoffkit-js browse tools
```

## Recipe helper

```js
import { runWebGroundedAnswer } from "@handoffkit/recipes";
const out = await runWebGroundedAnswer({ query: "metformin", maxPages: 2 });
```

## Offline tests / live smoke

```bash
pnpm --dir packages/js/browser test
BROWSER_LIVE=1 pnpm --dir packages/js/browser test
```

`gatherDeepWebResearch` records the transport, subqueries, candidates, depth,
page budget, blocked/error steps, citations, and elapsed time in
`ResearchPack.metadata`. `transport: "map"` keeps the HTTP route fully offline
for deterministic tests. The user-browser route is a host-controlled bridge;
it does not discover profiles or execute arbitrary page JavaScript itself.
Pass `providers: ["wikipedia"]`,
`providers: ["duckduckgo"]`, or `providers: ["user_browser"]` to select an
adapter. `createBrowserAgentKit({ providers: [...] })` carries the same
selection into `search`, `gather`, `deepGather`, and registered tools. The CLI
can report `user_browser_bridge_required` unless an embedding host supplies a
bridge; it cannot invent one. Unknown or unreachable providers remain
observable errors and never silently become another provider. Supplying
`BrowserCache` also records cache hits, misses, and writes.

## Python parity

```python
from handoffkit.browser import web_search, gather_web_research, make_fixture_map_transport
```
