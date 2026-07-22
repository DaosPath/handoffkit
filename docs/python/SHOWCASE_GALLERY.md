# HandoffKit Showcase Gallery

Offline showcases demonstrate how HandoffKit turns vague context summaries
into structured handoff contracts, reports, validation, quality scores, and
replay evidence.

## Quick Start

```bash
pip install handoffkit
handoffkit demos
handoffkit showcase coding-review
handoffkit report runs/latest
```

## Showcases

| Showcase | Command | Report | What it proves |
|---|---|---|---|
| Coding agents | `handoffkit showcase coding-review` | [`examples/fixtures/reports/coding_review.md`](../../packages/python/examples/fixtures/reports/coding_review.md) | Files, decisions, errors, review fixes, and test commands survive agent handoff. |
| Support escalation | `handoffkit showcase support-escalation` | [`examples/fixtures/reports/support_escalation.md`](../../packages/python/examples/fixtures/reports/support_escalation.md) | Charge IDs, policy checks, correction notes, and approvals stay auditable. |
| Research workflow | `handoffkit showcase research-workflow` | [`examples/fixtures/reports/research_workflow.md`](../../packages/python/examples/fixtures/reports/research_workflow.md) | Sources, claims, confidence, corrections, and writer constraints stay traceable. |
| Doctor orchestrator | `handoffkit showcase doctor-orchestrator` | [`examples/fixtures/reports/doctor_orchestrator.md`](../../packages/python/examples/fixtures/reports/doctor_orchestrator.md) | Synthetic doctor-panel handoffs preserve uncertainty, red flags, cost-aware test reasoning, and safety boundaries. |
| Doctor benchmark 30 | `handoffkit benchmark-doctor --cases 30` | [`examples/fixtures/reports/doctor_benchmark_30.md`](../../packages/python/examples/fixtures/reports/doctor_benchmark_30.md) | Replays 30 real MedCaseReasoning / PMC Open Access cases in gold mode to validate handoff contracts, provenance, and reports. |
| MAI-style doctor benchmark 30 | `handoffkit benchmark-doctor-mai --cases 30` | [`examples/fixtures/reports/mai_style_doctor_benchmark_30.md`](../../packages/python/examples/fixtures/reports/mai_style_doctor_benchmark_30.md) | Mirrors SDBench mechanics with public cases: gatekeeper, targeted questions, tests, simulated costs, trace, and replay. |

## Template Flow

```bash
handoffkit init coding-review
cd coding-review
python coding_review.py
handoffkit report runs/latest
```

Use `handoffkit init support-escalation`, `handoffkit init research-workflow`,
or `handoffkit init doctor-orchestrator` for the other workflows. All demos run
offline and require no API key. `benchmark-doctor` and `benchmark-doctor-mai`
also run offline and use bundled real-case metadata from MedCaseReasoning; they
are educational and not medical advice. `benchmark-doctor-mai` is MAI/SDBench
style, but does not include private NEJM SDBench data.



