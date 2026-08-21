#!/usr/bin/env python3
"""Minimal external trainer stub for ProcessTrainBackend demos.

Writes metrics.json under --output-dir. Not a real model trainer.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--dataset", required=True)
    p.add_argument("--output-dir", required=True)
    p.add_argument("--epochs", type=int, default=1)
    args = p.parse_args()
    out = Path(args.output_dir)
    out.mkdir(parents=True, exist_ok=True)
    n = sum(1 for line in Path(args.dataset).read_text(encoding="utf-8").splitlines() if line.strip())
    metrics = {
        "final_loss": max(0.05, 1.0 / max(1, args.epochs)),
        "steps": max(1, n * args.epochs),
        "examples_seen": n,
        "backend": "hk_train_echo_stub",
    }
    (out / "metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    print(json.dumps({"ok": True, **metrics}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
