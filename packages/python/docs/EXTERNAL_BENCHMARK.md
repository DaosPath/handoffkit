# External Benchmark & Framework Comparison (P2)

This document defines a **reproducible, offline-first** comparison harness so
HandoffKit can be evaluated against other agent frameworks without marketing
claims.

## Goals

1. Independent-looking **protocol metrics**: handoff completeness, recovery,
   latency, optional cost.
2. Side-by-side notes for **LangGraph**, **AutoGen**, **CrewAI**, and
   **OpenAI Agents SDK** (adapters already under `docs/integrations/`).
3. Public **Studio export** path for real runs when volume exists
   (`/api/demos/mai-panel/runs?export=benchmark`).

## Metrics (implemented)

Python: `handoffkit.benchmarks.metrics`

| Metric | Function | Meaning |
|--------|----------|---------|
| Latency | `latency_stats` | mean / p50 / p95 / max ms |
| Cost | `cost_stats` | tokens + USD when usage present |
| Context loss | `context_loss_stats` | missing handoff fields rate |
| Recovery | `recovery_stats` | retries that succeed vs hard fails |

```python
from handoffkit.benchmarks.metrics import build_workflow_metrics
from handoffkit import HandoffState

report = build_workflow_metrics(
    durations_ms=[120, 140, 200],
    runs=[{"usage": {"total_tokens": 900, "cost_usd": 0.01}}],
    handoffs=[
        HandoffState("t", "A", "B", summary="ok", decisions=["d1"], next_steps=["n1"])
    ],
    attempts=3,
    recoveries=1,
    hard_failures=0,
)
print(report.to_markdown())
```

## Comparison protocol (manual / CI-optional)

For each framework, implement the **same task**:

> “Plan → implement → review a tiny checklist, passing structured state between
> three roles.”

Record:

1. Whether intermediate state is **structured** (JSON contract) or free text.
2. Whether handoffs are **validated**.
3. Tool approval / sandbox model.
4. Offline testability.
5. Latency for N offline echo-style steps (if available).

| Framework | Structured handoff | Built-in validation | Offline demos | Notes |
|-----------|--------------------|---------------------|---------------|-------|
| **HandoffKit** | Yes (`HandoffState`) | Yes | Yes | Contract-first |
| **LangGraph** | Graph state (custom) | App-defined | Yes | See `docs/integrations/LANGGRAPH.md` |
| **OpenAI Agents SDK** | SDK-specific | App-defined | Partial | See `docs/integrations/OPENAI_AGENTS.md` |
| **AutoGen** | Chat/messages | App-defined | Partial | Map messages → HandoffState at boundaries |
| **CrewAI** | Task/context | App-defined | Partial | Prefer exporting HandoffState between crews |

Adapters: copy/paste patterns live under `docs/integrations/` and
`examples/*_integration.py`.

## Independent benchmark policy

- Prefer **external datasets** with clear licenses (e.g. MedCaseReasoning OA
  cases used offline in doctor demos — educational only).
- Publish methodology + seeds before scores.
- Never claim clinical or production superiority without peer review.
- Studio corpus export is **opt-in aggregate of operator runs**, not a public
  leaderboard until multi-tenant auth + consent exist.

## Governance

Second maintainer + issue hygiene: see root `CONTRIBUTING.md`.
