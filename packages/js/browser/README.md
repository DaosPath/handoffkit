# @handoffkit/browser

First-party background web complement for HandoffKit agents: **search → fetch/explore → HTML parse → Markdown**.

No Chrome, no Cheerio, no paid search APIs. Native `fetch`, first-party HTML extractor, and runtime-selectable public adapters (DuckDuckGo HTML and Wikipedia OpenSearch).

Connects to `@handoffkit/core` via `ToolRegistry` / `createBrowserAgentKit()`.

The default runtime uses native HTTP transport in the current process. It does
not open a user-browser tab, read cookies, or require a visible window.

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
  useCache: true, // .cache/handoffkit-browser
});

// ToolRegistry ready for agents (use registry.aexecute)
const { registry } = kit;

const hits = await kit.search("metformin mechanism");
const pack = await kit.gather({ query: "metformin side effects", maxPages: 3 });
console.log(pack.promptSection());
```

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
`ResearchPack.metadata`. `transport: "map"` keeps the same route fully offline
for deterministic tests. The deeper route remains bounded HTTP research; it
is not Browser Real and does not execute arbitrary page JavaScript. Pass
`providers: ["wikipedia"]` or `providers: ["duckduckgo"]` to select an
adapter. Unknown or unreachable providers remain observable errors and never
silently become another provider. Supplying `BrowserCache` also records cache
hits, misses, and writes.

## Python parity

```python
from handoffkit.browser import web_search, gather_web_research, make_fixture_map_transport
```
