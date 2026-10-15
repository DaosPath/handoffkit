# MAI-Style Public Doctor Benchmark

This benchmark mirrors sequential-diagnosis *mechanics* described for SDBench
and MAI-DxO without using private NEJM SDBench data or reproducing those
systems. It is **experimental / research and education only / not clinically
validated**. It is not medical advice, not clinical decision support, and not
equivalent to MAI-DxO, SDBench, or human clinicians.

It uses open-access diagnostic cases from
[MedCaseReasoning](https://huggingface.co/datasets/zou-lab/MedCaseReasoning)
([paper](https://arxiv.org/abs/2505.11733)). The official 1.20 clinical lab
scores the frozen 897-case test split; this legacy harness is a regression
fixture only.

## What It Replicates

- opening note instead of full case reveal,
- gatekeeper that reveals only requested evidence,
- sequential questions and tests,
- versioned **resource units** (not clinical USD),
- structured handoffs between virtual clinicians,
- trace/replay reports.

## What It Does Not Replicate

- Microsoft private SDBench data,
- NEJM-CPC copyrighted cases,
- Microsoft MAI-DxO implementation internals,
- clinical validation,
- published diagnostic accuracy.

## Gold replay

The default offline mode is `mai_style_gold_replay`. It **never counts as
accuracy**. It only checks that contracts, traces, and reports still round-trip.
Vague queries return `evidence_not_available` and never dump `full_case`.

For scored sequential diagnosis use `handoffkit clinical` and
`/demos/clinical-lab`.

## Run

```bash
handoffkit benchmark-doctor-mai --cases 30
handoffkit clinical audit
```
