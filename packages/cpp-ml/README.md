# handoffkit-ml (optional complement)

**Experimental C++ weight-training engine for HandoffKit.**  
**Not** part of `handoffkit_core`. **No Python.**

| Package | Role |
|---------|------|
| `packages/cpp` (`handoffkit_core`) | Agents, handoffs, distill **jobs**, echo/process — **stays light** |
| `packages/cpp-ml` (**this**) | Tensors, GPT-mini, SFT/LoRA, preference, ckpt — **opt-in** |

> Core orquesta. **ML** entrena pesos. Instala el complemento solo si lo necesitas.

## Status `0.2.0` (F1–F6 native surface)

| Phase | Content | Status |
|-------|---------|--------|
| F0 | Scaffold / split from core | done |
| F1 | CPU tensor, matmul, CE, gradcheck, linear overfit | done |
| F2 | GPT-mini, JSONL SFT, `.hkckpt`, `generate` | done |
| F3 | LoRA adapters + `--lora` | done |
| F4 | `HANDOFFKIT_ML_CUDA` flag + device API (CPU runtime) | done (kernels stub) |
| F5 | `--preference` DPO-like proxy | done (tiny) |
| F6 | int8 quant stub, dist status, [ROADMAP.md](./ROADMAP.md) | done |

See [NONGOALS.md](./NONGOALS.md). This is **not** drop-in Hugging Face.

## Build

```powershell
cmake -S packages/cpp-ml -B packages/cpp-ml/build -DCMAKE_BUILD_TYPE=Release
cmake --build packages/cpp-ml/build --config Release
ctest --test-dir packages/cpp-ml/build -C Release --output-on-failure
.\packages\cpp-ml\build\handoffkit-ml.exe doctor
```

Optional: `-DHANDOFFKIT_ML_CUDA=ON` sets compile definitions only (no kernels yet).

## CLI

```text
handoffkit-ml doctor
handoffkit-ml sft --dataset student.jsonl --out runs/ml --epochs 20
handoffkit-ml sft --dataset d.jsonl --out runs/lora --lora
handoffkit-ml sft --dataset pref.jsonl --out runs/pref --preference
handoffkit-ml generate --ckpt runs/ml/model.hkckpt --prompt "Hi " --max-new 32
handoffkit-ml quant-demo
```

### With core distill

```text
handoffkit-cli train distill --out student.jsonl …
handoffkit-ml sft --dataset student.jsonl --out runs/student
handoffkit-ml generate --ckpt runs/student/model.hkckpt --prompt "…"
```

## Layout

```text
include/handoffkit/ml/   tensor ops nn optim token data peft ckpt sft device quant
src/ops.cpp version.cpp cli/main.cpp
tests/test_ml_*.cpp
```

## Versioning

- Core: `1.x`
- This package: `0.x` experimental

## License

Same as monorepo / `packages/cpp/LICENSE`.
