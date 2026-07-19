# handoffkit-ml (optional complement)

**C++ weight-training engine for HandoffKit — not part of `handoffkit_core`.**  
**No Python.** Default train profile is **non-tiny** (128d / 4 layers).

| Package | Role |
|---------|------|
| `packages/cpp` | Core: agents, distill jobs, echo/process |
| `packages/cpp-ml` (**this**) | Tensors, BPE, GPT/llama-like, GGUF, LoRA/QLoRA, DP |

## Roadmap status

All items in [ROADMAP.md](./ROADMAP.md) primary checklist are **implemented** (Phases A–F).

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
.\packages\cpp-ml\build-cuda\Release\handoffkit-ml.exe doctor
```

Policy: **hand-written** `.cu` GEMM/elementwise/softmax; dependency is only **NVIDIA cudart**.

## CLI

```text
handoffkit-ml doctor
handoffkit-ml sft --dataset student.jsonl --out runs/ml --epochs 20
handoffkit-ml sft --dataset d.jsonl --out runs/qlora --qlora --arch gpt2
handoffkit-ml generate --ckpt runs/ml/model.hkckpt --prompt "P:" --bpe runs/ml/tokenizer.bpe
handoffkit-ml gguf-export --ckpt runs/ml/model.hkckpt --out model.gguf
handoffkit-ml gguf-import --gguf model.gguf --out runs/from_gguf
```

Non-tiny defaults: `n_embd=128`, `n_layer=4`, `block_size=128`, tokenizer `bpe`.  
Pass `--allow-tiny` only for fast experiments below floors.

## License

Same as monorepo / `packages/cpp/LICENSE`.
