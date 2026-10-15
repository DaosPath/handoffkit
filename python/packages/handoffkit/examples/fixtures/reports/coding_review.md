# Coding Agents: Architect -> Coder -> Reviewer -> Tester

## 5 Minute Command

```bash
pip install handoffkit
handoffkit init coding-review
cd coding-review
python coding_review.py
handoffkit report runs/latest
```

## Pain

Free-text agent summaries drop files, edge cases, review fixes, and test evidence.

## Free-text Summary Loses

> Calculator is basically done. Reviewer found one small issue. Tester should run it.

- which files changed
- why argparse was chosen
- the divide-by-zero risk
- the exact review fix
- the commands tester must run

## HandoffKit Preserves

- important_files across every handoff
- decisions and rationale
- errors and fixes
- next_steps as executable checks
- trace and replay evidence

## Structured Handoffs

- `Architect` -> `Coder`: 3 decisions, 2 files, 0 errors, 3 next steps
- `Coder` -> `Reviewer`: 3 decisions, 2 files, 1 error, 3 next steps
- `Reviewer` -> `Tester`: 3 decisions, 3 files, 1 error, 3 next steps

## Validation

Success: `True`

## Quality

Score: `1.000` Grade: `A`

## Replay

# Replay Summary

## Success

True

## Steps

4

## Handoffs

3

## Tool Results

0

## Final Output

Review passed after one fix: invalid operation message now names supported commands.


## Artifacts

- `report_json`: `reports\coding_review.json`
- `report_md`: `reports\coding_review.md`
- `run_report_json`: `runs\latest\report.json`
- `run_report_md`: `runs\latest\report.md`
- `run_trace`: `runs\latest\trace.json`
