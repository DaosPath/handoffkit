# Fusion configuration

Full architecture and schema reference: [Fusion architecture](README.md).

Fusion can be configured without recompiling. Shipped example files remain under
[`packages/cpp/examples/fusion/configs/`](../../../packages/cpp/examples/fusion/configs/).


```bash
handoffkit-cli fusion --config packages/cpp/examples/fusion/configs/fusion_research_genius.json --prompt "Your task"
```

Useful CLI overrides:

```text
--prompt-config FILE       prompt templates, preambles, variables, and phase requirements
--role-file FILE           custom architects, skeptics, labels, and merger
--branches N               DAG breadth
--parallel-branches          execute independent DAG branches concurrently
--no-parallel-branches       force deterministic sequential execution
--max-parallel N             bounded branch concurrency (1..8)
--max-calls N              hard LLM-call budget
--overlap-threshold X      skip redundant skeptic work
--branch-tokens N          output budget for architect calls
--skeptic-tokens N         output budget for critique calls
--merge-tokens N           output budget for synthesis
--meta-tokens N            output budget for the final meta-judge
--thinking enabled|disabled
--reasoning-effort high|max
--temperature X
--top-p X
```

The JSON `generation.extra_body` object is merged into OpenAI-compatible requests. For DeepSeek V4, for example:

```json
{
  "generation": {
    "branch_max_tokens": 1400,
    "merge_max_tokens": 2200,
    "extra_body": {
      "thinking": {"type": "disabled"}
    }
  }
}
```

Full prompt templates support placeholders such as `{{task}}`, `{{branch_label}}`, `{{focus}}`, `{{proposal}}`, `{{branches}}`, `{{handoffs}}`, `{{quality_contract}}`, `{{skills}}`, and `{{tool_slots}}`.
