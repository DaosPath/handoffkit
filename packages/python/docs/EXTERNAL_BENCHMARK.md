# Independent Protocol Benchmark (Published Methodology)

**Status:** Published methodology + offline APIs  
**Leaderboard:** **None** (explicitly not a public ranking)  
**IDs:** `handoffkit-protocol-v1` · version `1.0.0`  
**Default seed:** `handoffkit-independent-2026`

This document is the **public methodology** for HandoffKit’s independent
benchmark. It ships with the package so third parties can reproduce scores
without relying on a hosted leaderboard or model beauty contest.

## What is measured

| Dimension | Meaning |
|-----------|---------|
| **Handoff validation** | Every intermediate `HandoffState` passes `HandoffStateValidator` |
| **Handoff quality** | Deterministic `HandoffQualityEvaluator` score (structure/content) |
| **Context loss** | Missing summary / decisions / next_steps / important_files rate |
| **Latency** | Wall time per task (offline Echo providers → near-zero, still recorded) |
| **Task pass rate** | Tasks that produce expected handoff count + validate + quality ≥ 0.5 |

**Not measured:** raw LLM accuracy, clinical correctness of doctor demos, or
relative ranking of third-party products on a public board.

## Suite: protocol tasks v1

Five fixed multi-role tasks (`PROTOCOL_TASKS_V1`):

| ID | Title | Roles |
|----|-------|-------|
| `proto-001` | Release checklist | Planner → Implementer → Reviewer |
| `proto-002` | Incident triage | Oncall → Engineer → Lead |
| `proto-003` | API contract change | Architect → Coder → Reviewer |
| `proto-004` | Docs handoff | Writer → Editor → Approver |
| `proto-005` | Tool safety review | Requester → Security → Operator |

Each task expects **`len(roles) - 1` handoffs**. Descriptions are hashed in
`methodology_manifest()` so methodology drift is detectable.

## APIs (Python)

```python
from handoffkit.benchmarks import (
    methodology_manifest,
    build_independent_benchmark,
    run_independent_benchmark,
)

# Machine-readable methodology (no execution)
print(methodology_manifest())

# In-memory offline run (Echo agents)
report = build_independent_benchmark(seed="handoffkit-independent-2026")
assert report.success
print(report.to_markdown())

# Write artifacts under runs/ + reports/
report = run_independent_benchmark(
    seed="handoffkit-independent-2026",
    output_dir="runs/latest",
    reports_dir="reports",
)
```

### CLI

```bash
# Full offline suite + artifacts
handoffkit benchmark-independent

# Methodology JSON only
handoffkit benchmark-independent --manifest

# Optional seed
handoffkit benchmark-independent --seed handoffkit-independent-2026
```

Artifacts:

- `runs/latest/independent_methodology.json`
- `runs/latest/independent_benchmark.json`
- `runs/latest/independent_benchmark.md`
- `reports/independent_protocol_benchmark.{json,md}`

### Related metrics API

```python
from handoffkit.benchmarks.metrics import build_workflow_metrics
```

See also doctor/MAI educational harnesses (`benchmark-doctor`, `benchmark-doctor-mai`)
which use open-access case data — **not** part of this protocol suite’s pass/fail.

## Studio (optional corpus, still no leaderboard)

Operators can export **their own** MAI panel runs:

```http
GET /api/demos/mai-panel/runs?export=benchmark
```

That export is **opt-in local corpus**, scoped by workspace when present. It is
**not** aggregated into a public leaderboard. Consent, multi-tenant auth, and
publication policy remain future work.

## Comparison protocol (frameworks)

For **framework comparison** (not scored on a board), implement the same
task shape elsewhere:

> Plan → implement → review a tiny checklist, passing structured state between three roles.

| Framework | Structured handoff | Built-in validation | Offline demos | Notes |
|-----------|--------------------|---------------------|---------------|-------|
| **HandoffKit** | Yes (`HandoffState`) | Yes | Yes | This suite |
| **LangGraph** | Graph state (custom) | App-defined | Yes | `docs/integrations/LANGGRAPH.md` |
| **OpenAI Agents SDK** | SDK-specific | App-defined | Partial | `docs/integrations/OPENAI_AGENTS.md` |
| **AutoGen** | Chat/messages | App-defined | Partial | Map to HandoffState at edges |
| **CrewAI** | Task/context | App-defined | Partial | Prefer HandoffState between crews |

Record structure/validation/sandbox/offline/latency notes; do **not** claim
cross-product superiority without peer review.

## Reproducibility checklist

1. Pin `handoffkit==x.y.z` that includes this methodology version.
2. Run `handoffkit benchmark-independent --manifest` and confirm `methodology_id`
   / task SHA-256 digests.
3. Run full suite offline (no API keys required for Echo path).
4. Compare `independent_benchmark.json` fields: `pass_rate`, `quality.score`,
   `metrics.context_loss.loss_rate`.
5. Do not publish “rankings” of models or frameworks from this suite alone.

## Versioning

| Change type | Action |
|-------------|--------|
| New tasks or scoring rule change | Bump `METHODOLOGY_VERSION` (or new `methodology_id`) |
| Bugfix with same tasks | Keep version; note in CHANGELOG |
| Seed-only metadata | Keep methodology version |

## Governance & ethics

- Educational / engineering protocol only.
- Medical doctor demos stay separate and labeled non-clinical.
- Threat model: `docs/THREAT_MODEL.md`.
- Contributions: root `CONTRIBUTING.md`.
