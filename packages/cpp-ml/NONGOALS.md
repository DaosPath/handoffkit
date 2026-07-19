# handoffkit-ml — non-goals and “why not”

This file is the **careful** list of what we refuse (for now or forever) so the complement does not silently become a second Hugging Face with broken promises.

## Forever (product boundary)

| Non-goal | Why not |
|----------|---------|
| Live **inside** `handoffkit_core` | Breaks light core / Conan / default CI |
| **Python** in the train/finetune/export/infer path | User constraint; also keeps one runtime story |
| **cuBLAS / cuDNN / CUTLASS** as product deps | Own CUDA kernels only; NVIDIA **cudart** is platform OK |
| Core public headers including `handoffkit/ml/*` | Dependency must be ml → core only |
| Default CI **requiring** GPU or long ML builds | Core gate stays green and fast |
| Marketing “drop-in HF / Unsloth / 70B QLoRA” or “match training tops” on 1B+ | Honesty: native comfort QLoRA ≠ industry SOTA scale/speed |

## Until a later phase says otherwise

| Non-goal | Until | Why not now |
|----------|-------|-------------|
| Any real training (F0) | F1+ | Scaffold first; wire before math |
| GPU / CUDA kernels | F4 | CPU correctness first |
| Full Llama/Mistral load + LoRA | F3 | Need mini LM + formats first (F2) |
| QLoRA / 4-bit train | F6-ish | Hard; after LoRA+fp16 path works |
| Multi-GPU / ZeRO / TP | F6 | Single-device SFT first |
| DPO / preference optimization | F5 | Useless without solid SFT |
| Autograd tape framework day one | maybe never | Manual layer backward (nanoGPT-style) first |
| JS parity of tensor engine | n/a | Documented C++-only native package |
| Shipping huge pretrained weights in the repo | never | Download/import documented externally |

## What core still owns (do not reimplement here)

- Multi-agent handoffs, fusion, demos  
- Teacher **distill** via providers (`AnyProvider`)  
- JSONL dataset I/O / job manifests / `TrainReport` wire (ML **consumes** these later)  
- `EchoTrainBackend` / `ProcessTrainBackend` orchestration  

## What “success” is not

- F0 success ≠ “can finetune Llama”  
- F2 success = tiny student, real loss, generate, pure C++ pipeline with core distill  
- “Tipo HF” = multi-year roadmap inside **this** package only  

If a PR pulls ML sources into `HANDOFFKIT_CORE_SOURCES`, **reject it**.
