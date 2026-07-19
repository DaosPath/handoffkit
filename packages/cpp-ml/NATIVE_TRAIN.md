# Native train toolkit (HandoffKit ecosystem)

> **Package status: FROZEN** — see [STATUS.md](./STATUS.md). Use as-is; no feature work here for now.

Goal: the **best training experience that stays inside pure C++** — same monorepo,
no Python, no cuBLAS product dependency, core stays light.

This is **not** Unsloth/HF scale and **not** a 4B foundation finetuner.  
It **is** a coherent native pipeline for a small GPT student you own end-to-end.

## Tool map (v0.5)

| Command | Role |
|---------|------|
| `sft --profile comfort\|qlora` | Train student (full or QLoRA) |
| `sft --resume-config sft_config.json` | Warm-start dims + sibling `model.hkckpt` |
| `dataset stats` / `dataset split` | Inspect + train/val split |
| `eval` | CE + perplexity; writes `eval_report.json` |
| `recipe` | Multi-stage train (warm → QLoRA) |
| `generate --top-k --top-p --temperature` | Sampling / greedy continuation |
| `sft --preference` | Chosen/rejected preference path |
| `gguf-export` / `gguf-import` | Interop |
| Core `train distill` | Teacher → student JSONL |

## Canonical workflow (10 lines)

```powershell
handoffkit-cli train distill --out data/all.jsonl --prompt "P: MARK42"
handoffkit-ml dataset split --dataset data/all.jsonl --out data/ --val-ratio 0.2
handoffkit-ml sft --dataset data/train.jsonl --out runs/s1 --profile comfort
# Precedence: resume dims/base → profile knobs (qlora) → explicit flags last
handoffkit-ml sft --dataset data/train.jsonl --out runs/s2 `
  --resume-config runs/s1/sft_config.json --profile qlora --epochs 20
handoffkit-ml eval --ckpt runs/s2/model.hkckpt --dataset data/val.jsonl --tokenizer byte
handoffkit-ml generate --ckpt runs/s2/model.hkckpt --prompt "P:" --max-new 16 `
  --temperature 0.9 --top-k 40 --top-p 0.9
```

## Preference JSONL

```json
{"prompt":"Prefer: ","chosen":"yes","rejected":"no"}
```

```powershell
handoffkit-ml dataset stats --dataset pref.jsonl   # preference_pairs=N
handoffkit-ml sft --dataset pref.jsonl --out runs/pref --profile comfort --preference --dpo-beta 0.2
```

## Sampling

| Flag | Meaning |
|------|---------|
| `--temperature 0` | Greedy (default) |
| `--temperature 0.9 --top-k 40` | Top-k sample |
| `--temperature 0.8 --top-p 0.9` | Nucleus sample |

## Anti-patterns

- Expecting to load/finetune **Llama-4B** or HF safetensors here — no.  
- Mixing `--profile standard` dims with a comfort `model.hkckpt` — dim mismatch (clear error).  
- Using `cuda-resident` with `--qlora` — adapters use host GPT path (`cpu`/`cuda`).  

## Design principles

1. Ship real entry points under `include/handoffkit/ml/` + CLI.  
2. JSONL wire compatible with core distill.  
3. Comfort profiles for local loops; honest scale in `doctor`.  
4. One commit-sized feature at a time.

## Later (not v0.5)

- Micro-bench kernels  
- Packed sequences / longer context  
- External 4B trainer glue via core `process` (orchestration only)  
