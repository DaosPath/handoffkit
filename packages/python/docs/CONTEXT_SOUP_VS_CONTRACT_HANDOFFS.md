# Context Soup vs Contract Handoffs

Multi-agent demos often look clean until the second or third handoff. Then the
next agent receives a paragraph like:

> The calculator is basically done. Reviewer found one issue. Tester should run it.

That sounds useful, but it loses the things that make work reproducible:

- which files changed,
- which decisions were already made,
- what errors were found and fixed,
- what the next agent must do,
- what evidence can be replayed later.

That is context soup: free-text memory with no contract.

## Contract Handoffs

HandoffKit uses `HandoffState` as the handoff contract:

```python
from handoffkit import HandoffState

state = HandoffState(
    task="Ship a Python CLI calculator with tests.",
    from_agent="Reviewer",
    to_agent="Tester",
    summary="Review passed after one fix.",
    decisions=["Keep public calculate() helper stable."],
    important_files=["calculator.py", "tests/test_calculator.py"],
    errors=["Invalid-operation error was too vague; regression added."],
    next_steps=["Run pytest -q", "Run python calculator.py add 2 3"],
    context_refs=["review-note-17", "pytest-output-local"],
    metadata={"errors_checked": True},
)
```

Now the next agent receives structured state instead of a fragile summary.

## Why It Matters

Structured handoffs make workflows easier to:

- validate with `ValidationReport`,
- score with `HandoffQualityEvaluator`,
- trace with `RunTrace`,
- replay-inspect with `ReplayRunner`,
- evaluate offline with `WorkflowEvaluator`.

That changes the debugging loop. You can inspect what each agent knew, what it
changed, and what it handed to the next agent without rerunning providers or
tools.

## Try It

```bash
pip install handoffkit
handoffkit init coding-review
cd coding-review
python coding_review.py
handoffkit report runs/latest
```

The demo shows both sides: what free text loses and what a contract preserves.

## The Core Idea

Agent handoff quality is not only model quality. It is protocol quality.

Better handoffs make weaker agents safer, stronger agents more reliable, and
workflow failures easier to audit.
