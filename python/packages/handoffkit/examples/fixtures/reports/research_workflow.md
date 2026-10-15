# Research Workflow: Researcher -> Extractor -> Fact-checker -> Writer

## 5 Minute Command

```bash
pip install handoffkit
handoffkit init research-workflow
cd research-workflow
python research_workflow.py
handoffkit report runs/latest
```

## Pain

Research agents often blur sources, confidence, corrections, and final writing constraints.

## Free-text Summary Loses

> Sources look good. Fact checker removed something. Writer can make the brief.

- which source backs which claim
- what was removed
- confidence level
- source policy
- writer constraints

## HandoffKit Preserves

- source map
- claim decisions
- fact-check errors
- approved claims
- replayable trace

## Structured Handoffs

- `Researcher` -> `Extractor`: 3 decisions, 2 files, 1 error, 3 next steps
- `Extractor` -> `Fact-checker`: 3 decisions, 2 files, 1 error, 3 next steps
- `Fact-checker` -> `Writer`: 3 decisions, 3 files, 1 error, 3 next steps

## Validation

Success: `True`

## Quality

Score: `0.912` Grade: `A`

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

Fact-check passed after removing one unsupported sentence about ecosystem preference.


## Artifacts

- `report_json`: `reports\research_workflow.json`
- `report_md`: `reports\research_workflow.md`
- `run_report_json`: `runs\latest\report.json`
- `run_report_md`: `runs\latest\report.md`
- `run_trace`: `runs\latest\trace.json`
