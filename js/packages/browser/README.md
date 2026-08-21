# @handoffkit/browser

First-party web complement for HandoffKit agents: **search → fetch/explore → HTML parse → Markdown**.

No Chrome, no Cheerio, no paid search APIs. Native `fetch`, first-party HTML extractor, public search endpoints (DuckDuckGo HTML + Wikipedia OpenSearch).

Connects to `@handoffkit/core` via `ToolRegistry` / `createBrowserAgentKit()`.

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

## CLI

```bash
pnpm --dir js/packages/cli exec handoffkit-js browse search "metformin"
pnpm --dir js/packages/cli exec handoffkit-js browse research "metformin" --max-pages 2 --markdown
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
```

## Python parity

```python
from handoffkit.browser import web_search, gather_web_research, make_fixture_map_transport
```
