# @handoffkit/recipes

Small offline workflow recipes for JavaScript HandoffKit apps.

```js
import { Agent } from "@handoffkit/core";
import { RecipeRunner, WorkflowTemplate } from "@handoffkit/recipes";

const recipe = WorkflowTemplate.planExecuteReview({
  name: "release-checklist",
  task: "Prepare a local release checklist.",
  planner: new Agent({ name: "Planner" }),
  executor: new Agent({ name: "Executor" }),
  reviewer: new Agent({ name: "Reviewer" }),
});

console.log(new RecipeRunner(recipe).run().toMarkdown());
```

## Web-grounded answer

`runWebGroundedAnswer` enforces the complete route:

`live search → candidate Markdown → provider selects exact URLs → HandoffKit fetches and converts pages to Markdown → provider answers from all fetched pages`.

With `strictGrounding` (default), malformed selection JSON, URLs outside the
candidate set, empty page evidence, or an answer that does not acknowledge all
evidence pages returns `success: false`; it never passes an ungrounded answer
as valid. The returned answer does not require citations. Operational URLs and
planner output remain in `selection` and `research.metadata` for auditing.
Binary/download candidates (PDF, archives, office files, and `/pdf/` or
`/download/` paths) are excluded before provider selection. If any selected
HTML page cannot be fetched, the route fails closed with
`web_answer_incomplete_evidence` and does not ask the model to fill the gap.
Pass `providers: ["google"]` to use the native HandoffKit Google HTML
adapter, or pass bounded `searchQueries` to merge focused live searches before
URL selection. This route does not open Chrome or use a user-browser session.
Multi-query searches run sequentially with a bounded delay by default, reducing
rate-limit bursts against public HTML endpoints. A provider challenge is
reported as a structured error, never as an empty successful search.

For auditable research, pass `evidenceSections`. HandoffKit extracts one claim
per requirement, requires a short quote that it can locate in fetched
Markdown, and rejects a real but semantically unrelated quote. Optional
`synthesisSections` derives comparisons only from explicit claim IDs: positive
inferences require at least two supported claims, while missing evidence can
justify only a limitation. `dossierComposeMode: "deterministic"` renders the
verified ledger directly and skips free-form final composition. `seedResults`
prioritizes known candidate URLs but still fetches them live; it does not embed
page contents or bypass the search audit trail. These controls make claims
inspectable, not automatically production-reviewed.

For a fixed audit rubric, a synthesis section may supply
`deterministicFindings` with a statement and exact `evidenceClaims`. The route
accepts it only when every referenced claim exists and its status is compatible
with the statement polarity. This is an explicit caller-owned inference rule,
not model-generated evidence.

Sections may render as `bullets`, `paragraph`, or `table`. Table sections
declare `columns`, and each deterministic finding supplies an equal-length
`cells` array. Unsupported rows are never rendered as verified table data.

Direct sections may likewise provide `deterministicEvidence` anchors. An anchor
contains a requirement, statement, and short expected quote; it becomes
supported only when the live-fetched page still contains the quote and both the
statement and quote overlap the requirement. Missing or stale anchors become
`not_found` and never fall back to an unverified claim.
