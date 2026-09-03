# handoffkit-ml (optional complement)

> ## Status: **ACTIVE FOR HK-CSP INTEGRATION**
>
> The native training scope remains deliberately small. The 0.6.0 line adds a
> bounded, experimental direct HK-CSP TLS worker; it does not claim 4B/7B
> scale, an external trainer, or general distributed-worker support.

**C++ weight-training engine for HandoffKit — not part of `handoffkit_core`.**  
**No Python.** Default train profile is **non-tiny** (128d / 4 layers).

| Package | Role |
|---------|------|
| `cpp/packages/handoffkit` | Core: agents, distill jobs, echo/process |
| `cpp/packages/handoffkit-ml` (**this**) | Tensors, BPE, GPT/llama-like, GGUF, LoRA/QLoRA, in-process `cpu_sim` DP; no network/NCCL backend |

## HK-CSP worker (experimental)

With `HANDOFFKIT_ML_LINK_CORE=ON`, `MlCspWorker` executes real `TrainingJob`
and `EvaluationJob` operations through the core bounded native worker. It
checks input artifact size/SHA-256, streams progress, emits hashed
checkpoint/report artifacts, propagates cancellation and deadlines, reports
structured failures, and exposes measured CPU/RAM plus compiled/available CUDA
metadata. Inputs pass through a root/media/size/hash/signature policy and a
verified snapshot before consumption. The optional Go mTLS gateway starts the
`handoffkit-cpp-ml-worker` local process without a shell. The direct native
route is enabled with `HANDOFFKIT_ML_LINK_CORE=ON` and
`HANDOFFKIT_ML_TLS=ON`, then `handoffkit-cpp-ml-worker --tls-policy
POLICY.json`; it requires TLS 1.3 + mTLS and derives identity/capabilities from
the certificate and local fingerprint policy. The older `--policy` NDJSON mode
remains a local-subprocess compatibility path only.

The TCP interoperability gate is a real-process matrix:

```powershell
python cpp/packages/handoffkit-ml/tests/interop/test_tcp_interoperability.py `
  .local-tests/cpp-ml-tls-build/handoffkit-cpp-ml-worker.exe
```

It runs independent Python, Node.js, Go, and Rust TLS 1.3+mTLS clients against
fresh C++ workers, then drives independent Python, Node.js, Go, and Rust
servers from the C++ client. Go and Rust reverse servers are standalone
commands, not client server modes. This is transport and certificate-admission
evidence; the shared security-transcript byte vector is covered by five-runtime
conformance, while provider/session operational qualification remains separate.

## Roadmap status

Primary checklist in [ROADMAP.md](./ROADMAP.md) (Phases A–F) is **implemented**.  
**Device-resident** path (weights + activations on GPU): [DEVICE_RESIDENT.md](./DEVICE_RESIDENT.md) **DR-1…DR-6**.  
**v0.6.0** direct TLS/dispatcher worker and durable at-least-once ledger path
are experimental; exactly-once and global zeroization remain unavailable.

## Build

```powershell
# CPU (default)
cmake -S cpp/packages/handoffkit-ml -B cpp/packages/handoffkit-ml/build -DCMAKE_BUILD_TYPE=Release
cmake --build cpp/packages/handoffkit-ml/build --config Release
ctest --test-dir cpp/packages/handoffkit-ml/build -C Release --output-on-failure
```

### CUDA (own kernels, **cudart only — no cuBLAS/cuDNN**)

On Windows use **MSVC + nvcc** (Visual Studio generator). MinGW host is not supported for `.cu`.

```powershell
# From "x64 Native Tools" / after vcvars64.bat:
cmake -S cpp/packages/handoffkit-ml -B cpp/packages/handoffkit-ml/build-cuda -G "Visual Studio 17 2022" -A x64 -DHANDOFFKIT_ML_CUDA=ON
cmake --build cpp/packages/handoffkit-ml/build-cuda --config Release
.\cpp\packages\handoffkit-ml\build-cuda\Release\test_ml_cuda_parity.exe
.\cpp\packages\handoffkit-ml\build-cuda\Release\test_ml_resident_gpt.exe
.\cpp\packages\handoffkit-ml\build-cuda\Release\handoffkit-ml.exe doctor
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
handoffkit-ml sft --dataset d.jsonl --out runs/sft --profile comfort
handoffkit-ml sft --dataset d.jsonl --out runs/qlora --profile qlora
handoffkit-ml dataset stats --dataset d.jsonl
handoffkit-ml dataset split --dataset d.jsonl --out data/ --val-ratio 0.2
handoffkit-ml eval --ckpt runs/qlora/model.hkckpt --dataset data/val.jsonl
handoffkit-ml recipe --file train.recipe.jsonl
handoffkit-ml generate --ckpt runs/qlora/model.hkckpt --prompt "P:"
handoffkit-ml gguf-export --ckpt runs/ml/model.hkckpt --out model.gguf
```

Full native toolkit guide: [NATIVE_TRAIN.md](./NATIVE_TRAIN.md).

`--device cpu|cuda|cuda-resident` — `cuda` accelerates GEMM; `cuda-resident` keeps **weights + activations** on GPU for the train loop.

### Comfortable train (profiles — recommended)

| Profile | Meaning |
|---------|---------|
| `comfort` | Full SFT, tiny dims, byte tok, 40 epochs |
| `qlora` | Same + multi-module NF4 QLoRA |
| `standard` | Non-tiny floors (128d / 4L) |
| `large` | 256d / 6L |
| `tiny` | Debug only |

```powershell
# One flag each — dims/epochs/lr/tokenizer applied for you
handoffkit-ml sft --dataset d.jsonl --out runs/sft --profile comfort
handoffkit-ml sft --dataset d.jsonl --out runs/qlora --profile qlora
# Bare --qlora without dims also selects the qlora comfort profile
handoffkit-ml sft --dataset d.jsonl --out runs/qlora2 --qlora
# Override any knob after the profile:
handoffkit-ml sft --dataset d.jsonl --out runs/qlora3 --profile qlora --device cuda --epochs 60

handoffkit-ml generate --ckpt runs/qlora/model.hkckpt --prompt "P:" --max-new 16
```

Artifacts: `model.hkckpt`, `train_report.json`, `sft_config.json`.  
Progress: profiles set `--log-every 20` (override with `--log-every N`).

QLoRA report: `backend_id=qlora`, `nf4_base`, `adapter_only_optim`, `peft_modules`, `profile`.

### Distill bridge (core → this package)

```powershell
handoffkit-cli train distill --out runs/student.jsonl --prompt "P: MARK42"
handoffkit-ml sft --dataset runs/student.jsonl --out runs/ml --qlora --allow-tiny --tokenizer byte
handoffkit-ml generate --ckpt runs/ml/model.hkckpt --prompt "P:" --max-new 16
```

In-repo: `test_ml_distill_wire`, `test_ml_qlora_sft` (freeze + loss drop + generate).

### v0.5 extras

```powershell
# Resume second stage from prior sft_config.json (+ sibling model.hkckpt)
handoffkit-ml sft --dataset d.jsonl --out runs/s2 --resume-config runs/s1/sft_config.json --epochs 15

# Sampling generate
handoffkit-ml generate --ckpt runs/s2/model.hkckpt --prompt "P:" --temperature 0.9 --top-k 40 --top-p 0.9

# Eval report (eval_report.json under --out or ckpt/eval)
handoffkit-ml eval --ckpt runs/s2/model.hkckpt --dataset val.jsonl --out runs/s2/eval

# Preference
handoffkit-ml sft --dataset pref.jsonl --out runs/pref --profile comfort --preference
```

### Honest scope (not Unsloth/HF tops)

Native stack = **small student** training suite. It does **not** claim Unsloth / Hugging Face **1B–4B+** parity or load those bases — see [NONGOALS.md](./NONGOALS.md) and [NATIVE_TRAIN.md](./NATIVE_TRAIN.md).

Non-tiny defaults without `--profile`: `n_embd=128`, `n_layer=4`, `block_size=128`.

## License

Same as monorepo / `cpp/packages/handoffkit/LICENSE`.
