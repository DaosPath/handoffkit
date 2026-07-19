# Device-resident train (DR) plan

Goal: **weights + activations stay on CUDA** for the SFT train loop.  
Stack: own `.cu` kernels + **cudart only** (no cuBLAS / cuDNN / CUTLASS).

## Phases

| Phase | Deliverable | Evidence |
|-------|-------------|----------|
| **DR-1** | Embedding gather/scatter + scale/axpy/rmsnorm/CE kernels in `resident.cu` | `test_ml_resident_embed` |
| **DR-2** | `ResidentLinear` (W/b/g/m/v on CUDA, AdamW device) | `test_ml_resident_linear` loss↓, `still_cuda` |
| **DR-3** | `ResidentMLP` + `ResidentRMSNorm` (device SGD) | `test_ml_resident_mlp` |
| **DR-4** | `ResidentMHA` / `ResidentBlock` — head split/merge + full attn bwd on GPU | `test_ml_resident_block` |
| **DR-5** | `DeviceGPT` + SFT `--device cuda-resident` | `test_ml_resident_gpt` + CLI |
| **DR-6** | CLI help, README/ROADMAP, dual smoke | SCRATCH logs |

## Hard guarantees

1. Mid-loop `weights_on_cuda()` asserts (throws if weights leave GPU).
2. MHA does **not** pack heads on host; Q/K/V/att/y stay device-side.
3. RMSNorm parameter update is device axpy (no host download for optim).
4. Loss/CE mean: device logits + device targets; only a single float returns for logging.

## Non-goals

- FlashAttention / multi-GPU NCCL
- Claiming SOTA speed vs cuBLAS
- Changing `handoffkit_core` weight

## Build

```powershell
cmake -S packages/cpp-ml -B packages/cpp-ml/build-cuda -G "Visual Studio 17 2022" -A x64 -DHANDOFFKIT_ML_CUDA=ON
cmake --build packages/cpp-ml/build-cuda --config Release --target test_ml_resident_gpt handoffkit-ml
```
