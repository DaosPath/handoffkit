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
the library.

## Features

| Surface | Notes |
|---------|--------|
| `web_search` | DuckDuckGo/Wikipedia HTTP adapters or explicit `user_browser` bridge |
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
bounded HTTP/fixture route unless `user_browser` is selected; that route uses
only the explicit page bridge and is not a JavaScript-capable Browser Real
engine. The bridge must expose `search(query, max_results=..., timeout_ms=...)`
and return a list or `{"results": [...]}`. For page research it must also
expose `fetch(url, ...)` or `open(url, ...)`, returning `html`, `text`,
`markdown`, and/or `links`. Invalid URLs/links are dropped. Missing page
access returns `error_code == "user_browser_fetch_bridge_required"` and never
silently falls back to HTTP. `ResearchPack.to_agent_markdown()` and the
`agent_markdown` wire field provide bounded queries, citations, evidence, and
errors for agent context. Selecting only `user_browser` without a search
bridge returns `error_code == "user_browser_bridge_required"` and never
silently falls back to DuckDuckGo.
`DEFAULT_SEARCH_PROVIDERS` is the explicit DuckDuckGo/Wikipedia default; kit
provider settings propagate to direct helpers and registered tools. Use
`create_browser_agent_kit({"providers": ["user_browser"], "user_browser": bridge})`
to opt in.

`kit["search_many"]([...])` runs bounded focused searches, merges duplicate
URLs, and preserves query provenance and scores. `gather_web_research` also
expands up to `max_sub_queries` variants when no seed URL exists. Bridge
exploration ranks links against the query and skips likely action links such as
logout/delete/unsubscribe by default; traversal metadata records these skips.

## Recipe

```python
from handoffkit.recipes.web import run_web_grounded_answer
```
