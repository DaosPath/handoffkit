# Provider Registry and Model Routing

HandoffKit 1.4.0 adds an experimental provider registry for diagnostics,
model selection, and fallback routing. The API is useful now, but may be
refined in later 1.x releases.

## Offline by Default

Provider CLI commands do not call real APIs unless `--real` is passed.

```bash
handoffkit providers list
handoffkit providers models --provider opencode-go
handoffkit providers select --provider opencode-go --models mimo-v2.5,deepseek-v4-flash --json
```

Real probes require explicit opt-in and a scoped provider key:

```powershell
$env:OPENCODE_API_KEY="..."
handoffkit providers probe --provider opencode-go --models mimo-v2.5 --real
```

## Python API

```python
from handoffkit.providers import ModelCandidate, ProviderRouter, ProviderSelector

selector = ProviderSelector()
print([spec.name for spec in selector.list_providers()])
print(selector.known_models("opencode-go"))

result = selector.select("opencode-go", ["mimo-v2.5", "deepseek-v4-flash"])
print(result.to_json())

router = ProviderRouter(
    [
        ModelCandidate("opencode-go", "mimo-v2.5"),
        ModelCandidate("opencode-go", "deepseek-v4-flash"),
    ]
)
print(router.generate("Create a concise architecture plan."))
```

## Built-in Providers

| Provider | Purpose | Network listing |
|---|---|---|
| `opencode-go` | OpenCode Go model catalog | yes |
| `opencode-zen` | OpenCode Zen model catalog | yes |
| `openai-compatible` | Generic OpenAI-compatible endpoint | yes |
| `ollama` | Local Ollama provider | no |

## Safety

- Secrets are read from environment variables or explicit constructor args.
- CLI output never prints configured API keys.
- Provider errors redact common token shapes before reporting.
- OpenCode retries transient `429`, `5xx`, and transport failures with
  configurable `RetryPolicy`.

## Research Benchmarks

Clinical benchmark scripts are research-only and opt-in. They are not part of
normal package tests, do not make clinical claims, and must not be used for
patient care.
