# @handoffkit/clinical

Browser-safe contracts and HTTP client for the HandoffKit Clinical Sequential
Reasoning Lab. This package is **experimental / research and education only /
not clinically validated**. It is not medical advice, not a device, and not a
reproduction of MAI-DxO or SDBench. No official 897/897 score is claimed.

Canonical JSON is `snake_case`. The Python engine `handoffkit.clinical` is the
runtime of record.

This is a predefined-case sandbox. Personal symptoms, identifiers, and free-text
personal cases are rejected. Detection is heuristic, not perfect.

## Status

- Deterministic sandbox: experimental
- Clinical validity: unavailable
- Official 897 run: unavailable
- Live providers: unavailable (adapter scaffold)
- Live retrieval: unavailable
- PostgreSQL: planned

## Install

```bash
pnpm add @handoffkit/clinical
```

## Surface

- Wire models: `ClinicalRun`, `ClinicalAction`, `ClinicalObservation`, `ClinicalScore`
- Scoring: `correct` is fail-closed without independent judges; `exact_match` /
  `alias_match` are regression-only; `clinical_validity` is always `null`
- Client: `ClinicalClient` against `/api/clinical/v1beta`
- Node engine (not for the browser bundle): `@handoffkit/clinical/engine`

`gold_replay` is a recorded fixture only and never counts as accuracy.
Official scored runs require exactly 897 MedCaseReasoning test cases and three
independent judges. Those judges are not shipped here.
