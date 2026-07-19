# Native train toolkit (HandoffKit ecosystem)

Goal: the **best training experience that stays inside pure C++** — same monorepo,
no Python, no cuBLAS product dependency, core stays light.

This is **not** Unsloth/HF scale. It **is** a coherent native pipeline you can
own end-to-end.

## Tool map

| Command | Role |
|---------|------|
| `sft --profile comfort\|qlora` | Train student (full or QLoRA) |
| `dataset stats` | Inspect JSONL |
| `dataset split` | Train/val split |
| `eval` | CE mean + perplexity on held-out JSONL |
| `recipe` | Multi-stage train (warm → QLoRA → …) |
| `generate` | Greedy/sample continuation from `model.hkckpt` |
| `gguf-export` / `gguf-import` | Interop |
| Core `train distill` | Teacher → student JSONL |

## Recommended workflow

```powershell
# 0) Distill (core) or hand-write JSONL
handoffkit-cli train distill --out data/all.jsonl --prompt "P: MARK42"

# 1) Hygiene
handoffkit-ml dataset stats --dataset data/all.jsonl
handoffkit-ml dataset split --dataset data/all.jsonl --out data/ --val-ratio 0.2

# 2) One-shot QLoRA
handoffkit-ml sft --dataset data/train.jsonl --out runs/qlora --profile qlora

# 3) Evaluate
handoffkit-ml eval --ckpt runs/qlora/model.hkckpt --dataset data/val.jsonl --tokenizer byte

# 4) Generate
handoffkit-ml generate --ckpt runs/qlora/model.hkckpt --prompt "P:" --max-new 16
```

## Multi-stage recipe file (`*.jsonl`)

```text
{"dataset":"data/train.jsonl","out_dir":"runs/recipe","val_dataset":"data/val.jsonl"}
{"stage":"warm","profile":"comfort","epochs":20}
{"stage":"adapt","profile":"qlora","epochs":30}
```

```powershell
handoffkit-ml recipe --file my.recipe.jsonl
```

Stage N loads stage N−1 `model.hkckpt` as `--base-ckpt` automatically.

## Design principles

1. **Ship real entry points** — CLI and headers under `include/handoffkit/ml/`.
2. **Wire format** — SFT JSONL `prompt`/`completion` (core distill compatible).
3. **Comfort profiles** — one flag for local quality loops.
4. **Honesty** — large-model SOTA is out of scope (NONGOALS.md); native depth is in scope.

## Next native candidates (later)

- Top-k / nucleus sampling in generate  
- Preference / DPO polish CLI  
- Micro-bench matmul/attention  
- Resume from `sft_config.json`  
- Packed sequences / longer context kernels  
