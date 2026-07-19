# handoffkit-ml — package status

## Freeze (current)

| Field | Value |
|-------|--------|
| **State** | **FROZEN** |
| **Since** | 2026-07 (post native v0.5) |
| **Reason** | Monorepo focus moves to other work; native student train suite is usable as-is |
| **In scope while frozen** | Critical bugfixes only |
| **Out of scope while frozen** | New features, 4B/external trainer integration *inside this package*, large refactors, SOTA scale claims |

Unfreeze: update this file to `ACTIVE`, remove the freeze banner from [README.md](./README.md), and note the decision in the next commit message.

## What is considered “done” (do not reopen casually)

- Roadmap A–F (attention, BPE, GGUF, CPU/CUDA matmul path, QLoRA, DP scale)
- Device-resident DR-1…DR-6 (small models, cudart-only kernels)
- Comfort/QLoRA profiles, resume-config, eval reports, generate top-k/top-p
- Dataset tools, multi-stage recipes, preference CLI
- Docs: [NATIVE_TRAIN.md](./NATIVE_TRAIN.md), [NONGOALS.md](./NONGOALS.md)

## Product boundaries (unchanged)

- **This package** = small native GPT student (local SFT/QLoRA).
- **Not this package** = finetune industry 4B/7B/… models (that would be core `process` + external trainer, if ever).
- Core never links this library by default.

## Using while frozen

Build and run as documented in the README. Prefer existing profiles:

```powershell
handoffkit-ml sft --dataset d.jsonl --out runs/sft --profile comfort
handoffkit-ml sft --dataset d.jsonl --out runs/qlora --profile qlora
handoffkit-ml eval --ckpt runs/qlora/model.hkckpt --dataset val.jsonl
handoffkit-ml generate --ckpt runs/qlora/model.hkckpt --prompt "P:" --top-k 40 --top-p 0.9
```
