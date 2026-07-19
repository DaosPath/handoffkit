# handoffkit-ml (optional complement)

**Experimental C++ weight-training engine for HandoffKit.**  
**Not** part of `handoffkit_core`. **No Python.**

| Package | Role |
|---------|------|
| `packages/cpp` (`handoffkit_core`) | Agents, handoffs, distill **jobs**, echo/process train orchestration — **stays light** |
| `packages/cpp-ml` (**this**) | Tensors, optimizers, SFT/LoRA, checkpoints — **opt-in only** |

> HandoffKit core orquesta agentes y jobs de train.  
> **HandoffKit ML** entrena pesos en C++.  
> Instalas este complemento solo si lo necesitas.

## Why not inside core?

Shipping a neural trainer (autograd, CUDA, checkpoints) inside `handoffkit_core` would break:

- Light Conan / tarball / `find_package` consumers  
- Fast default CI without GPU  
- The public promise that core is orchestration-first  

So this lives in a **sibling package**. Core **never** `#include`s `handoffkit/ml/…` in public headers and **never** links `handoffkit_ml` by default.

## Status (version 0.1.x)

| Phase | Content | Status |
|-------|---------|--------|
| **F0** | Scaffold, CLI stub, docs, CMake | **current** |
| F1 | CPU tensors + ops + gradcheck + overfit | planned |
| F2 | Mini-transformer + SFT on core JSONL + generate | planned |
| F3 | LoRA + import one architecture | planned |
| F4 | CUDA opt-in | planned |
| F5+ | Preferences / multi-GPU / quant train (“HF-like”) | roadmap |

See [NONGOALS.md](./NONGOALS.md).

## Build (F0)

```powershell
cmake -S packages/cpp-ml -B packages/cpp-ml/build -DCMAKE_BUILD_TYPE=Release
cmake --build packages/cpp-ml/build --config Release
ctest --test-dir packages/cpp-ml/build -C Release --output-on-failure
.\packages\cpp-ml\build\handoffkit-ml.exe doctor
```

Core is **not** required for F0. Later (`HANDOFFKIT_ML_LINK_CORE=ON`) the ML lib will link a prebuilt `handoffkit_core` to reuse `TrainExample` / JSONL helpers — dependency direction is always **ml → core**, never the reverse.

## CLI (F0)

```text
handoffkit-ml help
handoffkit-ml version
handoffkit-ml doctor
handoffkit-ml sft …        # exit 2 until Fase 2
handoffkit-ml generate …   # exit 2 until Fase 2
```

### Product split vs core CLI

```text
# Core — distill + job orchestration (no weight math)
handoffkit-cli train distill --out student.jsonl …
handoffkit-cli train run --backend echo|process …

# Complement — native weights (Fase 2+)
handoffkit-ml sft --dataset student.jsonl --out runs/ml-out
handoffkit-ml generate --ckpt runs/ml-out/model.hkckpt …
```

You can also drive the future `handoffkit-ml-train` binary via core’s **process** backend (argv to a C++ exe — still no Python).

## Layout

```text
packages/cpp-ml/
  include/handoffkit/ml/   public headers
  src/                     library + cli
  tests/                   ctest (optional CI job)
  README.md
  NONGOALS.md
```

## Versioning

- Core: `1.x` (e.g. 1.14.1)  
- This complement: **`0.x` experimental**, independent until F2 is useful  

## License

Same as the monorepo (see root / `packages/cpp/LICENSE`).
