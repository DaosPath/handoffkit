# Structured Recipe Demo

## Structured Output

```json
{
  "success": true,
  "data": {
    "title": "Recipe plan",
    "summary": "Plan the work, execute it, then review the result.",
    "success": true
  },
  "raw_output": "{\"title\": \"Recipe plan\", \"summary\": \"Plan the work, execute it, then review the result.\", \"success\": true}",
  "errors": [],
  "schema_name": "RecipeStepSummary",
  "repaired": false,
  "metadata": {
    "agent": "StructuredPlanner",
    "provider": "StructuredStepProvider",
    "model": "echo",
    "context_used": false,
    "memories_used": 0
  }
}
```

## Recipe Result

# Recipe Run: structured-plan-review

## Success

True

## Final Output

EchoProvider[echo] response
Summary: Agent: RecipeReviewer Role: Review structured workflow output. Task: Previous output: { "success": true, "data": { "title": "Recipe plan", "summary": "Plan the work, execute it, then review the result.", "success": true }, "raw_output": "{\"title\": \"Recipe plan\", \"summary\": \"Plan the work, execute it, then review the result.\", \"success\": true}", "errors": [], "schema_name": "RecipeStepSummary", "repaired"...
Decisions: keep state explicit, preserve constraints, continue with next step.
Next steps: inspect the handoff state, act on the task, report errors.

## Step Results

- `structured-plan` success=True agent=StructuredPlanner
- `review` success=True agent=RecipeReviewer

## Handoffs

- `StructuredPlanner` -> `RecipeReviewer`: Review the structured summary from the previous step.

## Tool Results

- none

