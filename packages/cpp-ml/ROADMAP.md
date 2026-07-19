# handoffkit-ml roadmap

## Implemented (0.3.x roadmap complete)

| Phase | Item | Status |
|-------|------|--------|
| F0–F6 | Package split, train scaffold, LoRA, device API, preference, quant stubs | done (prior) |
| **A** | Attention backward numerical parity + non-tiny model floors | **done** |
| **B** | In-tree BPE tokenizer beyond byte-level, wired into SFT/generate | **done** |
| **C** | GGUF f32 import/export + arch allowlist `gpt-mini` / `gpt2` / `llama-like` | **done** |
| **D** | Multi-thread CPU matmul + optional CUDA compile path (`matmul_device`) | **done** |
| **E** | NF4 quant + QLoRA train path (`--qlora`) multi-module freeze + adapter-only Adam | **done** |
| **F** | Data-parallel allreduce / `world_size` grad scale | **done** |

## Device-resident (DR) — own-kernel full-GPU train

| Phase | Item | Status |
|-------|------|--------|
| **DR-1** | Embedding gather/scatter + rmsnorm/CE/scale kernels (`resident.cu`) | **done** |
| **DR-2** | `ResidentLinear` AdamW train loop (weights always CUDA) | **done** |
| **DR-3** | `ResidentMLP` + `ResidentRMSNorm` (device optim) | **done** |
| **DR-4** | `ResidentMHA`/`ResidentBlock` — head split/merge + full attn bwd on GPU | **done** |
| **DR-5** | `DeviceGPT` + SFT `--device cuda-resident` | **done** |
| **DR-6** | CLI/docs + dual smoke | **done** |

See [DEVICE_RESIDENT.md](./DEVICE_RESIDENT.md).

## Still optional future (not required for this roadmap)

- Full cuBLAS/FlashAttention production kernels on multi-GPU NCCL clusters
- Official GGUF Q4_K load from third-party Llama-70B dumps
- Tensor-parallel / ZeRO-3
- Claiming HF/Unsloth SOTA parity

## Non-tiny floors (Standard profile)

- `n_embd >= 128`, `n_layer >= 4`, `n_head >= 4`, `block_size >= 128`
- Use `--allow-tiny` only for unit tests / CI speed

See NONGOALS.md for product boundaries (core stays light; no Python).
