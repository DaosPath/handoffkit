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
browser tab, cookies, or visible window are required.

## Features

| Surface | Notes |
|---------|--------|
| `web_search` | DuckDuckGo HTML + Wikipedia OpenSearch (HTTP scrape, no paid SDK) |
| `web_fetch` / `web_explore` | Bounded fetch / BFS crawl + soft-block detection |
| `html_to_markdown` / `PageMarkdown` | First-party HTML→MD (no BeautifulSoup/Cheerio) |
| `gather_web_research` | Search-then-fetch `ResearchPack` |
| `gather_deep_web_research` | Bounded multi-query, multi-hop background research |
| `web_deep_research` | Agent-facing bounded multi-query, multi-hop background tool |
| `register_browser_tools` | 7 tools on `ToolRegistry` |
| `create_browser_agent_kit` | Transport + tools + helpers |
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
bounded HTTP/fixture route, not a JavaScript-capable Browser Real engine.
`DEFAULT_SEARCH_PROVIDERS` is the explicit DuckDuckGo/Wikipedia default; kit
provider settings propagate to direct helpers and registered tools.

## Recipe

```python
from handoffkit.recipes.web import run_web_grounded_answer
```
