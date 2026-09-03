"""CLI helpers for ``handoffkit clinical …``."""

from __future__ import annotations

import argparse
import json
from typing import Any

from handoffkit.clinical.audit import audit_path
from handoffkit.clinical.constants import STATUS_PUBLIC
from handoffkit.clinical.engine import ClinicalLab
from handoffkit.clinical.errors import ClinicalError


def add_clinical_parser(subparsers: Any) -> None:
    clinical = subparsers.add_parser(
        "clinical",
        help="Experimental sequential diagnosis lab (not clinically validated).",
    )
    sub = clinical.add_subparsers(dest="clinical_command")
    serve_p = sub.add_parser("serve", help="Serve the v1beta HTTP API.")
    serve_p.add_argument("--host", default="127.0.0.1")
    serve_p.add_argument("--port", type=int, default=8787)
    run_p = sub.add_parser("run", help="Start a sandbox sequential run.")
    run_p.add_argument("--experience", default="professional")
    run_p.add_argument("--blind-id", default="pro-sandbox-001")
    run_p.add_argument("--track", default="closed_sequential")
    run_p.add_argument("--json", action="store_true")
    bench_p = sub.add_parser(
        "benchmark",
        help="Official 897-case gate (fails until corpus exists).",
    )
    bench_p.add_argument("--official", action="store_true")
    bench_p.add_argument("--json", action="store_true")
    audit_p = sub.add_parser("audit", help="Refuse incomplete or contaminated reports.")
    audit_p.add_argument("path", nargs="?", default="")
    audit_p.add_argument("--json", action="store_true")


def run_clinical_command(args: argparse.Namespace) -> int:
    cmd = getattr(args, "clinical_command", None)
    if not cmd:
        print(
            "handoffkit clinical\n\n"
            "  clinical serve [--host 127.0.0.1] [--port 8787]\n"
            "  clinical run [--experience professional] [--blind-id pro-sandbox-001]\n"
            "  clinical benchmark --official\n"
            "  clinical audit [report.json]\n\n"
            f"{STATUS_PUBLIC}"
        )
        return 0
    lab = ClinicalLab()
    try:
        if cmd == "serve":
            from handoffkit.clinical.serve import serve

            serve(host=args.host, port=args.port, lab=lab)
            return 0
        if cmd == "run":
            run = lab.create_run(
                {
                    "experience": args.experience,
                    "blind_id": args.blind_id,
                    "track": args.track,
                }
            )
            payload = run.to_wire()
            if args.json:
                print(json.dumps(payload, indent=2, ensure_ascii=False))
            else:
                print(
                    f"run_id={payload['run_id']} phase={payload['phase']} "
                    f"blind_id={payload['blind_id']}\n{STATUS_PUBLIC}"
                )
            return 0
        if cmd == "benchmark":
            payload = lab.start_benchmark({"official": bool(args.official)})
            print(json.dumps(payload, indent=2, ensure_ascii=False))
            return 1
        if cmd == "audit":
            if not args.path:
                print("clinical audit requires a report path")
                return 1
            result = audit_path(args.path)
            print(json.dumps(result, indent=2, ensure_ascii=False))
            return 0
    except ClinicalError as exc:
        print(json.dumps(exc.to_wire(), indent=2, ensure_ascii=False))
        return 1
    print("unknown clinical command")
    return 1
