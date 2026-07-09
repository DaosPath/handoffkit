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
