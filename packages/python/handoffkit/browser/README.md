# handoffkit.browser

First-party web search / fetch / explore / HTML→Markdown for Python agents.

Separate from core — import explicitly:

```python
from handoffkit.browser import (
    create_browser_agent_kit,
    gather_web_research,
    make_fixture_map_transport,
    web_search,
)
```

Wire JSON uses **snake_case** (parity with `@handoffkit/browser` and C++ `handoffkit::browser`).

## Features

| Surface | Notes |
|---------|--------|
| `web_search` | DuckDuckGo HTML + Wikipedia OpenSearch (HTTP scrape, no paid SDK) |
| `web_fetch` / `web_explore` | Bounded fetch / BFS crawl + soft-block detection |
| `html_to_markdown` / `PageMarkdown` | First-party HTML→MD (no BeautifulSoup/Cheerio) |
| `gather_web_research` | Search-then-fetch `ResearchPack` |
| `register_browser_tools` | 6 tools on `ToolRegistry` |
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

## Recipe

```python
from handoffkit.recipes.web import run_web_grounded_answer
```
