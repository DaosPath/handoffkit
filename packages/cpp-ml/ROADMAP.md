# handoffkit-ml roadmap (F6)

## Done in-tree (0.2.x)

| Phase | Item | Status |
|-------|------|--------|
| F0 | Package split from core | done |
| F1 | CPU tensor, ops, gradcheck, linear overfit | done |
| F2 | GPT-mini, JSONL SFT, ckpt, generate CLI | done |
| F3 | LoRA on Linear + SFT `--lora` projection | done |
| F4 | `HANDOFFKIT_ML_CUDA` flag + device API (CPU runtime) | done (kernels stub) |
| F5 | Preference / DPO-like proxy via `--preference` | done (tiny proxy) |
| F6 | int8 quant stub, dist status, this checklist | done |

## Still roadmap (not claimed complete)

- [ ] Real CUDA kernels (cuBLAS matmul, attention)
- [ ] NF4 / QLoRA training
- [ ] Multi-GPU NCCL data parallel
- [ ] GGUF import/export for external bases
- [ ] Full attention backward numerical parity suite
- [ ] SentencePiece / BPE beyond byte-level
- [ ] Architecture allowlist beyond GPT-mini

## Why not “HF complete”

Shipping a full Hugging Face competitor is multi-year. This package holds the engine **without** breaking `handoffkit_core` lightness. See NONGOALS.md.
