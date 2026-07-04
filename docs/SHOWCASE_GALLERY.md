# HandoffKit Showcase Gallery

Three offline showcases demonstrate how HandoffKit turns vague context summaries
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
| Coding agents | `handoffkit showcase coding-review` | [`reports/coding_review.md`](../reports/coding_review.md) | Files, decisions, errors, review fixes, and test commands survive agent handoff. |
| Support escalation | `handoffkit showcase support-escalation` | [`reports/support_escalation.md`](../reports/support_escalation.md) | Charge IDs, policy checks, correction notes, and approvals stay auditable. |
| Research workflow | `handoffkit showcase research-workflow` | [`reports/research_workflow.md`](../reports/research_workflow.md) | Sources, claims, confidence, corrections, and writer constraints stay traceable. |

## Template Flow

```bash
handoffkit init coding-review
cd coding-review
python coding_review.py
handoffkit report runs/latest
```

Use `handoffkit init support-escalation` or `handoffkit init research-workflow`
for the other two workflows. All three demos run offline and require no API key.

