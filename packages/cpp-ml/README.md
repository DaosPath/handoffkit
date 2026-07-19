# handoffkit-ml (optional complement)

**C++ weight-training engine for HandoffKit — not part of `handoffkit_core`.**  
**No Python.** Default train profile is **non-tiny** (128d / 4 layers).

| Package | Role |
|---------|------|
| `packages/cpp` | Core: agents, distill jobs, echo/process |
| `packages/cpp-ml` (**this**) | Tensors, BPE, GPT/llama-like, GGUF, LoRA/QLoRA, DP |

## Roadmap status

Primary checklist in [ROADMAP.md](./ROADMAP.md) (Phases A–F) is **implemented**.  
**Device-resident** path (weights + activations on GPU): [DEVICE_RESIDENT.md](./DEVICE_RESIDENT.md) **DR-1…DR-6**.

## Build

```powershell
# CPU (default)
cmake -S packages/cpp-ml -B packages/cpp-ml/build -DCMAKE_BUILD_TYPE=Release
cmake --build packages/cpp-ml/build --config Release
ctest --test-dir packages/cpp-ml/build -C Release --output-on-failure
```

### CUDA (own kernels, **cudart only — no cuBLAS/cuDNN**)

On Windows use **MSVC + nvcc** (Visual Studio generator). MinGW host is not supported for `.cu`.

```powershell
# From "x64 Native Tools" / after vcvars64.bat:
cmake -S packages/cpp-ml -B packages/cpp-ml/build-cuda -G "Visual Studio 17 2022" -A x64 -DHANDOFFKIT_ML_CUDA=ON
cmake --build packages/cpp-ml/build-cuda --config Release
.\packages\cpp-ml\build-cuda\Release\test_ml_cuda_parity.exe
.\packages\cpp-ml\build-cuda\Release\test_ml_resident_gpt.exe
.\packages\cpp-ml\build-cuda\Release\handoffkit-ml.exe doctor
```

Policy: **hand-written** `.cu` GEMM/elementwise/softmax/embed/attention helpers; dependency is only **NVIDIA cudart**.

### Device-resident SFT

```powershell
handoffkit-ml sft --dataset d.jsonl --out runs/resident `
  --device cuda-resident --allow-tiny --epochs 5 `
  --n-embd 64 --n-layer 2 --n-head 4 --block-size 48 --tokenizer byte
```

Asserts mid-loop that weights stay on CUDA. See `DEVICE_RESIDENT.md`.

## CLI

```text
handoffkit-ml doctor
handoffkit-ml sft --dataset student.jsonl --out runs/ml --epochs 20
handoffkit-ml sft --dataset d.jsonl --out runs/qlora --qlora --arch gpt2
handoffkit-ml sft --dataset d.jsonl --out runs/res --device cuda-resident --allow-tiny
handoffkit-ml generate --ckpt runs/ml/model.hkckpt --prompt "P:" --bpe runs/ml/tokenizer.bpe
handoffkit-ml gguf-export --ckpt runs/ml/model.hkckpt --out model.gguf
handoffkit-ml gguf-import --gguf model.gguf --out runs/from_gguf
```

`--device cpu|cuda|cuda-resident` — `cuda` accelerates GEMM; `cuda-resident` keeps **weights + activations** on GPU for the train loop.

### Comfortable train (plain SFT)

```powershell
handoffkit-ml sft --dataset d.jsonl --out runs/sft --allow-tiny `
  --tokenizer byte --epochs 40 --n-embd 64 --n-layer 2 --n-head 4 --block-size 48 --device cpu
handoffkit-ml generate --ckpt runs/sft/model.hkckpt --prompt "P:" --max-new 16
```

### Comfortable QLoRA (one-shot)

NF4-quantized **frozen** bases on all block Linears + `lm_head`; only LoRA **A/B** get Adam; merge to dense `model.hkckpt` at the end.

```powershell
handoffkit-ml sft --dataset d.jsonl --out runs/qlora --qlora --allow-tiny `
  --tokenizer byte --epochs 40 --n-embd 64 --n-layer 2 --n-head 4 --block-size 48 `
  --lora-rank 8 --device cpu
# optional base: --base-ckpt prev/model.hkckpt   or   --gguf model.gguf
# optional GPU GEMM: --device cuda   (not cuda-resident — adapters use host GPT path)
handoffkit-ml generate --ckpt runs/qlora/model.hkckpt --prompt "P:" --max-new 16
```

Report fields: `backend_id=qlora`, `use_qlora`, `nf4_base`, `adapter_only_optim`, `peft_modules`, `lora_rank`.

### Distill bridge (core → this package)

```powershell
handoffkit-cli train distill --out runs/student.jsonl --prompt "P: MARK42"
handoffkit-ml sft --dataset runs/student.jsonl --out runs/ml --qlora --allow-tiny --tokenizer byte
handoffkit-ml generate --ckpt runs/ml/model.hkckpt --prompt "P:" --max-new 16
```

In-repo: `test_ml_distill_wire`, `test_ml_qlora_sft` (freeze + loss drop + generate).

### Honest scope (not Unsloth/HF tops)

This package optimizes for **native C++ comfort** (one CLI, real NF4 freeze, multi-module adapters, loadable ckpt). It does **not** claim Unsloth / Hugging Face / Axolotl **speed or 1B+ scale** parity — see [NONGOALS.md](./NONGOALS.md).

Non-tiny defaults: `n_embd=128`, `n_layer=4`, `block_size=128`, tokenizer `bpe`.  
Pass `--allow-tiny` only for fast experiments below floors.

## License

Same as monorepo / `packages/cpp/LICENSE`.
