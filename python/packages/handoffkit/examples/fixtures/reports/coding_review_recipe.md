# Recipe Run: coding-review

## Success

True

## Final Output

EchoProvider[echo] response
Summary: Agent: ReviewReporter Role: Summarize findings and recommended next steps. Task: Previous output: EchoProvider[echo] response Summary: Agent: CodeReviewer Role: Review code for correctness, clarity, and tests. Task: Previous output: EchoProvider[echo] response Summary: Agent: CodeReader Role: Read code context and identify relevant behavior. Task: Initial task: Review the local calculator code. Step task: Read the...
Decisions: keep state explicit, preserve constraints, continue with next step.
Next steps: inspect the handoff state, act on the task, report errors.

## Step Results

- `read-context` success=True agent=CodeReader
- `review` success=True agent=CodeReviewer
- `report` success=True agent=ReviewReporter

## Handoffs

- `CodeReader` -> `CodeReviewer`: Review behavior, risks, and missing tests.
- `CodeReviewer` -> `ReviewReporter`: Write concise review findings.

## Tool Results

- none
