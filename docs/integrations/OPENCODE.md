# OpenCode Go and OpenCode Zen

HandoffKit can use OpenCode Go and OpenCode Zen as real providers through the
standard library HTTP client. No provider SDK is required.

## Setup

```powershell
$env:OPENCODE_API_KEY="..."
```

Do not commit API keys. HandoffKit never prints the configured key and sanitizes
provider error bodies before raising `ProviderExecutionError`.

## OpenCode Go

```python
from handoffkit import Agent
from handoffkit.providers import OpenCodeGoProvider

provider = OpenCodeGoProvider(model="deepseek-v4-flash")
agent = Agent("Architect", "Create concise implementation plans.", provider=provider)

print(agent.run("Create a plan for a Python CLI calculator."))
```

Run:

```powershell
$env:OPENCODE_GO_MODEL="deepseek-v4-flash"
python examples/opencode_go_agent.py
```

Endpoint routing:

| Model family | Endpoint |
|---|---|
| GLM, Kimi, MiMo, DeepSeek | `/chat/completions` |
| MiniMax, Qwen | `/messages` |

OpenCode config ids such as `opencode-go/kimi-k2.7-code` are accepted.

## OpenCode Zen

```python
from handoffkit import Agent
from handoffkit.providers import OpenCodeZenProvider

provider = OpenCodeZenProvider(model="gpt-5.4")
agent = Agent("Architect", "Create concise implementation plans.", provider=provider)

print(agent.run("Create a plan for a Python CLI calculator."))
```

Run:

```powershell
$env:OPENCODE_ZEN_MODEL="gpt-5.4"
python examples/opencode_zen_agent.py
```

Endpoint routing:

| Model family | Endpoint |
|---|---|
| GPT | `/responses` |
| Claude, Qwen | `/messages` |
| DeepSeek, MiniMax, GLM, Kimi, Grok, free models | `/chat/completions` |

OpenCode config ids such as `opencode/gpt-5.4` are accepted. Gemini models use
OpenCode's Google-style endpoint and currently raise a clear configuration
error.

## Model Listing

```python
from handoffkit.providers import list_opencode_models

print(list_opencode_models(catalog="go"))
print(list_opencode_models(catalog="zen"))
```

## Environment Variables

| Variable | Meaning |
|---|---|
| `OPENCODE_API_KEY` | Required API key for Go or Zen. |
| `OPENCODE_MODEL` | Shared model fallback. |
| `OPENCODE_GO_MODEL` | Go-specific model override. |
| `OPENCODE_ZEN_MODEL` | Zen-specific model override. |
| `OPENCODE_BASE_URL` | Shared base URL override. |
| `OPENCODE_GO_BASE_URL` | Go-specific base URL override. |
| `OPENCODE_ZEN_BASE_URL` | Zen-specific base URL override. |
