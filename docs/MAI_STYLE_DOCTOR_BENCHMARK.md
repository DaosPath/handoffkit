# MAI-Style Public Doctor Benchmark

This benchmark mirrors the public mechanics described for SDBench and MAI-DxO
without using private NEJM SDBench data.

It uses 30 real open-access diagnostic cases from MedCaseReasoning, derived from
PMC Open Access case reports. It is educational only and is not medical advice.

## What It Replicates

- opening note instead of full case reveal,
- gatekeeper that reveals only requested evidence,
- sequential questions and tests,
- simulated diagnostic costs,
- structured handoffs between virtual clinicians,
- final diagnosis scoring,
- trace/replay reports.

## What It Does Not Replicate

- Microsoft private SDBench data,
- NEJM-CPC copyrighted cases,
- Microsoft MAI-DxO implementation internals,
- clinical validation.

## Run

```bash
handoffkit benchmark-doctor-mai --cases 30
handoffkit report runs/latest
```

## Workflow

```text
Gatekeeper -> Dr. Hypothesis -> Dr. Test Steward -> Dr. Challenger -> Final Judge
```

The default offline mode is `mai_style_gold_replay`: it uses known labels to
exercise contracts, cost accounting, traceability, and reports. Provider-backed
diagnostic agents can be attached later for live model evaluation.
