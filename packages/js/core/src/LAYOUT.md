# @handoffkit/core source layout

Modular split (P1/P2) — public entry remains `index.js`.

| Module | Responsibility |
|--------|----------------|
| `utils.js` | Constants, pure helpers, JSON helpers, version |
| `contracts.js` | HandoffState, Validation*, ContractParity |
| `providers-core.js` | BaseProvider, Echo, OpenAI, Ollama |
| `safety.js` | Dangerous commands, approval helpers |
| `tools.js` | Tool*, ToolRegistry, ProviderToolAdapter |
| `agent.js` | Agent, AgentRunResult, ToolAgentRunResult |
| `team.js` | HandoffProtocol, Team |
| `quality.js` | HandoffQuality* |
| `tracing.js` | Trace*, RunTrace, ReplayRunner |
| `context.js` | Context* packs |
| `evaluation.js` | WorkflowEvaluator |
| `memory.js` | Memory* |
| `extensions.js` | Extension* |

`index.monolith.js` is a backup of the pre-split sources.  
`split.mjs` regenerates modules from the monolith if needed.

```bash
cd packages/js/core
pnpm test
```
