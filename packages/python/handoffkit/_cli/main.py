"""CLI entrypoint (argparse + dispatch)."""

from __future__ import annotations

import argparse

from handoffkit._cli.demos import (
    evaluate_report,
    list_provider_models,
    list_providers,
    list_showcases,
    probe_provider_models,
    render_report,
    run_api,
    run_async_demo,
    run_coding_review_demo,
    run_demo,
    run_doctor,
    run_doctor_benchmark_demo,
    run_doctor_orchestrator_demo,
    run_extension_demo,
    run_fusion_style_demo,
    run_independent_benchmark_demo,
    run_mai_style_doctor_benchmark_demo,
    run_named_showcase,
    run_provider_formats_demo,
    run_provider_tools_demo,
    run_quality_demo,
    run_recipe_demo,
    run_replay_demo,
    run_research_workflow_demo,
    run_structured_demo,
    run_support_escalation_demo,
    run_trace_demo,
    run_validators_demo,
    select_provider_model,
    validate_report,
)
from handoffkit._cli.media import (
    inspect_media_transcript,
    list_media_ops_text,
    plan_media_dubbing,
    run_media_context_demo,
    run_media_demo,
    run_media_pipeline_plan,
)
from handoffkit._cli.project import (
    create_extension,
    delete_key,
    init_project,
    init_project_interactive,
    list_keys,
    set_key,
    write_project_report,
)
from handoffkit._version import __version__
from handoffkit.recipes.showcases import showcase_names


def main(argv: list[str] | None = None) -> int:
    """Run the command-line interface."""
    parser = argparse.ArgumentParser(prog="handoffkit")
    parser.add_argument("--version", action="version", version=f"handoffkit {__version__}")
    subparsers = parser.add_subparsers(dest="command")
    subparsers.add_parser("demo", help="Run a local EchoProvider demo.")
    subparsers.add_parser("demo-async", help="Run a local async runtime demo.")
    subparsers.add_parser("demo-recipe", help="Run a local recipe demo.")
    subparsers.add_parser("demo-extension", help="Run a local extension demo.")
    subparsers.add_parser("demo-structured", help="Run a local structured output demo.")
    subparsers.add_parser("demo-provider-tools", help="Run a local provider tool adapter demo.")
    subparsers.add_parser("demo-quality", help="Run a local handoff quality demo.")
    subparsers.add_parser("demo-validators", help="Run local contract validator demos.")
    subparsers.add_parser("demo-provider-formats", help="Run local provider format demos.")
    subparsers.add_parser("demos", help="List real-world offline showcases.")
    showcase_parser = subparsers.add_parser("showcase", help="Run one real-world showcase.")
    showcase_parser.add_argument("slug", choices=showcase_names(), help="Showcase slug.")
    subparsers.add_parser("demo-coding-review", help="Run the coding agents showcase.")
    subparsers.add_parser("demo-support", help="Run the support escalation showcase.")
    subparsers.add_parser("demo-research", help="Run the research workflow showcase.")
    subparsers.add_parser("demo-doctor", help="Run the educational doctor-orchestrator showcase.")
    subparsers.add_parser("demo-fusion", help="Run the local Fusion-style panel demo.")
    subparsers.add_parser("demo-media", help="Run the local media dubbing workflow demo.")
    subparsers.add_parser(
        "demo-media-context",
        help="Run creation→generation→edition media context handoff demo.",
    )
    media_parser = subparsers.add_parser("media", help="Inspect and plan media workflows.")
    media_subparsers = media_parser.add_subparsers(dest="media_command")
    media_inspect_parser = media_subparsers.add_parser("inspect", help="Inspect transcript JSON.")
    media_inspect_parser.add_argument("path", help="Path to transcript JSON.")
    media_plan_parser = media_subparsers.add_parser("plan", help="Plan a video dubbing workflow.")
    media_plan_parser.add_argument("video_path", help="Input video path.")
    media_plan_parser.add_argument("--from", dest="source_language", default="auto")
    media_plan_parser.add_argument("--to", dest="target_language", default="es")
    media_subparsers.add_parser("ops", help="List media -ion operations and pipelines.")
    media_pipeline_parser = media_subparsers.add_parser(
        "pipeline",
        help="Plan a named media -ion pipeline as MediaContext stages.",
    )
    media_pipeline_parser.add_argument(
        "name",
        nargs="?",
        default="from_scratch",
        help="Pipeline name (from_scratch, video_dubbing, audiobook, ...).",
    )
    media_pipeline_parser.add_argument("--brief", default="", help="Creative / production brief.")
    media_pipeline_parser.add_argument("--to", dest="target_language", default="")
    media_pipeline_parser.add_argument("--video", default="", help="Optional source video path.")
    providers_parser = subparsers.add_parser("providers", help="Inspect provider registry.")
    providers_subparsers = providers_parser.add_subparsers(dest="providers_command")
    providers_list_parser = providers_subparsers.add_parser("list", help="List providers.")
    providers_list_parser.add_argument("--json", action="store_true", help="Print JSON.")
    providers_models_parser = providers_subparsers.add_parser(
        "models",
        help="List provider models.",
    )
    providers_models_parser.add_argument("--provider", required=True, help="Provider name.")
    providers_models_parser.add_argument(
        "--real",
        action="store_true",
        help="Call provider endpoint.",
    )
    providers_models_parser.add_argument("--json", action="store_true", help="Print JSON.")
    providers_probe_parser = providers_subparsers.add_parser("probe", help="Probe provider models.")
    providers_probe_parser.add_argument("--provider", required=True, help="Provider name.")
    providers_probe_parser.add_argument("--models", default=None, help="Comma-separated models.")
    providers_probe_parser.add_argument(
        "--real",
        action="store_true",
        help="Call provider endpoint.",
    )
    providers_probe_parser.add_argument("--json", action="store_true", help="Print JSON.")
    providers_select_parser = providers_subparsers.add_parser(
        "select",
        help="Select a provider model.",
    )
    providers_select_parser.add_argument("--provider", required=True, help="Provider name.")
    providers_select_parser.add_argument("--models", default=None, help="Comma-separated models.")
    providers_select_parser.add_argument(
        "--real",
        action="store_true",
        help="Call provider endpoint.",
    )
    providers_select_parser.add_argument("--json", action="store_true", help="Print JSON.")
    benchmark_doctor_parser = subparsers.add_parser(
        "benchmark-doctor",
        aliases=["doctor-benchmark", "doctor-b", "-d"],
        help="Run the real-case doctor benchmark harness (alias: doctor-benchmark, -d).",
    )
    benchmark_doctor_parser.add_argument(
        "--cases",
        type=int,
        default=30,
        help="Number of bundled real cases to replay.",
    )
    benchmark_doctor_mai_parser = subparsers.add_parser(
        "benchmark-doctor-mai",
        aliases=["mai-benchmark", "mai-b", "-m"],
        help="Run public MAI-style sequential doctor benchmark (alias: mai-benchmark, -m).",
    )
    benchmark_doctor_mai_parser.add_argument(
        "--cases",
        type=int,
        default=30,
        help="Number of bundled real cases to replay.",
    )
    independent_parser = subparsers.add_parser(
        "benchmark-independent",
        aliases=["independent-benchmark", "benchmark-protocol"],
        help=(
            "Run published independent protocol benchmark "
            "(offline, no public leaderboard)."
        ),
    )
    independent_parser.add_argument(
        "--seed",
        default="handoffkit-independent-2026",
        help="Reproducibility seed (metadata for methodology v1).",
    )
    independent_parser.add_argument(
        "--manifest",
        action="store_true",
        help="Print methodology manifest JSON only (no run).",
    )
    subparsers.add_parser("doctor", help="Run local package diagnostics.")
    subparsers.add_parser("api", help="Show stable API candidates.")
    subparsers.add_parser("demo-trace", help="Run a local run trace demo.")
    subparsers.add_parser("demo-replay", help="Run a local replay summary demo.")
    validate_parser = subparsers.add_parser("validate-report", help="Validate a JSON report.")
    validate_parser.add_argument("path", help="Path to a report JSON file.")
    evaluate_parser = subparsers.add_parser(
        "evaluate",
        help="Evaluate a trace or report JSON file.",
    )
    evaluate_parser.add_argument("path", help="Path to a trace or report JSON file.")
    report_parser = subparsers.add_parser("report", help="Render a generated run report.")
    report_parser.add_argument("path", help="Path to runs/latest, report.md, or report.json.")
    report_parser.add_argument("--html", action="store_true", help="Write a polished HTML report.")
    report_parser.add_argument("--output", default=None, help="Output path for --html.")
    init_parser = subparsers.add_parser("init", help="Scaffold a HandoffKit starter project.")
    init_parser.add_argument(
        "project_name",
        nargs="?",
        default=None,
        help="Project directory name.",
    )
    init_parser.add_argument(
        "--interactive",
        "-i",
        action="store_true",
        help="Scaffold interactively.",
    )
    init_parser.add_argument("--template", default=None, help="Template name.")
    init_parser.add_argument("--output", default=".", help="Parent output directory.")
    init_parser.add_argument("--force", action="store_true", help="Overwrite existing files.")

    project_report_parser = subparsers.add_parser(
        "project-report",
        help="Index a project directory and write a JSON + Markdown report.",
    )
    project_report_parser.add_argument(
        "project_path",
        nargs="?",
        default=".",
        help="Root directory to index (default: current directory).",
    )
    project_report_parser.add_argument(
        "--output", default="reports", help="Directory for output files."
    )
    project_report_parser.add_argument(
        "--query", default="handoffkit", help="Search query for index filter."
    )
    create_ext_parser = subparsers.add_parser(
        "create-extension",
        aliases=["init-extension"],
        help="Scaffold a HandoffKit extension boilerplate (alias: init-extension).",
    )
    create_ext_parser.add_argument("name", help="Extension name.")
    create_ext_parser.add_argument("--output", default=".", help="Parent output directory.")
    create_ext_parser.add_argument("--force", action="store_true", help="Overwrite existing files.")

    keys_parser = subparsers.add_parser("keys", help="Manage local API keys in .env.")
    keys_subparsers = keys_parser.add_subparsers(dest="keys_command")
    
    keys_set_parser = keys_subparsers.add_parser("set", help="Set a local key.")
    keys_set_parser.add_argument("name", help="Key name.")
    keys_set_parser.add_argument("value", help="Key value.")
    
    keys_delete_parser = keys_subparsers.add_parser("delete", help="Delete a local key.")
    keys_delete_parser.add_argument("name", help="Key name.")
    
    keys_subparsers.add_parser("list", help="List configured keys.")

    args = parser.parse_args(argv)

    if args.command == "demo":
        print(run_demo())
        return 0
    if args.command == "demo-async":
        print(run_async_demo())
        return 0
    if args.command == "demo-recipe":
        print(run_recipe_demo())
        return 0
    if args.command == "demo-extension":
        print(run_extension_demo())
        return 0
    if args.command == "demo-structured":
        print(run_structured_demo())
        return 0
    if args.command == "demo-provider-tools":
        print(run_provider_tools_demo())
        return 0
    if args.command == "demo-quality":
        print(run_quality_demo())
        return 0
    if args.command == "demo-validators":
        print(run_validators_demo())
        return 0
    if args.command == "demo-provider-formats":
        print(run_provider_formats_demo())
        return 0
    if args.command == "demos":
        print(list_showcases())
        return 0
    if args.command == "showcase":
        print(run_named_showcase(args.slug))
        return 0
    if args.command == "demo-coding-review":
        print(run_coding_review_demo())
        return 0
    if args.command == "demo-support":
        print(run_support_escalation_demo())
        return 0
    if args.command == "demo-research":
        print(run_research_workflow_demo())
        return 0
    if args.command == "demo-doctor":
        print(run_doctor_orchestrator_demo())
        return 0
    if args.command == "demo-fusion":
        print(run_fusion_style_demo())
        return 0
    if args.command == "demo-media":
        print(run_media_demo())
        return 0
    if args.command == "demo-media-context":
        print(run_media_context_demo())
        return 0
    if args.command == "media":
        if args.media_command == "inspect":
            print(inspect_media_transcript(args.path))
            return 0
        if args.media_command == "plan":
            print(
                plan_media_dubbing(
                    args.video_path,
                    source_language=args.source_language,
                    target_language=args.target_language,
                )
            )
            return 0
        if args.media_command == "ops":
            print(list_media_ops_text())
            return 0
        if args.media_command == "pipeline":
            print(
                run_media_pipeline_plan(
                    args.name,
                    brief=args.brief,
                    target_language=args.target_language,
                    video_path=args.video,
                )
            )
            return 0
        parser.error("media requires a subcommand")
    if args.command == "providers":
        if args.providers_command == "list":
            print(list_providers(json_output=args.json))
            return 0
        if args.providers_command == "models":
            print(list_provider_models(args.provider, real=args.real, json_output=args.json))
            return 0
        if args.providers_command == "probe":
            print(
                probe_provider_models(
                    args.provider,
                    models=args.models,
                    real=args.real,
                    json_output=args.json,
                )
            )
            return 0
        if args.providers_command == "select":
            print(
                select_provider_model(
                    args.provider,
                    models=args.models,
                    real=args.real,
                    json_output=args.json,
                )
            )
            return 0
        parser.error("providers requires a subcommand")
    if args.command == "benchmark-doctor":
        print(run_doctor_benchmark_demo(args.cases))
        return 0
    if args.command == "benchmark-doctor-mai":
        print(run_mai_style_doctor_benchmark_demo(args.cases))
        return 0
    if args.command == "benchmark-independent":
        print(
            run_independent_benchmark_demo(
                seed=args.seed,
                manifest_only=args.manifest,
            )
        )
        return 0
    if args.command == "doctor":
        print(run_doctor())
        return 0
    if args.command == "api":
        print(run_api())
        return 0
    if args.command == "demo-trace":
        print(run_trace_demo())
        return 0
    if args.command == "demo-replay":
        print(run_replay_demo())
        return 0
    if args.command == "validate-report":
        print(validate_report(args.path))
        return 0
    if args.command == "evaluate":
        print(evaluate_report(args.path))
        return 0
    if args.command == "report":
        print(render_report(args.path, html=args.html, output=args.output))
        return 0
    if args.command == "init":
        if args.interactive or not args.project_name:
            print(
                init_project_interactive(
                    args.project_name,
                    template=args.template,
                    output=args.output,
                    force=args.force,
                )
            )
        else:
            print(
                init_project(
                    args.project_name,
                    template=args.template,
                    output=args.output,
                    force=args.force,
                )
            )
        return 0
    if args.command == "create-extension":
        print(create_extension(args.name, output=args.output, force=args.force))
        return 0
    if args.command == "project-report":
        print(
            write_project_report(
                args.project_path,
                output_dir=args.output,
                query=args.query,
            )
        )
        return 0
    if args.command == "keys":
        if args.keys_command == "set":
            print(set_key(args.name, args.value))
            return 0
        if args.keys_command in ("delete", "remove"):
            print(delete_key(args.name))
            return 0
        if args.keys_command == "list":
            print(list_keys())
            return 0
        parser.error("keys requires a subcommand: set, list, delete")

    parser.print_help()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())



