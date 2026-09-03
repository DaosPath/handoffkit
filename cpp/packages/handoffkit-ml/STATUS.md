# handoffkit-ml — package status

## Current state

| Field | Value |
|-------|--------|
| **State** | **ACTIVE FOR HK-CSP INTEGRATION** |
| **Since** | 2026-07 (HandoffKit 1.19 development) |
| **In scope** | Local TrainingJob/EvaluationJob execution, policy-gated artifacts, progress, cancellation/deadlines, truthful device metadata, the optional Go mTLS gateway, and the provider-gated direct C++ TLS worker (`--tls-policy`) |
| **Out of scope** | 4B/external trainer integration *inside this package*, SOTA scale claims, exactly-once effects, global zeroization, and generic remote-worker registration |

The previous freeze was lifted for the explicitly requested HK-CSP worker
integration. Native model scope and product boundaries remain unchanged. The
package version is independently `0.6.0`; direct TLS remains experimental and
requires the maintained C++ TLS provider.

## What is considered “done” (do not reopen casually)

- Roadmap A–F (attention, BPE, GGUF, CPU/CUDA matmul path, QLoRA, in-process `cpu_sim` DP scale; no network/NCCL backend)
- Device-resident DR-1…DR-6 (small models, cudart-only kernels)
- Comfort/QLoRA profiles, resume-config, eval reports, generate top-k/top-p
- Dataset tools, multi-stage recipes, preference CLI
- Docs: [NATIVE_TRAIN.md](./NATIVE_TRAIN.md), [NONGOALS.md](./NONGOALS.md)

## Product boundaries (unchanged)

- **This package** = small native GPT student (local SFT/QLoRA).
- **Not this package** = finetune industry 4B/7B/… models (that would be core `process` + external trainer, if ever).
- Core never links this library by default.

## Using the experimental worker

Build and run as documented in the README. Prefer existing profiles:

```powershell
handoffkit-ml sft --dataset d.jsonl --out runs/sft --profile comfort
handoffkit-ml sft --dataset d.jsonl --out runs/qlora --profile qlora
handoffkit-ml eval --ckpt runs/qlora/model.hkckpt --dataset val.jsonl
handoffkit-ml generate --ckpt runs/qlora/model.hkckpt --prompt "P:" --top-k 40 --top-p 0.9
```
