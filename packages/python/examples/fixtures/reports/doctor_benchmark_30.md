# Doctor Benchmark: 30 Real Open-Access Cases

> Educational benchmark harness only. Cases are from open-access case reports; this output is not medical advice and must not be used for patient care.

## Source

- Dataset: [zou-lab/MedCaseReasoning](https://huggingface.co/datasets/zou-lab/MedCaseReasoning)
- Paper: [https://arxiv.org/abs/2505.11733](https://arxiv.org/abs/2505.11733)
- Split: test
- Mode: `gold_replay` (replays known clinician-authored answers; does not claim model diagnostic accuracy)

## Summary

- Cases: `30`
- Gold replay matches: `30`
- Accuracy: `1.000`
- Validation: `True`
- Handoff quality: `A` / `0.929`
- Replay: `62` steps, `60` handoffs

## Cases

| Case | PMCID | Gold Diagnosis | Journal |
| --- | --- | --- | --- |
| medcase-0000 | PMC8777167 | Phototoxic reaction | Clinical Case Reports |
| medcase-0001 | PMC3673371 | AmeloblasticFibroma | Case Reports in Dentistry |
| medcase-0002 | PMC7443985 | Scleroderma_renal_crisis | SAGE Open Medical Case Reports |
| medcase-0003 | PMC10999549 | GallbladderVolvulus | Clinical Case Reports |
| medcase-0004 | PMC8378370 | bullous fixed drug eruption | BMJ Case Reports |
| medcase-0005 | PMC11535749 | SBP-101 induced retinal toxicity | American Journal of Ophthalmology Case Reports |
| medcase-0006 | PMC7362425 | Primary aldosteronism | Journal of Medical Case Reports |
| medcase-0007 | PMC10232944 | Sclerosing meningioma | Radiology Case Reports |
| medcase-0008 | PMC11821356 | PFAPAsyndrome | Radiology Case Reports |
| medcase-0009 | PMC10622404 | Rhabdomyolysis | Clinical Case Reports |
| medcase-0010 | PMC8544292 | Oculomotor nerve schwannoma | Neurology International |
| medcase-0011 | PMC5676292 | Cerebral salt wasting syndrome | Clinical Case Reports |
| medcase-0012 | PMC9679462 | cold agglutinin disease | American Journal of Ophthalmology Case Reports |
| medcase-0013 | PMC9675078 | Epsteinâ€“Barr virus infection | Journal of Medical Case Reports |
| medcase-0014 | PMC3747369 | DRESS syndrome | Case Reports in Medicine |
| medcase-0015 | PMC10216786 | FunctionalNeurologicalDisorder | Brain Sciences |
| medcase-0016 | PMC4223599 | PEComa | Diagnostic Pathology |
| medcase-0017 | PMC7325212 | Myofibrillar myopathy | Case Reports in Neurology |
| medcase-0018 | PMC3271452 | Leiomyosarcoma | Urology Annals |
| medcase-0019 | PMC6815408 | Multiple sclerosis | BMC Neurology |
| medcase-0020 | PMC9610036 | Primary central nervous system lymphoma | Surgical Neurology International |
| medcase-0021 | PMC9246066 | eosinophilic colitis | ACG Case Reports Journal |
| medcase-0022 | PMC9254170 | ThyroidFollicularRenalCellCarcinoma | World Journal of Clinical Cases |
| medcase-0023 | PMC9923279 | subglottic cyst | BMJ Case Reports |
| medcase-0024 | PMC3884960 | ClearCellAdenocarcinoma | Case Reports in Pathology |
| medcase-0025 | PMC8957291 | acute disseminated encephalomyelitis | Radiology Case Reports |
| medcase-0026 | PMC4012653 | Wernickeâ€“Korsakoff syndrome | JRSM Open |
| medcase-0027 | PMC4539463 | Birt-Hogg-DubÃ¨ syndrome | Case Reports in Surgery |
| medcase-0028 | PMC9176094 | Pseudohypoaldosteronism type 1 | Journal of Clinical Research in Pediatric Endocrinology |
| medcase-0029 | PMC11607135 | Factor XIIII deficiency | Clinical Case Reports |

## Artifacts

- `report_json`: `reports\doctor_benchmark_30.json`
- `report_md`: `reports\doctor_benchmark_30.md`
- `run_report_json`: `runs\latest\report.json`
- `run_report_md`: `runs\latest\report.md`
- `run_trace`: `runs\latest\trace.json`
