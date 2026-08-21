# Doctor Orchestrator: Intake -> Hypothesis -> Challenger -> Test Steward -> Checklist -> Final Reviewer

## 5 Minute Command

```bash
pip install handoffkit
handoffkit init doctor-orchestrator
cd doctor-orchestrator
python doctor_orchestrator.py
handoffkit report runs/latest
```

## Pain

Diagnostic panels lose uncertainty, missing questions, red flags, and test-cost reasoning when each specialist writes only a prose summary. This synthetic demo is not medical advice.

## Free-text Summary Loses

> Looks viral. Check red flags, maybe test if needed. Reviewer should finalize.

- which history fields are missing
- differential uncertainty
- red flags not yet answered
- why tests were deferred
- educational safety boundary

## HandoffKit Preserves

- candidate hypotheses and missing questions
- challenger risk register
- cost-aware test reasoning
- checklist decisions and safety boundary
- replayable evidence for each virtual doctor

## Structured Handoffs

- `Intake` -> `Dr. Hypothesis`: 3 decisions, 2 files, 1 error, 3 next steps
- `Dr. Hypothesis` -> `Dr. Challenger`: 3 decisions, 2 files, 1 error, 3 next steps
- `Dr. Challenger` -> `Test Steward`: 3 decisions, 2 files, 1 error, 3 next steps
- `Test Steward` -> `Dr. Checklist`: 3 decisions, 2 files, 1 error, 3 next steps
- `Dr. Checklist` -> `Final Reviewer`: 3 decisions, 5 files, 1 error, 3 next steps

## Validation

Success: `True`

## Quality

Score: `0.887` Grade: `B`

## Replay

# Replay Summary

## Success

True

## Steps

6

## Handoffs

5

## Tool Results

0

## Final Output

Checklist passed for demo purposes: the flow preserved uncertainty, missing data, red-flag questions, cost-aware test reasoning, and an explicit educational-only boundary.


## Artifacts

- `report_json`: `reports\doctor_orchestrator.json`
- `report_md`: `reports\doctor_orchestrator.md`
- `run_report_json`: `runs\latest\report.json`
- `run_report_md`: `runs\latest\report.md`
- `run_trace`: `runs\latest\trace.json`
