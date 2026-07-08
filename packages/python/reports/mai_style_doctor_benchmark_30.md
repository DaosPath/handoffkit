# MAI-Style Public Doctor Benchmark: 30 Cases

> Educational benchmark harness only. Cases are from open-access case reports; this output is not medical advice and must not be used for patient care.

## What This Is

A public MAI/SDBench-style harness using MedCaseReasoning cases. It mirrors sequential mechanics: opening note, gatekeeper, questions, tests, costs, final diagnosis, trace, and replay. It does not include private NEJM SDBench data.

## Summary

- Cases: `30`
- Gold replay matches: `30`
- Accuracy: `1.000`
- Total simulated cost: `$25925`
- Average simulated cost: `$864`
- Handoffs: `120`
- Handoff quality: `B` / `0.883`
- Replay: `32` steps

## Cases

| Case | PMCID | Actions | Cost | Final Diagnosis |
| --- | --- | ---: | ---: | --- |
| medcase-0000 | PMC8777167 | 5 | $505 | Phototoxic reaction |
| medcase-0001 | PMC3673371 | 5 | $1620 | AmeloblasticFibroma |
| medcase-0002 | PMC7443985 | 7 | $2355 | Scleroderma_renal_crisis |
| medcase-0003 | PMC10999549 | 5 | $505 | GallbladderVolvulus |
| medcase-0004 | PMC8378370 | 6 | $2270 | bullous fixed drug eruption |
| medcase-0005 | PMC11535749 | 6 | $1155 | SBP-101 induced retinal toxicity |
| medcase-0006 | PMC7362425 | 5 | $505 | Primary aldosteronism |
| medcase-0007 | PMC10232944 | 5 | $505 | Sclerosing meningioma |
| medcase-0008 | PMC11821356 | 7 | $2355 | PFAPAsyndrome |
| medcase-0009 | PMC10622404 | 5 | $505 | Rhabdomyolysis |
| medcase-0010 | PMC8544292 | 4 | $420 | Oculomotor nerve schwannoma |
| medcase-0011 | PMC5676292 | 5 | $505 | Cerebral salt wasting syndrome |
| medcase-0012 | PMC9679462 | 6 | $1155 | cold agglutinin disease |
| medcase-0013 | PMC9675078 | 5 | $505 | Epsteinâ€“Barr virus infection |
| medcase-0014 | PMC3747369 | 5 | $505 | DRESS syndrome |
| medcase-0015 | PMC10216786 | 6 | $1155 | FunctionalNeurologicalDisorder |
| medcase-0016 | PMC4223599 | 5 | $505 | PEComa |
| medcase-0017 | PMC7325212 | 6 | $1155 | Myofibrillar myopathy |
| medcase-0018 | PMC3271452 | 6 | $1705 | Leiomyosarcoma |
| medcase-0019 | PMC6815408 | 5 | $505 | Multiple sclerosis |
| medcase-0020 | PMC9610036 | 5 | $505 | Primary central nervous system lymphoma |
| medcase-0021 | PMC9246066 | 5 | $505 | eosinophilic colitis |
| medcase-0022 | PMC9254170 | 5 | $505 | ThyroidFollicularRenalCellCarcinoma |
| medcase-0023 | PMC9923279 | 5 | $505 | subglottic cyst |
| medcase-0024 | PMC3884960 | 4 | $420 | ClearCellAdenocarcinoma |
| medcase-0025 | PMC8957291 | 6 | $1155 | acute disseminated encephalomyelitis |
| medcase-0026 | PMC4012653 | 5 | $505 | Wernickeâ€“Korsakoff syndrome |
| medcase-0027 | PMC4539463 | 4 | $420 | Birt-Hogg-DubÃ¨ syndrome |
| medcase-0028 | PMC9176094 | 5 | $505 | Pseudohypoaldosteronism type 1 |
| medcase-0029 | PMC11607135 | 5 | $505 | Factor XIIII deficiency |

## Artifacts

- `report_json`: `reports\mai_style_doctor_benchmark_30.json`
- `report_md`: `reports\mai_style_doctor_benchmark_30.md`
- `run_report_json`: `runs\latest\report.json`
- `run_report_md`: `runs\latest\report.md`
- `run_trace`: `runs\latest\trace.json`
