# Context Soup vs Contract Handoffs: Launch Kit

Use these variants to launch HandoffKit without rewriting the same idea for
every community. Keep the tone concrete: show the demo, the report, and the
problem it solves.

Canonical asset:

- Post: [`docs/python/CONTEXT_SOUP_VS_CONTRACT_HANDOFFS.md`](../CONTEXT_SOUP_VS_CONTRACT_HANDOFFS.md)
- Gallery: [`docs/python/SHOWCASE_GALLERY.md`](../SHOWCASE_GALLERY.md)
- Demo command:

```bash
pip install handoffkit
handoffkit demos
handoffkit showcase coding-review
handoffkit report runs/latest
```

- Template command:

```bash
handoffkit init coding-review
cd coding-review
python coding_review.py
handoffkit report runs/latest
```

## Screenshot / GIF Caption

Short caption:

> HandoffKit turns vague multi-agent summaries into structured contracts:
> decisions, files, errors, next steps, validation, quality, and replay reports.

Terminal caption:

> One command runs the showcase, one command renders the report:
> `handoffkit showcase coding-review` then `handoffkit report runs/latest`.

## Hacker News

Title options:

- Show HN: HandoffKit, structured handoffs for multi-agent Python workflows
- Context soup vs contract handoffs in multi-agent workflows
- I built a tiny Python framework for auditable agent handoffs

Post:

> I have been working on HandoffKit, a small Python package for multi-agent
> workflows where agents pass structured `HandoffState` contracts instead of
> vague free-text summaries.
>
> The core problem: after two or three agent handoffs, a summary like
> "calculator is basically done, reviewer found one issue" loses the files,
> decisions, errors, next steps, and test evidence the next agent needs.
>
> HandoffKit keeps those pieces explicit, then validates, scores, traces, and
> replay-inspects the workflow offline.
>
> Quick demo:
>
> ```bash
> pip install handoffkit
> handoffkit init coding-review
> cd coding-review
> python coding_review.py
> handoffkit report runs/latest
> ```
>
> The package has no heavy runtime dependencies and the demos run without API
> keys. Feedback welcome, especially from people building agent workflows.

## Reddit r/Python

Title:

> I built HandoffKit: structured handoffs for multi-agent Python workflows

Post:

> I built HandoffKit to solve a problem I kept hitting in agent chains:
> free-text summaries get vague fast.
>
> Instead of:
>
> ```text
> Reviewer says calculator is basically done, tester should run it.
> ```
>
> HandoffKit passes a structured `HandoffState`:
>
> - task,
> - decisions,
> - important files,
> - errors,
> - next steps,
> - metadata,
> - trace/replay evidence.
>
> Try the coding-agent demo:
>
> ```bash
> pip install handoffkit
> handoffkit init coding-review
> cd coding-review
> python coding_review.py
> handoffkit report runs/latest
> ```
>
> It runs offline and shows the before/after: vague summary vs structured
> handoff report. I would love feedback on the API and the examples.

## Reddit r/LocalLLaMA

Title:

> HandoffKit: make local multi-agent workflows less like context soup

Post:

> For local agent workflows, model quality is only half the problem. The other
> half is handoff quality: what exactly did the previous agent preserve for the
> next one?
>
> HandoffKit is a small Python package that keeps handoffs explicit:
> decisions, files, errors, next steps, and traceable evidence. Normal tests and
> demos are offline; provider integrations are optional.
>
> Try:
>
> ```bash
> pip install handoffkit
> handoffkit init coding-review
> cd coding-review
> python coding_review.py
> handoffkit report runs/latest
> ```
>
> The thing I want feedback on: is `HandoffState` the right level of structure
> for local coding/research/support agents?

## X / Twitter

Short post:

> Multi-agent workflows often fail because handoffs become context soup.
>
> I built HandoffKit: agents pass structured `HandoffState` with decisions,
> files, errors, next steps, validation, quality, and replay evidence.
>
> Try:
> `pip install handoffkit`
> `handoffkit init coding-review`
>
> Feedback welcome.

Thread:

1. Multi-agent workflows look clean until the third handoff.
2. Then the next agent receives: "calculator basically done, reviewer found one issue."
3. That loses files, decisions, errors, next steps, and test evidence.
4. HandoffKit turns that into a structured `HandoffState`.
5. The handoff can be validated, scored, traced, replay-inspected, and evaluated offline.
6. Quick demo:
   `pip install handoffkit && handoffkit init coding-review`
7. Goal: less context soup, more auditable agent workflows.

## LinkedIn

Post:

> One thing I think multi-agent frameworks still underemphasize: handoff
> quality.
>
> A workflow can have strong models and still fail because the receiving agent
> gets a vague summary instead of a clear contract.
>
> HandoffKit is my attempt at a small, practical fix for Python workflows:
> agents pass `HandoffState` with decisions, important files, errors, next
> steps, metadata, and trace/replay evidence.
>
> I added three concrete demos:
>
> - coding agents: Architect -> Coder -> Reviewer -> Tester,
> - customer support escalation,
> - research workflow with fact-checking and sources.
>
> The fastest way to see it:
>
> ```bash
> pip install handoffkit
> handoffkit init coding-review
> cd coding-review
> python coding_review.py
> handoffkit report runs/latest
> ```
>
> The idea is simple: stop passing context soup between agents; pass contracts.

## LangChain / LangGraph Communities

Post:

> I am exploring a small companion layer for LangGraph-style workflows:
> HandoffKit handles the state contract while LangGraph handles orchestration.
>
> Pattern:
>
> - graph nodes do the work,
> - nodes pass `HandoffState` to the next node,
> - HandoffKit validates, scores, traces, and writes replayable reports.
>
> This is not meant to replace graph orchestration. It is meant to make the
> state between nodes inspectable and testable.
>
> Runnable demo:
>
> ```bash
> pip install handoffkit
> handoffkit init coding-review
> cd coding-review
> python coding_review.py
> handoffkit report runs/latest
> ```
>
> Integration guide:
> `docs/python/integrations/LANGGRAPH.md`

## Anti-spam Checklist

- Include a working command, not only a claim.
- Mention no API key is needed for the demo.
- Ask for specific feedback.
- Do not cross-post all communities in the same hour.
- Reply with report snippets, not marketing copy.
