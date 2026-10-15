"""OpenRouter Fusion-inspired multi-model panel demo.

Offline by default. Real provider calls require --real and provider credentials.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from handoffkit.recipes.fusion import (
    DEFAULT_FUSION_MODELS,
    DEFAULT_FUSION_TASK,
    configure_stdout,
    run_fusion_demo,
)

ROOT = Path(__file__).resolve().parents[2]
REPORTS_DIR = ROOT / "reports"


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run a Fusion-style HandoffKit panel demo.")
    parser.add_argument("--task", default=DEFAULT_FUSION_TASK)
    parser.add_argument("--provider", default="opencode-go")
    parser.add_argument(
        "--models",
        default=DEFAULT_FUSION_MODELS,
        help="Comma-separated model ids for --real mode.",
    )
    parser.add_argument("--real", action="store_true", help="Call real providers.")
    parser.add_argument("--timeout", type=float, default=300.0)
    parser.add_argument("--output-name", default="fusion_style_demo")
    return parser


def main(argv: list[str] | None = None) -> int:
    configure_stdout()
    args = _parser().parse_args(argv)
    report, json_path, markdown_path = run_fusion_demo(
        task=args.task,
        provider=args.provider,
        models=args.models,
        real=args.real,
        timeout=args.timeout,
        output_name=args.output_name,
        output_dir=REPORTS_DIR,
    )
    print("Fusion-style demo success:", report.success)
    print("Mode:", report.mode)
    print("Panel models:", ", ".join(item.model for item in report.panel))
    print("Markdown report:", markdown_path)
    print("JSON report:", json_path)
    return 0 if report.success else 1


if __name__ == "__main__":
    raise SystemExit(main())
