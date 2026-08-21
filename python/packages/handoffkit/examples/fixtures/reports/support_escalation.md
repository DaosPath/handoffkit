# Customer Support: Triage -> Billing -> Refund -> Supervisor

## 5 Minute Command

```bash
pip install handoffkit
handoffkit init support-escalation
cd support-escalation
python support_escalation.py
handoffkit report runs/latest
```

## Pain

Support handoffs lose policy checks, charge IDs, and what was promised to the customer.

## Free-text Summary Loses

> Looks like duplicate billing. Refund team should handle it and maybe tell customer.

- exact charge IDs
- policy threshold
- lookup mistake already corrected
- whether customer was promised anything
- supervisor approval reason

## HandoffKit Preserves

- charge evidence
- billing decisions
- customer-safe next steps
- internal errors
- supervisor audit trail

## Structured Handoffs

- `Triage` -> `Billing`: 3 decisions, 2 files, 1 error, 3 next steps
- `Billing` -> `Refund`: 3 decisions, 2 files, 1 error, 3 next steps
- `Refund` -> `Supervisor`: 3 decisions, 3 files, 1 error, 3 next steps

## Validation

Success: `True`

## Quality

Score: `0.925` Grade: `A`

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

Refund prepared for duplicate charge ch_002 with account note and customer response.


## Artifacts

- `report_json`: `reports\support_escalation.json`
- `report_md`: `reports\support_escalation.md`
- `run_report_json`: `runs\latest\report.json`
- `run_report_md`: `runs\latest\report.md`
- `run_trace`: `runs\latest\trace.json`
