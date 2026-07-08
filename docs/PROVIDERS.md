# Provider Registry and Model Routing

HandoffKit 1.4.x adds an experimental provider registry for diagnostics,
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
| `nvidia` | NVIDIA NIM / NVIDIA Build OpenAI-compatible endpoint | yes |
| `openrouter` | OpenRouter unified model routing | yes |
| `groq` | Groq OpenAI-compatible endpoint | yes |
| `grok` | xAI Grok OpenAI-compatible endpoint | yes |
| `together` | Together AI OpenAI-compatible endpoint | yes |
| `fireworks` | Fireworks AI OpenAI-compatible endpoint | yes |
| `deepinfra` | DeepInfra OpenAI-compatible endpoint | yes |
| `perplexity` | Perplexity Sonar endpoint | yes |
| `mistral` | Mistral AI OpenAI-compatible endpoint | yes |
| `cerebras` | Cerebras Inference OpenAI-compatible endpoint | yes |
| `sambanova` | SambaNova Cloud OpenAI-compatible endpoint | yes |
| `zai` | Z.ai / GLM OpenAI-compatible endpoint | yes |

## Native OpenAI-compatible Providers

HandoffKit 1.4.5 adds provider-specific wrappers for common OpenAI-compatible
APIs. They share the same `ProviderSelector`, `ProviderRouter`, and CLI flow,
but use provider-specific environment variables.

| Provider | API key env | Base URL env | Model env | Default model |
|---|---|---|---|---|
| `nvidia` | `NVIDIA_API_KEY` | `NVIDIA_BASE_URL` | `NVIDIA_MODEL` | `z-ai/glm-5.2` |
| `openrouter` | `OPENROUTER_API_KEY` | `OPENROUTER_BASE_URL` | `OPENROUTER_MODEL` | `openrouter/auto` |
| `groq` | `GROQ_API_KEY` | `GROQ_BASE_URL` | `GROQ_MODEL` | `llama-3.3-70b-versatile` |
| `grok` | `XAI_API_KEY` | `XAI_BASE_URL` | `XAI_MODEL` | `grok-4.3` |
| `together` | `TOGETHER_API_KEY` | `TOGETHER_BASE_URL` | `TOGETHER_MODEL` | `meta-llama/Llama-3.3-70B-Instruct-Turbo` |
| `fireworks` | `FIREWORKS_API_KEY` | `FIREWORKS_BASE_URL` | `FIREWORKS_MODEL` | `accounts/fireworks/models/deepseek-v3p1` |
| `deepinfra` | `DEEPINFRA_API_KEY` | `DEEPINFRA_BASE_URL` | `DEEPINFRA_MODEL` | `meta-llama/Llama-3.3-70B-Instruct-Turbo` |
| `perplexity` | `PERPLEXITY_API_KEY` | `PERPLEXITY_BASE_URL` | `PERPLEXITY_MODEL` | `sonar-pro` |
| `mistral` | `MISTRAL_API_KEY` | `MISTRAL_BASE_URL` | `MISTRAL_MODEL` | `mistral-small-latest` |
| `cerebras` | `CEREBRAS_API_KEY` | `CEREBRAS_BASE_URL` | `CEREBRAS_MODEL` | `llama3.1-8b` |
| `sambanova` | `SAMBANOVA_API_KEY` | `SAMBANOVA_BASE_URL` | `SAMBANOVA_MODEL` | `Meta-Llama-3.3-70B-Instruct` |
| `zai` | `ZAI_API_KEY` | `ZAI_BASE_URL` | `ZAI_MODEL` | `glm-5.2` |

Examples:

```bash
handoffkit providers models --provider nvidia
handoffkit providers select --provider nvidia --models z-ai/glm-5.2 --json
handoffkit providers models --provider openrouter
```

Real calls are opt-in:

```powershell
$env:NVIDIA_API_KEY="..."
handoffkit providers probe --provider nvidia --models z-ai/glm-5.2 --real

$env:OPENROUTER_API_KEY="..."
handoffkit providers probe --provider openrouter --models openrouter/auto --real
```

OpenRouter optional attribution headers can be set through environment
variables:

```powershell
$env:OPENROUTER_HTTP_REFERER="https://your-project.example"
$env:OPENROUTER_X_TITLE="HandoffKit"
```

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
