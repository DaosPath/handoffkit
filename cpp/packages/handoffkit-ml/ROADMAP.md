# handoffkit-ml roadmap

> Native model scope remains bounded. The package is active only for the
> HandoffKit 1.19 HK-CSP worker integration and fixes; see [STATUS.md](./STATUS.md).

## HK-CSP integration

| Item | Status |
|---|---|
| Real TrainingJob/EvaluationJob dispatch through bounded native worker | experimental, tested |
| Progress and hashed checkpoint/report ArtifactRef output | experimental, tested |
| Cancellation, deadlines, failure reporting, CPU/CUDA metadata | experimental, tested |
| Mandatory local artifact policy/snapshot gate | experimental, tested |
| Remote Go mTLS gateway to local C++ process | experimental, real-process CI |
| Direct C++ TLS worker (`--tls-policy`) | experimental/provider-dependent; real TCP test |

## Implemented (0.3.x native-model roadmap complete)

| Phase | Item | Status |
|-------|------|--------|
| F0–F6 | Package split, train scaffold, LoRA, device API, preference, quant stubs | done (prior) |
| **A** | Attention backward numerical parity + non-tiny model floors | **done** |
| **B** | In-tree BPE tokenizer beyond byte-level, wired into SFT/generate | **done** |
| **C** | GGUF f32 import/export + arch allowlist `gpt-mini` / `gpt2` / `llama-like` | **done** |
| **D** | Multi-thread CPU matmul + optional CUDA compile path (`matmul_device`) | **done** |
| **E** | NF4 quant + QLoRA train path (`--qlora`) multi-module freeze + adapter-only Adam | **done** |
| **F** | In-process `cpu_sim` allreduce / `world_size` grad scale; no network or NCCL backend | **done** |

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

## Native train toolkit (ecosystem depth)

| Item | Status |
|------|--------|
| Comfort / QLoRA profiles (`--profile`) | **done** |
| `eval` CE + perplexity | **done** |
| `dataset stats` / `dataset split` | **done** |
| Multi-stage `recipe` runner | **done** |
| Guide [NATIVE_TRAIN.md](./NATIVE_TRAIN.md) | **done** |

## v0.5 checklist

| Phase | Item | Status |
|-------|------|--------|
| 1 | Generate top-k / top-p sampling | **done** |
| 2 | Resume `--resume-config` + clear dim mismatch | **done** |
| 3 | Durable `eval_report.json` | **done** |
| 4 | Preference CLI tool-grade path | **done** |
| 5 | Docs / doctor scale honesty | **done** |

## v0.6.0 HK-CSP closure scope

| Item | Status |
|---|---|
| C++ TLS 1.3/mTLS + certificate-bound SAN/fingerprint identity | experimental/provider-dependent |
| Common CspDispatcher receive/replay/authorize/dispatch path | experimental, real TCP tested |
| Durable scheduler claim/complete/fail and durable replay state | experimental, restart/corruption tested |
| `--policy` NDJSON compatibility mode | local-only legacy |
| Exactly-once external effects and global zeroization | unavailable, fail closed |

## Still optional future (not required for this roadmap)

- Full cuBLAS/FlashAttention production kernels on multi-GPU NCCL clusters
- Official GGUF Q4_K load from third-party Llama-70B dumps
- Tensor-parallel / ZeRO-3
- Claiming HF/Unsloth SOTA parity
- Top-k sampling, packed sequences, resume-from-config

## Non-tiny floors (Standard profile)

- `n_embd >= 128`, `n_layer >= 4`, `n_head >= 4`, `block_size >= 128`
- Use `--allow-tiny` only for unit tests / CI speed

See NONGOALS.md for product boundaries (core stays light; no Python).
